import uuid
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from inventory.models import DailyProgress, Installation, Product, PushDevice, Task


class Command(BaseCommand):
    help = (
        "Safely assigns all historical legacy inventory records (where installation is NULL) "
        "to a designated target installation workspace. Operates server-side with zero secret leakage to clients."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--target-installation-id",
            type=str,
            required=True,
            help="UUID of the verified target Installation that will adopt legacy records.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Simulate the migration and print record counts without making changes.",
        )

    def handle(self, *args, **options):
        raw_uuid = options["target_installation_id"].strip()
        dry_run = options["dry_run"]

        try:
            target_uuid = uuid.UUID(raw_uuid)
        except ValueError:
            raise CommandError(f"Invalid UUID format: '{raw_uuid}'")

        target_installation = Installation.objects.filter(id=target_uuid).first()
        if not target_installation:
            raise CommandError(f"Target installation not found: '{target_uuid}'")

        if not target_installation.is_active:
            raise CommandError(
                f"Target installation '{target_uuid}' is inactive or deactivated. "
                "Cannot assign legacy records to an inactive workspace."
            )

        legacy_products = Product.objects.filter(installation__isnull=True)
        legacy_tasks = Task.objects.filter(installation__isnull=True)
        legacy_progress = DailyProgress.objects.filter(installation__isnull=True)
        legacy_devices = PushDevice.objects.filter(installation__isnull=True)

        p_count = legacy_products.count()
        t_count = legacy_tasks.count()
        dp_count = legacy_progress.count()
        d_count = legacy_devices.count()

        total = p_count + t_count + dp_count + d_count

        self.stdout.write(
            f"Found {total} unassigned legacy records:\n"
            f"  - Products: {p_count}\n"
            f"  - Tasks: {t_count}\n"
            f"  - Daily Progress: {dp_count}\n"
            f"  - Push Devices: {d_count}\n"
            f"Target workspace: {target_installation.id} ({target_installation.device_name or 'unnamed'})"
        )

        if total == 0:
            self.stdout.write(self.style.SUCCESS("No unassigned legacy records found. Nothing to migrate."))
            return

        # Pre-check: Detect SKU uniqueness collisions between target workspace and legacy products
        existing_skus = set(
            Product.objects.filter(installation=target_installation).values_list("sku", flat=True)
        )
        colliding_skus = list(
            legacy_products.filter(sku__in=existing_skus).values_list("sku", flat=True)
        )
        if colliding_skus:
            preview = ", ".join(colliding_skus[:5])
            raise CommandError(
                f"Cannot assign legacy records due to SKU collision! "
                f"Target workspace already contains {len(colliding_skus)} product(s) with conflicting SKUs: {preview}. "
                "Resolve duplicate SKUs before migration to preserve unique constraint integrity."
            )

        # Pre-check: Detect DailyProgress date collisions between target workspace and legacy entries
        existing_dates = set(
            DailyProgress.objects.filter(installation=target_installation).values_list("date", flat=True)
        )
        colliding_dates = list(
            legacy_progress.filter(date__in=existing_dates).values_list("date", flat=True)
        )
        if colliding_dates:
            preview = ", ".join(str(d) for d in colliding_dates[:5])
            raise CommandError(
                f"Cannot assign legacy records due to DailyProgress date collision! "
                f"Target workspace already contains journal entries for {len(colliding_dates)} conflicting date(s): {preview}. "
                "Resolve duplicate dates before migration."
            )

        if dry_run:
            self.stdout.write(self.style.WARNING("DRY RUN: No database changes were made."))
            return

        with transaction.atomic():
            legacy_products.update(installation=target_installation)
            legacy_tasks.update(installation=target_installation)
            legacy_progress.update(installation=target_installation)
            legacy_devices.update(installation=target_installation)

        self.stdout.write(
            self.style.SUCCESS(
                f"Successfully assigned {total} legacy records to installation '{target_installation.id}'."
            )
        )
