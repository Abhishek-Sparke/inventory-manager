import uuid
from rest_framework import authentication, exceptions, permissions
from .models import Installation


class InstallationAuthentication(authentication.BaseAuthentication):
    """
    Server-verified authentication for installation workspaces.
    Expects:
      - Header `X-Installation-Id`: UUID string of the installation workspace
      - Header `X-Installation-Token`: Cryptographic secret token issued at bootstrap
    Alternatively accepts:
      - `Authorization: Installation <uuid>:<token>`
    """

    def authenticate(self, request):
        installation_id_raw = request.headers.get("X-Installation-Id")
        installation_token_raw = request.headers.get("X-Installation-Token")

        # Fallback to Authorization header if X-Installation-* headers are not present
        if not installation_id_raw or not installation_token_raw:
            auth_header = request.headers.get("Authorization", "")
            if auth_header.startswith("Installation "):
                payload = auth_header[len("Installation "):].strip()
                if ":" in payload:
                    installation_id_raw, installation_token_raw = payload.split(":", 1)

        if not installation_id_raw and not installation_token_raw:
            # No credentials provided; let permission class handle unauthenticated access
            return None

        if not installation_id_raw or not installation_token_raw:
            raise exceptions.AuthenticationFailed("Both X-Installation-Id and X-Installation-Token are required.")

        try:
            installation_uuid = uuid.UUID(str(installation_id_raw).strip())
        except (ValueError, TypeError, AttributeError):
            raise exceptions.AuthenticationFailed("Invalid X-Installation-Id format. Must be a valid UUID.")

        installation = Installation.objects.filter(id=installation_uuid, is_active=True).first()
        if not installation:
            raise exceptions.AuthenticationFailed("Installation not found or inactive.")

        if not installation.verify_token(installation_token_raw.strip()):
            raise exceptions.AuthenticationFailed("Invalid installation token.")

        # Attach installation to request
        request.installation = installation
        return (installation, installation_token_raw.strip())

    def authenticate_header(self, request):
        return 'Installation realm="api"'


class IsVerifiedInstallation(permissions.BasePermission):
    """
    Ensures the request originated from an active, verified installation workspace.
    """

    def has_permission(self, request, view):
        installation = getattr(request, "installation", None)
        return bool(installation and getattr(installation, "is_active", False))
