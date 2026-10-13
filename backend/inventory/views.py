import datetime
import logging
import secrets
import uuid
from django.db import transaction
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from .authentication import IsVerifiedInstallation
from .models import DailyProgress, Installation, Product, PushDevice, RecoveryCredential, Task
from .recovery import (
    compute_dummy_hash,
    generate_recovery_key,
    normalize_recovery_key,
    verify_recovery_key_format_and_checksum,
    verify_secret_hash,
)
from .serializers import (
    DailyProgressSerializer,
    InstallationSerializer,
    ProductSerializer,
    TaskSerializer,
)

logger = logging.getLogger(__name__)


from rest_framework.throttling import AnonRateThrottle

class BootstrapRateThrottle(AnonRateThrottle):
    scope = "bootstrap"
    rate = "30/minute"


class RecoveryRateThrottle(AnonRateThrottle):
    scope = "recovery"
    rate = "10/hour"


class InstallationBootstrapView(APIView):
    """
    Public bootstrap endpoint for newly installed mobile applications.
    Issues a server-verified Installation workspace with a high-entropy secret token.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [BootstrapRateThrottle]

    def post(self, request):
        device_name = str(request.data.get("device_name", "")).strip()[:120]
        raw_token = secrets.token_urlsafe(32)
        token_hash = Installation.hash_token(raw_token)

        installation = Installation.objects.create(
            id=uuid.uuid4(),
            token_hash=token_hash,
            device_name=device_name,
            is_active=True,
        )

        logger.info("Bootstrapped new installation workspace: %s (%s)", installation.id, device_name)

        return Response(
            {
                "installation_id": str(installation.id),
                "installation_token": raw_token,
                "device_name": installation.device_name,
                "created_at": installation.created_at.isoformat(),
            },
            status=status.HTTP_201_CREATED,
        )


class InstallationInfoView(APIView):
    """
    Returns metadata about the active verified installation workspace.
    """
    permission_classes = [IsVerifiedInstallation]

    def get(self, request):
        serializer = InstallationSerializer(request.installation)
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProductListCreateView(generics.ListCreateAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer
    permission_classes = [IsVerifiedInstallation]

    def get_queryset(self):
        return Product.objects.filter(installation=self.request.installation)

    def perform_create(self, serializer):
        from django.db import IntegrityError
        from rest_framework.exceptions import ValidationError

        try:
            product = serializer.save(installation=self.request.installation)
        except IntegrityError:
            raise ValidationError({"sku": "A product with this SKU already exists in this installation."})

        if product.quantity <= product.reorder_level:
            try:
                from .notifications import send_low_stock_push_notification
                send_low_stock_push_notification(product)
            except Exception as exc:
                logger.warning(
                    "Low stock notification dispatch failed for created product %s: %s",
                    product.id,
                    type(exc).__name__,
                )


class ProductDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ProductSerializer
    permission_classes = [IsVerifiedInstallation]

    def get_queryset(self):
        return Product.objects.filter(installation=self.request.installation)

    def perform_update(self, serializer):
        instance = serializer.instance
        old_quantity = instance.quantity
        old_reorder_level = instance.reorder_level
        product = serializer.save()
        new_quantity = product.quantity
        new_reorder_level = product.reorder_level

        # Crossing event: quantity was above threshold and is now at or below threshold
        was_above = old_quantity > old_reorder_level
        is_now_low = new_quantity <= new_reorder_level

        if was_above and is_now_low:
            try:
                from .notifications import send_low_stock_push_notification
                send_low_stock_push_notification(product)
            except Exception as exc:
                logger.warning(
                    "Low stock notification dispatch failed for updated product %s: %s",
                    product.id,
                    type(exc).__name__,
                )


class TaskListCreateView(generics.ListCreateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer
    permission_classes = [IsVerifiedInstallation]

    def get_queryset(self):
        queryset = Task.objects.filter(installation=self.request.installation)
        params = self.request.query_params

        # Filter by priority
        priority = params.get("priority")
        if priority:
            queryset = queryset.filter(priority=priority)

        # Filter by status
        status_param = params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)

        # Filter by completion boolean
        is_completed = params.get("is_completed")
        if is_completed is not None:
            if is_completed.lower() in ("true", "1"):
                queryset = queryset.filter(is_completed=True)
            elif is_completed.lower() in ("false", "0"):
                queryset = queryset.filter(is_completed=False)

        # Filter by specific date (YYYY-MM-DD)
        date_str = params.get("date")
        if date_str:
            queryset = queryset.filter(scheduled_at__date=date_str)

        # Filter by date range (start_date and end_date)
        start_date = params.get("start_date")
        end_date = params.get("end_date")
        if start_date:
            queryset = queryset.filter(scheduled_at__date__gte=start_date)
        if end_date:
            queryset = queryset.filter(scheduled_at__date__lte=end_date)

        return queryset

    def perform_create(self, serializer):
        serializer.save(installation=self.request.installation)


class TaskDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TaskSerializer
    permission_classes = [IsVerifiedInstallation]

    def get_queryset(self):
        return Task.objects.filter(installation=self.request.installation)


class DailyProgressListCreateView(generics.ListCreateAPIView):
    serializer_class = DailyProgressSerializer
    permission_classes = [IsVerifiedInstallation]

    def get_queryset(self):
        queryset = DailyProgress.objects.filter(installation=self.request.installation)
        date_param = self.request.query_params.get("date")
        if date_param:
            queryset = queryset.filter(date=date_param)

        task_id = self.request.query_params.get("task_id") or self.request.query_params.get("linked_task")
        if task_id:
            queryset = queryset.filter(linked_task_id=task_id)

        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")
        if start_date:
            queryset = queryset.filter(date__gte=start_date)
        if end_date:
            queryset = queryset.filter(date__lte=end_date)

        return queryset

    def create(self, request, *args, **kwargs):
        # Support idempotent upsert based on date scoped to active installation
        target_date = request.data.get("date")
        if target_date:
            existing = DailyProgress.objects.filter(
                date=target_date,
                installation=request.installation,
            ).first()
            if existing:
                serializer = self.get_serializer(existing, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(installation=request.installation)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class DailyProgressDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = DailyProgressSerializer
    permission_classes = [IsVerifiedInstallation]

    def get_queryset(self):
        return DailyProgress.objects.filter(installation=self.request.installation)


class DailyProgressByDateView(generics.GenericAPIView):
    serializer_class = DailyProgressSerializer
    permission_classes = [IsVerifiedInstallation]

    def get(self, request, date):
        progress = DailyProgress.objects.filter(
            date=date,
            installation=request.installation,
        ).first()
        if not progress:
            return Response(
                {
                    "date": date,
                    "description": "",
                    "achievements": "",
                    "blockers": "",
                    "next_steps": "",
                    "notes": "",
                },
                status=status.HTTP_200_OK,
            )
        serializer = self.get_serializer(progress)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request, date):
        progress, _ = DailyProgress.objects.get_or_create(
            date=date,
            installation=request.installation,
        )
        serializer = self.get_serializer(progress, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, date):
        progress = DailyProgress.objects.filter(
            date=date,
            installation=request.installation,
        ).first()
        if progress:
            progress.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)


@api_view(["POST"])
@permission_classes([IsVerifiedInstallation])
def register_push_device(request):
    token = request.data.get("expo_push_token")
    device_name = request.data.get("device_name", "")

    if not token:
        return Response(
            {"error": "expo_push_token is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Deactivate obsolete registrations of this push token on any other installation
    PushDevice.objects.filter(expo_push_token=token).exclude(
        installation=request.installation
    ).update(is_active=False)

    device, created = PushDevice.objects.update_or_create(
        expo_push_token=token,
        installation=request.installation,
        defaults={
            "device_name": device_name,
            "is_active": True,
        },
    )

    return Response(
        {
            "message": "Push device registered",
            "created": created,
        },
        status=status.HTTP_201_CREATED,
    )


class RecoverySetupView(APIView):
    """
    Authenticated endpoint to generate or rotate a recovery key for the active installation.
    Stores only the PBKDF2 hash of the secret portion in RecoveryCredential.
    Returns the formatted key once to the client.
    """
    permission_classes = [IsVerifiedInstallation]

    def post(self, request):
        (formatted_key, lookup_id, secret_chars, salt_hex, key_hash_hex) = generate_recovery_key()

        with transaction.atomic():
            # 1. Lock the parent Installation row to serialize concurrent setup/rotation requests
            installation = (
                Installation.objects.select_for_update()
                .filter(id=request.installation.id, is_active=True)
                .first()
            )
            if not installation:
                return Response(
                    {"error": "Installation workspace not found or inactive."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            # 2. Invalidate any prior active credentials for this installation
            for old_cred in RecoveryCredential.objects.select_for_update().filter(
                installation=installation, is_active=True
            ):
                old_cred.is_active = False
                old_cred.lookup_id = f"revoked_{old_cred.id.hex[:16]}"
                old_cred.save(update_fields=["is_active", "lookup_id", "updated_at"])

            # 3. Create the new active recovery credential
            cred = RecoveryCredential.objects.create(
                installation=installation,
                lookup_id=lookup_id,
                key_hash=key_hash_hex,
                salt=salt_hex,
                is_active=True,
            )

        logger.info("Generated new recovery key for installation: %s", request.installation.id)

        return Response(
            {
                "recovery_key": formatted_key,
                "created_at": cred.created_at.isoformat(),
            },
            status=status.HTTP_201_CREATED,
        )


class RecoveryStatusView(APIView):
    """
    Authenticated endpoint to check whether the active installation has an active recovery key.
    Never exposes plaintext keys or hashes.
    """
    permission_classes = [IsVerifiedInstallation]

    def get(self, request):
        cred = RecoveryCredential.objects.filter(
            installation=request.installation,
            is_active=True,
        ).first()

        return Response(
            {
                "has_recovery_key": cred is not None,
                "created_at": cred.created_at.isoformat() if cred else None,
                "last_used_at": cred.last_used_at.isoformat() if (cred and cred.last_used_at) else None,
            },
            status=status.HTTP_200_OK,
        )


class RecoveryRestoreView(APIView):
    """
    Public endpoint to restore a workspace onto a new device using a valid recovery key.
    Preserves the existing Installation UUID in-place.
    Rotates the Installation token hash, invalidates the old device token,
    deactivates old push devices, invalidates the used recovery key, and issues a fresh replacement key.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [RecoveryRateThrottle]

    def post(self, request):
        raw_key = request.data.get("recovery_key")
        device_name = str(request.data.get("device_name", "")).strip()[:120]

        if not raw_key:
            compute_dummy_hash("dummy")
            return Response(
                {"error": "Invalid or expired recovery key."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1. Format & checksum validation
        try:
            normalized = normalize_recovery_key(raw_key)
            if not verify_recovery_key_format_and_checksum(normalized):
                compute_dummy_hash("dummy")
                return Response(
                    {"error": "Invalid or expired recovery key."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except (ValueError, TypeError, AttributeError):
            compute_dummy_hash("dummy")
            return Response(
                {"error": "Invalid or expired recovery key."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lookup_id = normalized[:6]
        secret_chars = normalized[6:30]

        # A. Look up candidate installation from active recovery credentials
        # (Evaluated before transaction to release autocommit read lock and prevent SQLite upgrade deadlocks)
        candidate_installation_id = (
            RecoveryCredential.objects.filter(lookup_id=lookup_id, is_active=True)
            .values_list("installation_id", flat=True)
            .first()
        )

        if not candidate_installation_id:
            compute_dummy_hash(secret_chars)
            return Response(
                {"error": "Invalid or expired recovery key."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        # 2. Atomic ownership verification and in-place credential rotation
        with transaction.atomic():
            # B. Lock the parent Installation row FIRST to maintain a consistent lock hierarchy
            # (Installation -> RecoveryCredential) across all views and eliminate deadlock risks
            installation = (
                Installation.objects.select_for_update()
                .filter(id=candidate_installation_id, is_active=True)
                .first()
            )

            if not installation:
                compute_dummy_hash(secret_chars)
                return Response(
                    {"error": "Invalid or expired recovery key."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            # C. Lock and revalidate RecoveryCredential under the acquired Installation lock
            cred = (
                RecoveryCredential.objects.select_for_update()
                .filter(lookup_id=lookup_id, installation=installation, is_active=True)
                .first()
            )

            if not cred:
                compute_dummy_hash(secret_chars)
                return Response(
                    {"error": "Invalid or expired recovery key."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            now = timezone.now()

            # Check temporary expiring lockout window
            if cred.lockout_until and cred.lockout_until > now:
                compute_dummy_hash(secret_chars)
                return Response(
                    {"error": "Invalid or expired recovery key."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            # Clear expired lockout
            if cred.lockout_until and cred.lockout_until <= now:
                cred.failed_attempts = 0
                cred.lockout_until = None

            # Verify secret hash in constant time
            if not verify_secret_hash(secret_chars, cred.salt, cred.key_hash):
                cred.failed_attempts += 1
                cred.last_failed_at = now
                if cred.failed_attempts >= 5:
                    cred.lockout_until = now + datetime.timedelta(minutes=15)
                    cred.failed_attempts = 0
                cred.save(update_fields=["failed_attempts", "lockout_until", "last_failed_at", "updated_at"])
                return Response(
                    {"error": "Invalid or expired recovery key."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

            # In-place credential rotation: preserve Installation UUID, rotate token hash
            new_raw_token = secrets.token_urlsafe(32)
            installation.token_hash = Installation.hash_token(new_raw_token)
            if device_name:
                installation.device_name = device_name
            installation.save(update_fields=["token_hash", "device_name", "last_active_at"])

            # Deactivate all obsolete push-device registrations for this installation
            PushDevice.objects.filter(installation=installation).update(is_active=False)

            # Invalidate the used recovery key (prevent replay)
            cred.is_active = False
            cred.lookup_id = f"revoked_{cred.id.hex[:16]}"
            cred.last_used_at = now
            cred.failed_attempts = 0
            cred.lockout_until = None
            cred.save(
                update_fields=[
                    "is_active",
                    "lookup_id",
                    "last_used_at",
                    "failed_attempts",
                    "lockout_until",
                    "updated_at",
                ]
            )

            # Issue replacement recovery key for the SAME installation
            # Deactivate any other active credentials for this installation
            for other_cred in RecoveryCredential.objects.select_for_update().filter(
                installation=installation, is_active=True
            ).exclude(id=cred.id):
                other_cred.is_active = False
                other_cred.lookup_id = f"revoked_{other_cred.id.hex[:16]}"
                other_cred.save(update_fields=["is_active", "lookup_id", "updated_at"])

            (replacement_key, new_lookup, new_secret, new_salt, new_hash) = generate_recovery_key()
            RecoveryCredential.objects.create(
                installation=installation,
                lookup_id=new_lookup,
                key_hash=new_hash,
                salt=new_salt,
                is_active=True,
            )

            logger.info("Successfully restored installation %s in-place with rotated credentials", installation.id)

            return Response(
                {
                    "installation_id": str(installation.id),
                    "installation_token": new_raw_token,
                    "new_recovery_key": replacement_key,
                    "device_name": installation.device_name,
                    "restored_counts": {
                        "products": Product.objects.filter(installation=installation).count(),
                        "tasks": Task.objects.filter(installation=installation).count(),
                        "daily_progress": DailyProgress.objects.filter(installation=installation).count(),
                    },
                },
                status=status.HTTP_200_OK,
            )
