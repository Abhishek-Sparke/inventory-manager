import hashlib
import hmac
import uuid
from django.db import models


class Installation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token_hash = models.CharField(max_length=64, db_index=True)
    device_name = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_active_at = models.DateTimeField(auto_now=True)

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    @staticmethod
    def hash_token(raw_token: str) -> str:
        return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    def set_token(self, raw_token: str):
        self.token_hash = self.hash_token(raw_token)

    def verify_token(self, raw_token: str) -> bool:
        if not raw_token:
            return False
        return hmac.compare_digest(self.token_hash, self.hash_token(raw_token))

    def __str__(self):
        return f"Installation {self.id} ({self.device_name or 'unnamed'})"


class Product(models.Model):
    installation = models.ForeignKey(
        Installation,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="products",
        db_index=True,
    )
    name = models.CharField(max_length=150)
    sku = models.CharField(max_length=50)
    category = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.PositiveIntegerField(default=0)
    reorder_level = models.PositiveIntegerField(default=10)
    expiry_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.UniqueConstraint(
                fields=["installation", "sku"],
                name="unique_installation_product_sku",
            )
        ]

    def __str__(self):
        return f"{self.name} ({self.sku})"


class PushDevice(models.Model):
    installation = models.ForeignKey(
        Installation,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="push_devices",
        db_index=True,
    )
    expo_push_token = models.CharField(max_length=255)
    device_name = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["installation", "expo_push_token"],
                name="unique_installation_push_token",
            )
        ]

    def __str__(self):
        return self.device_name or self.expo_push_token


class Task(models.Model):
    PRIORITY_CHOICES = [
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("in_progress", "In Progress"),
        ("completed", "Completed"),
    ]

    installation = models.ForeignKey(
        Installation,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="tasks",
        db_index=True,
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    scheduled_at = models.DateTimeField(null=True, blank=True, db_index=True)
    end_at = models.DateTimeField(null=True, blank=True)
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="medium")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    is_completed = models.BooleanField(default=False, db_index=True)
    notes = models.TextField(blank=True)
    reminder_minutes = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["is_completed", "-scheduled_at", "-created_at"]
        indexes = [
            models.Index(fields=["scheduled_at"]),
            models.Index(fields=["is_completed"]),
            models.Index(fields=["status"]),
            models.Index(fields=["installation", "scheduled_at"]),
            models.Index(fields=["installation", "is_completed"]),
            models.Index(fields=["installation", "status"]),
        ]

    def save(self, *args, **kwargs):
        if self.status == "completed" and not self.is_completed:
            if self.pk:
                orig = Task.objects.filter(pk=self.pk).values("is_completed", "status").first()
                if orig and orig["is_completed"] and not self.is_completed:
                    self.status = "pending"
                else:
                    self.is_completed = True
            else:
                self.is_completed = True
        elif self.is_completed:
            self.status = "completed"
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class DailyProgress(models.Model):
    installation = models.ForeignKey(
        Installation,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="daily_progress",
        db_index=True,
    )
    date = models.DateField(db_index=True)
    description = models.TextField(blank=True)
    achievements = models.TextField(blank=True)
    blockers = models.TextField(blank=True)
    next_steps = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    linked_task = models.ForeignKey(
        Task,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="linked_daily_progress",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]
        indexes = [
            models.Index(fields=["date"]),
            models.Index(fields=["installation", "date"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["installation", "date"],
                name="unique_installation_daily_progress_date",
            )
        ]

    def __str__(self):
        return f"Daily Progress for {self.date}"


class RecoveryCredential(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    installation = models.ForeignKey(
        Installation,
        on_delete=models.CASCADE,
        related_name="recovery_credentials",
    )
    lookup_id = models.CharField(max_length=64, unique=True, db_index=True)
    key_hash = models.CharField(max_length=128)
    salt = models.CharField(max_length=64)
    failed_attempts = models.PositiveIntegerField(default=0)
    lockout_until = models.DateTimeField(null=True, blank=True)
    last_failed_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["lookup_id", "is_active"]),
            models.Index(fields=["installation", "is_active"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["installation"],
                condition=models.Q(is_active=True),
                name="unique_active_recovery_credential_per_installation",
            ),
        ]

    def __str__(self):
        return f"RecoveryCredential {self.lookup_id} ({'active' if self.is_active else 'inactive'})"
