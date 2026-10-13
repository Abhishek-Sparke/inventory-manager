import datetime
import os
import threading
import uuid
from io import StringIO
from unittest.mock import patch
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, transaction
from django.db.models import ProtectedError
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient, APITestCase, APITransactionTestCase
from .models import DailyProgress, Installation, Product, PushDevice, RecoveryCredential, Task
from .recovery import (
    compute_checksum_10bit,
    encode_checksum_chars,
    generate_recovery_key,
    normalize_recovery_key,
    verify_recovery_key_format_and_checksum,
)


class InstallationAPITestCase(APITestCase):
    """Base test case providing an active authenticated installation workspace."""

    def setUp(self):
        super().setUp()
        self.raw_token = "test-token-123456789012345678901234"
        self.installation = Installation.objects.create(
            token_hash=Installation.hash_token(self.raw_token),
            device_name="Test Device Primary",
        )
        self.client.credentials(
            HTTP_X_INSTALLATION_ID=str(self.installation.id),
            HTTP_X_INSTALLATION_TOKEN=self.raw_token,
        )


class TaskAPITests(InstallationAPITestCase):
    def setUp(self):
        super().setUp()
        self.task = Task.objects.create(
            installation=self.installation,
            title="Initial Task",
            description="Perform monthly count",
            priority="high",
            is_completed=False,
        )

    def test_list_tasks(self):
        url = reverse("task-list-create")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data if isinstance(response.data, list) else response.data.get("results", [])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "Initial Task")

    def test_create_task(self):
        url = reverse("task-list-create")
        payload = {
            "title": "Restock Milk",
            "description": "50 crates needed",
            "priority": "medium",
            "is_completed": False,
        }
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["title"], "Restock Milk")
        self.assertEqual(Task.objects.filter(installation=self.installation).count(), 2)

    def test_create_task_with_precise_minute_scheduling(self):
        url = reverse("task-list-create")
        # 17:48 in IST (UTC+05:30) is 12:18:00 UTC
        payload = {
            "title": "Inventory Audit 17:48",
            "description": "Check aisle 4 with minute precision",
            "scheduled_at": "2026-10-11T12:18:00Z",
            "priority": "high",
            "is_completed": False,
        }
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("12:18:00", response.data["scheduled_at"])
        created = Task.objects.get(pk=response.data["id"])
        self.assertEqual(created.scheduled_at.minute, 18)
        self.assertEqual(created.scheduled_at.hour, 12)

    def test_update_and_complete_task(self):
        url = reverse("task-detail", kwargs={"pk": self.task.pk})
        payload = {
            "is_completed": True,
            "priority": "low",
        }
        response = self.client.patch(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.task.refresh_from_db()
        self.assertTrue(self.task.is_completed)
        self.assertEqual(self.task.priority, "low")

    def test_delete_task(self):
        url = reverse("task-detail", kwargs={"pk": self.task.pk})
        response = self.client.delete(url)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Task.objects.filter(installation=self.installation).count(), 0)

    def test_task_status_and_completion_synchronization(self):
        url = reverse("task-list-create")
        payload = {
            "title": "Status Sync Task",
            "status": "completed",
            "priority": "low",
        }
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data["is_completed"])
        self.assertEqual(response.data["status"], "completed")

        task_id = response.data["id"]
        # Update is_completed to False -> status becomes pending
        patch_res = self.client.patch(
            reverse("task-detail", kwargs={"pk": task_id}),
            {"is_completed": False},
            format="json",
        )
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)
        self.assertFalse(patch_res.data["is_completed"])
        self.assertEqual(patch_res.data["status"], "pending")

    def test_task_end_time_validation(self):
        url = reverse("task-list-create")
        payload = {
            "title": "Invalid End Time",
            "scheduled_at": "2026-10-12T10:00:00Z",
            "end_at": "2026-10-12T09:00:00Z",
        }
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("end_at", response.data)

    def test_task_filtering_by_date_and_status(self):
        Task.objects.create(
            installation=self.installation,
            title="Today Task",
            scheduled_at="2026-10-12T14:00:00Z",
            status="pending",
        )
        Task.objects.create(
            installation=self.installation,
            title="Tomorrow Task",
            scheduled_at="2026-10-13T10:00:00Z",
            status="completed",
        )
        url = reverse("task-list-create")

        # Filter by date
        res = self.client.get(f"{url}?date=2026-10-12")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        titles = [t["title"] for t in (res.data if isinstance(res.data, list) else res.data.get("results", []))]
        self.assertIn("Today Task", titles)
        self.assertNotIn("Tomorrow Task", titles)

        # Filter by status
        res_completed = self.client.get(f"{url}?status=completed")
        titles_completed = [t["title"] for t in (res_completed.data if isinstance(res_completed.data, list) else res_completed.data.get("results", []))]
        self.assertIn("Tomorrow Task", titles_completed)
        self.assertNotIn("Today Task", titles_completed)


class DailyProgressAPITests(InstallationAPITestCase):
    def test_create_and_fetch_daily_progress(self):
        url = reverse("daily-progress-list-create")
        payload = {
            "date": "2026-10-12",
            "description": "Finished stock audit for aisle 1 and aisle 2.",
            "achievements": "Identified 3 low stock items.",
            "blockers": "Barcode scanner battery died once.",
            "next_steps": "Order replacement parts.",
            "notes": "Verified inventory accuracy.",
        }
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["date"], "2026-10-12")
        self.assertEqual(response.data["description"], payload["description"])

        # Fetch by date endpoint
        date_url = reverse("daily-progress-by-date", kwargs={"date": "2026-10-12"})
        fetch_res = self.client.get(date_url)
        self.assertEqual(fetch_res.status_code, status.HTTP_200_OK)
        self.assertEqual(fetch_res.data["description"], payload["description"])

    def test_idempotent_daily_progress_update(self):
        url = reverse("daily-progress-list-create")
        payload1 = {
            "date": "2026-10-15",
            "description": "Initial morning journal entry",
        }
        res1 = self.client.post(url, payload1, format="json")
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Subsequent POST to same date updates rather than errors
        payload2 = {
            "date": "2026-10-15",
            "description": "Evening updated journal entry",
            "achievements": "Completed all deliveries",
        }
        res2 = self.client.post(url, payload2, format="json")
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        self.assertEqual(res2.data["description"], "Evening updated journal entry")
        self.assertEqual(res2.data["achievements"], "Completed all deliveries")


class ProductAPIIntegrityTests(InstallationAPITestCase):
    def test_existing_product_list(self):
        url = reverse("product-list-create")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_product_creation_triggers_low_stock_notification(self):
        from unittest.mock import patch
        url = reverse("product-list-create")
        payload = {
            "name": "Organic Honey",
            "sku": "HONEY-001",
            "price": "12.50",
            "quantity": 3,
            "reorder_level": 5,
        }
        with patch("inventory.notifications.send_low_stock_push_notification") as mock_notify:
            response = self.client.post(url, payload, format="json")
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
            mock_notify.assert_called_once()

    def test_product_update_crossing_triggers_notification(self):
        from unittest.mock import patch
        product = Product.objects.create(
            installation=self.installation,
            name="Arabica Beans",
            sku="COFFEE-001",
            price="15.00",
            quantity=20,
            reorder_level=10,
        )
        url = reverse("product-detail", kwargs={"pk": product.pk})

        # Update while staying above threshold -> No notification
        with patch("inventory.notifications.send_low_stock_push_notification") as mock_notify:
            res1 = self.client.patch(url, {"quantity": 15}, format="json")
            self.assertEqual(res1.status_code, status.HTTP_200_OK)
            mock_notify.assert_not_called()

        # Update crossing from above threshold to at or below -> Triggers notification
        with patch("inventory.notifications.send_low_stock_push_notification") as mock_notify:
            res2 = self.client.patch(url, {"quantity": 8}, format="json")
            self.assertEqual(res2.status_code, status.HTTP_200_OK)
            mock_notify.assert_called_once()

    def test_push_notification_exception_does_not_break_product_api(self):
        from unittest.mock import patch
        url = reverse("product-list-create")
        payload = {
            "name": "Matcha Tea",
            "sku": "MATCHA-001",
            "price": "22.00",
            "quantity": 2,
            "reorder_level": 5,
        }
        with patch("inventory.notifications.send_low_stock_push_notification", side_effect=RuntimeError("Network down")):
            response = self.client.post(url, payload, format="json")
            self.assertEqual(response.status_code, status.HTTP_201_CREATED)
            self.assertEqual(response.data["name"], "Matcha Tea")

    def test_notifications_format_and_invalid_token_skipping(self):
        from unittest.mock import patch
        from inventory.notifications import send_low_stock_push_notification

        PushDevice.objects.create(
            installation=self.installation,
            expo_push_token="InvalidTokenString",
            device_name="Bad Device",
        )
        PushDevice.objects.create(
            installation=self.installation,
            expo_push_token="ExponentPushToken[valid-test-token]",
            device_name="Good Device",
        )

        product_low = Product.objects.create(
            installation=self.installation,
            name="Green Tea",
            sku="TEA-01",
            price="5.00",
            quantity=3,
            reorder_level=5,
        )
        product_zero = Product.objects.create(
            installation=self.installation,
            name="Black Tea",
            sku="TEA-02",
            price="5.00",
            quantity=0,
            reorder_level=5,
        )

        with patch("requests.post") as mock_post:
            mock_post.return_value.ok = True
            mock_post.return_value.status_code = 200

            count_low = send_low_stock_push_notification(product_low)
            self.assertEqual(count_low, 1)
            payload_low = mock_post.call_args[1]["json"]
            self.assertEqual(len(payload_low), 1)
            self.assertEqual(payload_low[0]["title"], "Low Stock Alert: Green Tea")
            self.assertEqual(payload_low[0]["to"], "ExponentPushToken[valid-test-token]")

            count_zero = send_low_stock_push_notification(product_zero)
            self.assertEqual(count_zero, 1)
            payload_zero = mock_post.call_args[1]["json"]
            self.assertEqual(payload_zero[0]["title"], "Restock Needed: Black Tea")


class DatabaseConfigurationResolutionTests(APITestCase):
    def test_default_fallback_mysql(self):
        from config.settings import get_database_config
        cfg = get_database_config(env={})
        self.assertEqual(cfg["ENGINE"], "django.db.backends.mysql")
        self.assertEqual(cfg["PORT"], "3306")
        self.assertEqual(cfg["OPTIONS"].get("charset"), "utf8mb4")

    def test_postgres_discrete_environment_variables(self):
        from config.settings import get_database_config
        env = {
            "DB_ENGINE": "postgresql",
            "DB_HOST": "aws-0-ap-south-1.pooler.supabase.com",
            "DB_PORT": "6543",
            "DB_NAME": "postgres",
            "DB_USER": "postgres.myproject",
            "DB_PASSWORD": "secret_password",
            "DB_SSLMODE": "require",
            "DB_CONN_MAX_AGE": "0",
        }
        cfg = get_database_config(env=env)
        self.assertEqual(cfg["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(cfg["HOST"], "aws-0-ap-south-1.pooler.supabase.com")
        self.assertEqual(cfg["PORT"], "6543")
        self.assertEqual(cfg["NAME"], "postgres")
        self.assertEqual(cfg["USER"], "postgres.myproject")
        self.assertEqual(cfg["PASSWORD"], "secret_password")
        self.assertEqual(cfg["OPTIONS"].get("sslmode"), "require")
        self.assertEqual(cfg["CONN_MAX_AGE"], 0)

    def test_supabase_database_url_pooler(self):
        from config.settings import get_database_config
        env = {
            "DATABASE_URL": "postgresql://postgres.myproj:secret%40123@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require",
        }
        cfg = get_database_config(env=env)
        self.assertEqual(cfg["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(cfg["HOST"], "aws-0-ap-south-1.pooler.supabase.com")
        self.assertEqual(cfg["PORT"], "6543")
        self.assertEqual(cfg["USER"], "postgres.myproj")
        self.assertEqual(cfg["PASSWORD"], "secret@123")
        self.assertEqual(cfg["NAME"], "postgres")
        self.assertEqual(cfg["OPTIONS"].get("sslmode"), "require")

    def test_supabase_direct_url(self):
        from config.settings import get_database_config
        env = {
            "DATABASE_URL": "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
        }
        cfg = get_database_config(env=env)
        self.assertEqual(cfg["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(cfg["HOST"], "db.abcdefgh.supabase.co")
        self.assertEqual(cfg["PORT"], "5432")
        self.assertEqual(cfg["OPTIONS"].get("sslmode"), "require")

    def test_mysql_database_url(self):
        from config.settings import get_database_config
        env = {
            "DATABASE_URL": "mysql://root:localpass@127.0.0.1:3307/inventory_db",
        }
        cfg = get_database_config(env=env)
        self.assertEqual(cfg["ENGINE"], "django.db.backends.mysql")
        self.assertEqual(cfg["HOST"], "127.0.0.1")
        self.assertEqual(cfg["PORT"], "3307")
        self.assertEqual(cfg["NAME"], "inventory_db")
        self.assertEqual(cfg["OPTIONS"].get("charset"), "utf8mb4")

    def test_coexistence_supabase_and_mysql_settings(self):
        from config.settings import get_database_config
        coexistence_env = {
            "DB_ENGINE": "postgresql",
            "DB_HOST": "aws-0-ap-south-1.pooler.supabase.com",
            "DB_PORT": "5432",
            "DB_NAME": "postgres",
            "DB_USER": "postgres.myproject",
            "DB_PASSWORD": "supabase_secret",
            "DB_SSLMODE": "require",
            "DB_CONN_MAX_AGE": "0",
            "MYSQL_HOST": "127.0.0.1",
            "MYSQL_PORT": "3307",
            "MYSQL_NAME": "inventory_db",
            "MYSQL_USER": "root",
            "MYSQL_PASSWORD": "mysql_secret",
        }
        # When DB_ENGINE=postgresql, Supabase settings are selected
        pg_cfg = get_database_config(env=coexistence_env)
        self.assertEqual(pg_cfg["ENGINE"], "django.db.backends.postgresql")
        self.assertEqual(pg_cfg["HOST"], "aws-0-ap-south-1.pooler.supabase.com")
        self.assertEqual(pg_cfg["PORT"], "5432")
        self.assertEqual(pg_cfg["NAME"], "postgres")
        self.assertEqual(pg_cfg["USER"], "postgres.myproject")
        self.assertEqual(pg_cfg["OPTIONS"].get("sslmode"), "require")

        # When DB_ENGINE=mysql, local MySQL settings are selected
        coexistence_env["DB_ENGINE"] = "mysql"
        mysql_cfg = get_database_config(env=coexistence_env)
        self.assertEqual(mysql_cfg["ENGINE"], "django.db.backends.mysql")
        self.assertEqual(mysql_cfg["HOST"], "127.0.0.1")
        self.assertEqual(mysql_cfg["PORT"], "3307")
        self.assertEqual(mysql_cfg["NAME"], "inventory_db")
        self.assertEqual(mysql_cfg["USER"], "root")
        self.assertEqual(mysql_cfg["OPTIONS"].get("charset"), "utf8mb4")

    def test_safety_guard_blocks_production_environment_in_test_mode(self):
        from config.settings import get_database_config
        from django.core.exceptions import ImproperlyConfigured
        env = {
            "DJANGO_TEST_MODE": "true",
            "RENDER": "true",
        }
        with self.assertRaises(ImproperlyConfigured) as ctx:
            get_database_config(env=env)
        self.assertIn("cannot be enabled in a production environment", str(ctx.exception))

    def test_safety_guard_blocks_supabase_destinations_as_test_runner(self):
        from config.settings import get_database_config
        from django.core.exceptions import ImproperlyConfigured
        env = {
            "DJANGO_TEST_MODE": "true",
            "DJANGO_TEST_RUNNER_DB_NAME": "test_supabase_pooler.sqlite3",
        }
        with self.assertRaises(ImproperlyConfigured) as ctx:
            get_database_config(env=env)
        self.assertIn("targets a production/non-SQLite database name", str(ctx.exception))

    def test_safety_guard_blocks_protected_files_as_test_runner(self):
        from config.settings import get_database_config
        from django.core.exceptions import ImproperlyConfigured
        env = {
            "DJANGO_TEST_MODE": "true",
            "DJANGO_TEST_RUNNER_DB_NAME": ".env",
        }
        with self.assertRaises(ImproperlyConfigured) as ctx:
            get_database_config(env=env)
        self.assertIn("points to a protected project file", str(ctx.exception))



class SharedWorkspaceAndTaskProgressAPITests(InstallationAPITestCase):
    def test_task_reopen_and_complete_transitions(self):
        """Verifies completing and reopening a task correctly synchronizes status and is_completed."""
        task = Task.objects.create(
            installation=self.installation,
            title="Aisle 3 Stock Count",
            scheduled_at="2026-10-12T10:00:00Z",
            is_completed=False,
            status="pending",
        )
        url = reverse("task-detail", kwargs={"pk": task.pk})

        # 1. Complete the task
        complete_res = self.client.patch(
            url,
            {"is_completed": True, "status": "completed"},
            format="json",
        )
        self.assertEqual(complete_res.status_code, status.HTTP_200_OK)
        self.assertTrue(complete_res.data["is_completed"])
        self.assertEqual(complete_res.data["status"], "completed")
        task.refresh_from_db()
        self.assertTrue(task.is_completed)
        self.assertEqual(task.status, "completed")

        # 2. Reopen the task
        reopen_res = self.client.patch(
            url,
            {"is_completed": False, "status": "pending"},
            format="json",
        )
        self.assertEqual(reopen_res.status_code, status.HTTP_200_OK)
        self.assertFalse(reopen_res.data["is_completed"])
        self.assertEqual(reopen_res.data["status"], "pending")
        task.refresh_from_db()
        self.assertFalse(task.is_completed)
        self.assertEqual(task.status, "pending")

    def test_tasks_filtered_by_today_date_excludes_other_dates(self):
        """Verifies tasks query for today strictly returns today's tasks and excludes past/future dates."""
        Task.objects.create(
            installation=self.installation,
            title="Yesterday Audit",
            scheduled_at="2026-10-11T09:00:00Z",
            is_completed=True,
            status="completed",
        )
        Task.objects.create(
            installation=self.installation,
            title="Today Delivery Check",
            scheduled_at="2026-10-12T14:30:00Z",
            is_completed=False,
            status="pending",
        )
        Task.objects.create(
            installation=self.installation,
            title="Tomorrow Pallet Restock",
            scheduled_at="2026-10-13T11:00:00Z",
            is_completed=False,
            status="pending",
        )
        url = reverse("task-list-create")

        res = self.client.get(f"{url}?date=2026-10-12")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data if isinstance(res.data, list) else res.data.get("results", [])
        titles = [t["title"] for t in results]
        self.assertIn("Today Delivery Check", titles)
        self.assertNotIn("Yesterday Audit", titles)
        self.assertNotIn("Tomorrow Pallet Restock", titles)
        self.assertEqual(len(results), 1)

    def test_zero_tasks_for_date_returns_empty_list(self):
        """Verifies querying a date with no scheduled tasks safely returns an empty list without error."""
        url = reverse("task-list-create")
        res = self.client.get(f"{url}?date=2099-12-31")
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        results = res.data if isinstance(res.data, list) else res.data.get("results", [])
        self.assertEqual(results, [])

    def test_installation_workspace_accessibility(self):
        """Confirms products and tasks are accessible and modifiable within the verified installation workspace."""
        product = Product.objects.create(
            installation=self.installation,
            name="Workspace Flour",
            sku="FLOUR-001",
            price="4.50",
            quantity=100,
            reorder_level=20,
        )
        task = Task.objects.create(
            installation=self.installation,
            title="Workspace Stock Audit",
            is_completed=False,
            status="pending",
        )
        prod_res = self.client.get(reverse("product-list-create"))
        self.assertEqual(prod_res.status_code, status.HTTP_200_OK)
        prod_data = prod_res.data if isinstance(prod_res.data, list) else prod_res.data.get("results", [])
        self.assertTrue(any(p["id"] == product.id for p in prod_data))

        task_res = self.client.patch(
            reverse("task-detail", kwargs={"pk": task.pk}),
            {"is_completed": True, "status": "completed"},
            format="json",
        )
        self.assertEqual(task_res.status_code, status.HTTP_200_OK)
        self.assertTrue(task_res.data["is_completed"])

    def test_task_creation_with_journal_entry_persists_and_links_daily_progress(self):
        """Verifies creating a task with a journal entry saves the note and associates DailyProgress."""
        url = reverse("task-list-create")
        payload = {
            "title": "Cooler Aisle Audit",
            "scheduled_at": "2026-10-12T09:30:00Z",
            "priority": "high",
            "is_completed": False,
            "status": "pending",
            "notes": "Audited 40 crates in Section B, zero discrepancy.",
        }
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["notes"], payload["notes"])
        self.assertEqual(response.data["journal_entry"], payload["notes"])
        self.assertIsNotNone(response.data["daily_progress"])
        self.assertEqual(response.data["daily_progress"]["date"], "2026-10-12")

        # Verify DailyProgress model in DB for this installation
        dp = DailyProgress.objects.filter(
            date="2026-10-12",
            installation=self.installation,
        ).first()
        self.assertIsNotNone(dp)
        self.assertIn("Audited 40 crates in Section B", dp.description)
        self.assertEqual(dp.linked_task_id, response.data["id"])

    def test_multiple_tasks_same_date_updates_daily_progress_without_duplicate_error(self):
        """Verifies multiple tasks on the same date safely update DailyProgress without duplicate key crash."""
        url = reverse("task-list-create")
        # Task 1 on 2026-10-15
        res1 = self.client.post(
            url,
            {
                "title": "Morning Freezer Check",
                "scheduled_at": "2026-10-15T08:00:00Z",
                "notes": "Freezer temperature normal at -18C.",
                "is_completed": False,
            },
            format="json",
        )
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Task 2 on 2026-10-15 (same date)
        res2 = self.client.post(
            url,
            {
                "title": "Afternoon Dry Goods Count",
                "scheduled_at": "2026-10-15T14:00:00Z",
                "notes": "Counted 120 bags of organic flour.",
                "is_completed": False,
            },
            format="json",
        )
        self.assertEqual(res2.status_code, status.HTTP_201_CREATED)

        # Exactly 1 DailyProgress record for 2026-10-15 for this installation
        dp_count = DailyProgress.objects.filter(
            date="2026-10-15",
            installation=self.installation,
        ).count()
        self.assertEqual(dp_count, 1)

        dp = DailyProgress.objects.get(
            date="2026-10-15",
            installation=self.installation,
        )
        self.assertIn("Freezer temperature normal", dp.description)
        self.assertIn("Counted 120 bags of organic flour", dp.description)

    def test_journal_entry_does_not_count_as_completed_task(self):
        """Verifies entering a daily progress journal note does not falsely mark task as completed or alter progress."""
        url = reverse("task-list-create")
        payload = {
            "title": "Pending Task with Journal Note",
            "scheduled_at": "2026-10-12T16:00:00Z",
            "is_completed": False,
            "status": "pending",
            "notes": "Observations recorded, pending manager sign-off.",
        }
        res = self.client.post(url, payload, format="json")
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertFalse(res.data["is_completed"])
        self.assertEqual(res.data["status"], "pending")
        task = Task.objects.get(pk=res.data["id"])
        self.assertFalse(task.is_completed)
        self.assertEqual(task.status, "pending")


class InstallationWorkspaceIsolationTests(APITestCase):
    """
    Dedicated test suite for Requirement 8:
    - Two independent installations
    - Cross-installation CRUD denial (404)
    - Same SKU across installations
    - Same-date journal entries across installations
    - Notification isolation
    - Unauthenticated access denial
    """

    def setUp(self):
        super().setUp()
        # Installation A
        self.token_a = "token-secret-alpha-123456789012345"
        self.inst_a = Installation.objects.create(
            token_hash=Installation.hash_token(self.token_a),
            device_name="Installation A Device",
        )
        self.client_a = APIClient()
        self.client_a.credentials(
            HTTP_X_INSTALLATION_ID=str(self.inst_a.id),
            HTTP_X_INSTALLATION_TOKEN=self.token_a,
        )

        # Installation B
        self.token_b = "token-secret-bravo-987654321098765"
        self.inst_b = Installation.objects.create(
            token_hash=Installation.hash_token(self.token_b),
            device_name="Installation B Device",
        )
        self.client_b = APIClient()
        self.client_b.credentials(
            HTTP_X_INSTALLATION_ID=str(self.inst_b.id),
            HTTP_X_INSTALLATION_TOKEN=self.token_b,
        )

    def test_unauthenticated_request_denied_with_401(self):
        anon_client = APIClient()
        res_prod = anon_client.get(reverse("product-list-create"))
        self.assertEqual(res_prod.status_code, status.HTTP_401_UNAUTHORIZED)

        res_task = anon_client.get(reverse("task-list-create"))
        self.assertEqual(res_task.status_code, status.HTTP_401_UNAUTHORIZED)

        res_prog = anon_client.get(reverse("daily-progress-list-create"))
        self.assertEqual(res_prog.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_invalid_token_denied_with_401(self):
        bad_client = APIClient()
        bad_client.credentials(
            HTTP_X_INSTALLATION_ID=str(self.inst_a.id),
            HTTP_X_INSTALLATION_TOKEN="wrong-token-attack",
        )
        res = bad_client.get(reverse("product-list-create"))
        self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_bootstrap_endpoint_provisions_installation(self):
        anon = APIClient()
        res = anon.post(
            reverse("installation-bootstrap"),
            {"device_name": "New Samsung Phone"},
            format="json",
        )
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertIn("installation_id", res.data)
        self.assertIn("installation_token", res.data)
        self.assertEqual(res.data["device_name"], "New Samsung Phone")

        # Verify DB stored only the hash
        new_inst = Installation.objects.get(id=uuid.UUID(res.data["installation_id"]))
        self.assertNotEqual(new_inst.token_hash, res.data["installation_token"])
        self.assertTrue(new_inst.verify_token(res.data["installation_token"]))

    def test_product_isolation_between_two_installations(self):
        # A creates Product A
        res_a = self.client_a.post(
            reverse("product-list-create"),
            {
                "name": "Secret Product A",
                "sku": "PROD-A-001",
                "price": "50.00",
                "quantity": 10,
                "reorder_level": 5,
            },
            format="json",
        )
        self.assertEqual(res_a.status_code, status.HTTP_201_CREATED)
        prod_a_id = res_a.data["id"]

        # B creates Product B
        res_b = self.client_b.post(
            reverse("product-list-create"),
            {
                "name": "Public Product B",
                "sku": "PROD-B-001",
                "price": "20.00",
                "quantity": 5,
                "reorder_level": 2,
            },
            format="json",
        )
        self.assertEqual(res_b.status_code, status.HTTP_201_CREATED)

        # A lists products -> sees only Product A
        list_a = self.client_a.get(reverse("product-list-create")).data
        items_a = list_a if isinstance(list_a, list) else list_a.get("results", [])
        self.assertEqual(len(items_a), 1)
        self.assertEqual(items_a[0]["name"], "Secret Product A")

        # B lists products -> sees only Product B
        list_b = self.client_b.get(reverse("product-list-create")).data
        items_b = list_b if isinstance(list_b, list) else list_b.get("results", [])
        self.assertEqual(len(items_b), 1)
        self.assertEqual(items_b[0]["name"], "Public Product B")

        # Cross-installation access denial: B attempts GET, PATCH, DELETE on Product A
        detail_url = reverse("product-detail", kwargs={"pk": prod_a_id})
        self.assertEqual(self.client_b.get(detail_url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client_b.patch(detail_url, {"name": "Hacked"}).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client_b.delete(detail_url).status_code, status.HTTP_404_NOT_FOUND)

    def test_task_isolation_and_cross_installation_crud_denial_returns_404(self):
        # A creates Task A
        res_a = self.client_a.post(
            reverse("task-list-create"),
            {
                "title": "Private Audit Task A",
                "scheduled_at": "2026-10-14T10:00:00Z",
                "priority": "high",
                "is_completed": False,
            },
            format="json",
        )
        self.assertEqual(res_a.status_code, status.HTTP_201_CREATED)
        task_a_id = res_a.data["id"]

        # B queries tasks -> sees empty list
        list_b = self.client_b.get(reverse("task-list-create")).data
        items_b = list_b if isinstance(list_b, list) else list_b.get("results", [])
        self.assertEqual(len(items_b), 0)

        # B attempts to guess Task A's ID
        task_url = reverse("task-detail", kwargs={"pk": task_a_id})
        self.assertEqual(self.client_b.get(task_url).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client_b.patch(task_url, {"is_completed": True}).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client_b.delete(task_url).status_code, status.HTTP_404_NOT_FOUND)

    def test_same_sku_across_different_installations_coexists(self):
        # A creates product with SKU "SHARED-SKU-99"
        res_a = self.client_a.post(
            reverse("product-list-create"),
            {"name": "Alpha Item", "sku": "SHARED-SKU-99", "price": "10.00", "quantity": 1},
            format="json",
        )
        self.assertEqual(res_a.status_code, status.HTTP_201_CREATED)

        # B creates product with the exact same SKU "SHARED-SKU-99"
        res_b = self.client_b.post(
            reverse("product-list-create"),
            {"name": "Bravo Item", "sku": "SHARED-SKU-99", "price": "15.00", "quantity": 2},
            format="json",
        )
        self.assertEqual(res_b.status_code, status.HTTP_201_CREATED)

        # Duplicate within the same installation A fails
        res_a_dup = self.client_a.post(
            reverse("product-list-create"),
            {"name": "Alpha Duplicate", "sku": "SHARED-SKU-99", "price": "10.00", "quantity": 1},
            format="json",
        )
        self.assertEqual(res_a_dup.status_code, status.HTTP_400_BAD_REQUEST)

    def test_same_date_daily_progress_journal_entries_coexist(self):
        target_date = "2026-10-20"

        # A records daily progress for date
        res_a = self.client_a.post(
            reverse("daily-progress-list-create"),
            {"date": target_date, "description": "Installation A log"},
            format="json",
        )
        self.assertEqual(res_a.status_code, status.HTTP_201_CREATED)

        # B records daily progress for same date
        res_b = self.client_b.post(
            reverse("daily-progress-list-create"),
            {"date": target_date, "description": "Installation B log"},
            format="json",
        )
        self.assertEqual(res_b.status_code, status.HTTP_201_CREATED)

        # Fetch by date for A
        fetch_a = self.client_a.get(reverse("daily-progress-by-date", kwargs={"date": target_date}))
        self.assertEqual(fetch_a.data["description"], "Installation A log")

        # Fetch by date for B
        fetch_b = self.client_b.get(reverse("daily-progress-by-date", kwargs={"date": target_date}))
        self.assertEqual(fetch_b.data["description"], "Installation B log")

    def test_notification_isolation_across_installations(self):
        from unittest.mock import patch
        from inventory.notifications import send_low_stock_push_notification

        # Register Push Device for A
        self.client_a.post(
            reverse("register-push-device"),
            {"expo_push_token": "ExponentPushToken[inst-a-token]", "device_name": "Phone A"},
            format="json",
        )

        # Register Push Device for B
        self.client_b.post(
            reverse("register-push-device"),
            {"expo_push_token": "ExponentPushToken[inst-b-token]", "device_name": "Phone B"},
            format="json",
        )

        # Create low stock product for A
        res_prod = self.client_a.post(
            reverse("product-list-create"),
            {"name": "Milk A", "sku": "MILK-A", "price": "3.00", "quantity": 1, "reorder_level": 5},
            format="json",
        )
        product_a = Product.objects.get(id=res_prod.data["id"])

        with patch("requests.post") as mock_post:
            mock_post.return_value.ok = True
            mock_post.return_value.status_code = 200

            count = send_low_stock_push_notification(product_a)
            self.assertEqual(count, 1)

            payload = mock_post.call_args[1]["json"]
            self.assertEqual(len(payload), 1)
            # Notification must be sent strictly to Phone A, NEVER Phone B
            self.assertEqual(payload[0]["to"], "ExponentPushToken[inst-a-token]")

    def test_assign_legacy_workspace_management_command(self):
        # 1. Create isolated test records for products, tasks, daily progress, and push devices with installation=None
        legacy_product = Product.objects.create(
            installation=None,
            name="Legacy Product",
            sku="LEGACY-001",
            category="Hardware",
            description="Historical inventory item",
            price="19.99",
            quantity=15,
            reorder_level=5,
            expiry_date=datetime.date(2027, 6, 30),
        )
        legacy_task = Task.objects.create(
            installation=None,
            title="Legacy Audit Task",
            description="Quarterly physical stock audit",
            priority="high",
            status="pending",
            is_completed=False,
            notes="Requires warehouse manager signoff",
            reminder_minutes=60,
        )
        legacy_progress = DailyProgress.objects.create(
            installation=None,
            date="2026-10-15",
            description="Legacy Daily Progress Note",
            achievements="Verified Aisle 1",
            blockers="Forklift maintenance",
            next_steps="Audit Aisle 2",
            notes="Completed on legacy app",
        )
        legacy_device = PushDevice.objects.create(
            installation=None,
            expo_push_token="ExponentPushToken[legacy-device-tok-123]",
            device_name="Legacy Android Scanner",
            is_active=True,
        )

        # 2. Dry run simulation against active test Installation A
        out_dry = StringIO()
        call_command(
            "assign_legacy_workspace",
            f"--target-installation-id={self.inst_a.id}",
            "--dry-run",
            stdout=out_dry,
        )
        dry_output = out_dry.getvalue()
        self.assertIn("DRY RUN: No database changes were made.", dry_output)
        self.assertIn("Found 4 unassigned legacy records", dry_output)

        # 3. Confirm dry-run changed ZERO records (all remain installation=None)
        legacy_product.refresh_from_db()
        legacy_task.refresh_from_db()
        legacy_progress.refresh_from_db()
        legacy_device.refresh_from_db()
        self.assertIsNone(legacy_product.installation)
        self.assertIsNone(legacy_task.installation)
        self.assertIsNone(legacy_progress.installation)
        self.assertIsNone(legacy_device.installation)

        # 4. Real assignment to Installation A
        out_real = StringIO()
        call_command(
            "assign_legacy_workspace",
            f"--target-installation-id={self.inst_a.id}",
            stdout=out_real,
        )
        self.assertIn("Successfully assigned 4 legacy records to installation", out_real.getvalue())

        # 5. Verify every record is assigned to Installation A and retains all original fields
        legacy_product.refresh_from_db()
        legacy_task.refresh_from_db()
        legacy_progress.refresh_from_db()
        legacy_device.refresh_from_db()

        self.assertEqual(legacy_product.installation, self.inst_a)
        self.assertEqual(legacy_product.name, "Legacy Product")
        self.assertEqual(legacy_product.sku, "LEGACY-001")
        self.assertEqual(legacy_product.category, "Hardware")
        self.assertEqual(legacy_product.description, "Historical inventory item")
        self.assertEqual(str(legacy_product.price), "19.99")
        self.assertEqual(legacy_product.quantity, 15)
        self.assertEqual(legacy_product.reorder_level, 5)
        self.assertEqual(legacy_product.expiry_date, datetime.date(2027, 6, 30))

        self.assertEqual(legacy_task.installation, self.inst_a)
        self.assertEqual(legacy_task.title, "Legacy Audit Task")
        self.assertEqual(legacy_task.description, "Quarterly physical stock audit")
        self.assertEqual(legacy_task.priority, "high")
        self.assertEqual(legacy_task.status, "pending")
        self.assertFalse(legacy_task.is_completed)
        self.assertEqual(legacy_task.notes, "Requires warehouse manager signoff")
        self.assertEqual(legacy_task.reminder_minutes, 60)

        self.assertEqual(legacy_progress.installation, self.inst_a)
        self.assertEqual(str(legacy_progress.date), "2026-10-15")
        self.assertEqual(legacy_progress.description, "Legacy Daily Progress Note")
        self.assertEqual(legacy_progress.achievements, "Verified Aisle 1")
        self.assertEqual(legacy_progress.blockers, "Forklift maintenance")
        self.assertEqual(legacy_progress.next_steps, "Audit Aisle 2")
        self.assertEqual(legacy_progress.notes, "Completed on legacy app")

        self.assertEqual(legacy_device.installation, self.inst_a)
        self.assertEqual(legacy_device.expo_push_token, "ExponentPushToken[legacy-device-tok-123]")
        self.assertEqual(legacy_device.device_name, "Legacy Android Scanner")
        self.assertTrue(legacy_device.is_active)

        # Installation A can now query and manage the legacy product
        res = self.client_a.get(reverse("product-detail", kwargs={"pk": legacy_product.pk}))
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data["name"], "Legacy Product")

        # Installation B cannot access it
        res_b = self.client_b.get(reverse("product-detail", kwargs={"pk": legacy_product.pk}))
        self.assertEqual(res_b.status_code, status.HTTP_404_NOT_FOUND)

    def test_assign_legacy_workspace_conflicts_abort_without_partial_writes(self):
        # Case A: SKU collision between target workspace and legacy records
        Product.objects.create(
            installation=self.inst_b,
            name="Existing B Product",
            sku="COLLISION-SKU-001",
            price="5.00",
            quantity=2,
        )
        colliding_legacy_product = Product.objects.create(
            installation=None,
            name="Legacy Conflicting Product",
            sku="COLLISION-SKU-001",
            price="8.00",
            quantity=4,
        )
        unrelated_legacy_task = Task.objects.create(
            installation=None,
            title="Unrelated Legacy Task",
            is_completed=False,
        )

        with self.assertRaises(CommandError) as ctx_sku:
            call_command("assign_legacy_workspace", f"--target-installation-id={self.inst_b.id}")
        self.assertIn("SKU collision", str(ctx_sku.exception))

        # Confirm zero partial writes: both legacy product and legacy task remain installation=None
        colliding_legacy_product.refresh_from_db()
        unrelated_legacy_task.refresh_from_db()
        self.assertIsNone(colliding_legacy_product.installation)
        self.assertIsNone(unrelated_legacy_task.installation)

        # Remove colliding product to isolate DailyProgress test
        colliding_legacy_product.delete()

        # Case B: DailyProgress date collision between target workspace and legacy records
        DailyProgress.objects.create(
            installation=self.inst_b,
            date="2026-10-18",
            description="Existing Progress B",
        )
        colliding_legacy_progress = DailyProgress.objects.create(
            installation=None,
            date="2026-10-18",
            description="Legacy Conflicting Progress",
        )

        with self.assertRaises(CommandError) as ctx_date:
            call_command("assign_legacy_workspace", f"--target-installation-id={self.inst_b.id}")
        self.assertIn("DailyProgress date collision", str(ctx_date.exception))

        # Confirm zero partial writes: both legacy progress and task remain installation=None
        colliding_legacy_progress.refresh_from_db()
        unrelated_legacy_task.refresh_from_db()
        self.assertIsNone(colliding_legacy_progress.installation)
        self.assertIsNone(unrelated_legacy_task.installation)

        # Cleanup
        colliding_legacy_progress.delete()
        unrelated_legacy_task.delete()

    def test_database_isolation_guard_confirms_sqlite_only(self):
        # 6. Confirm the tests cannot connect to Supabase or MySQL
        self.assertEqual(connection.vendor, "sqlite")
        db_name = str(connection.settings_dict.get("NAME", "")).lower()
        self.assertTrue(db_name.endswith(".sqlite3") or db_name.endswith(".db"))
        self.assertNotIn("supabase", db_name)
        self.assertNotIn("pooler", db_name)
        self.assertNotIn("mysql", db_name)
        self.assertNotIn("postgres", db_name)

    def test_cross_installation_linked_task_rejected(self):
        # Installation A creates a private Task
        task_a = Task.objects.create(
            installation=self.inst_a,
            title="Installation A Confidential Task",
            is_completed=False,
        )

        # Installation B attempts to inject/link task_a into its DailyProgress
        payload_create = {
            "date": "2026-10-21",
            "description": "Installation B attempt to link A task",
            "linked_task": task_a.id,
        }
        res_create = self.client_b.post(
            reverse("daily-progress-list-create"),
            payload_create,
            format="json",
        )
        self.assertEqual(res_create.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("linked_task", res_create.data)

        # Installation B creates its own Task and DailyProgress legitimately
        task_b = Task.objects.create(
            installation=self.inst_b,
            title="Installation B Legitimate Task",
            is_completed=False,
        )
        res_valid = self.client_b.post(
            reverse("daily-progress-list-create"),
            {
                "date": "2026-10-21",
                "description": "Legitimate progress B",
                "linked_task": task_b.id,
            },
            format="json",
        )
        self.assertEqual(res_valid.status_code, status.HTTP_201_CREATED)
        dp_b_id = res_valid.data["id"]

        # Installation B attempts to patch its DailyProgress to point to Task A
        res_patch = self.client_b.patch(
            reverse("daily-progress-detail", kwargs={"pk": dp_b_id}),
            {"linked_task": task_a.id},
            format="json",
        )
        self.assertEqual(res_patch.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("linked_task", res_patch.data)

    def test_task_serializer_reverse_lookup_filtered_by_installation(self):
        # Installation A creates a Task scheduled on 2026-10-22
        task_a = Task.objects.create(
            installation=self.inst_a,
            title="Audit Day Task",
            scheduled_at="2026-10-22T10:00:00Z",
            is_completed=False,
        )

        # Installation B creates a DailyProgress on the exact same date
        DailyProgress.objects.create(
            installation=self.inst_b,
            date="2026-10-22",
            description="Installation B confidential notes",
        )

        # When Installation A fetches Task A, reverse lookups must NOT leak Installation B's progress
        res_a = self.client_a.get(reverse("task-detail", kwargs={"pk": task_a.pk}))
        self.assertEqual(res_a.status_code, status.HTTP_200_OK)
        self.assertEqual(res_a.data["journal_entry"], "")
        self.assertIsNone(res_a.data["daily_progress"])

        # Installation A creates its own DailyProgress for 2026-10-22 linked to Task A
        dp_a = DailyProgress.objects.create(
            installation=self.inst_a,
            date="2026-10-22",
            description="Installation A notes",
            linked_task=task_a,
        )

        # Fetching Task A now returns only Installation A's journal entry
        res_a_after = self.client_a.get(reverse("task-detail", kwargs={"pk": task_a.pk}))
        self.assertEqual(res_a_after.status_code, status.HTTP_200_OK)
        self.assertEqual(res_a_after.data["journal_entry"], "Installation A notes")
        self.assertEqual(res_a_after.data["daily_progress"]["id"], dp_a.id)

    def test_protected_deletion_prevents_installation_cascade(self):
        victim_inst = Installation.objects.create(
            token_hash="victim-hash-abc",
            device_name="Victim Device",
            is_active=True,
        )

        # 1. Product protection
        prod = Product.objects.create(
            installation=victim_inst,
            name="Protected Product",
            sku="PROT-001",
            price="10.00",
            quantity=5,
        )
        with self.assertRaises(ProtectedError):
            victim_inst.delete()
        prod.delete()

        # 2. Task protection
        task = Task.objects.create(
            installation=victim_inst,
            title="Protected Task",
            is_completed=False,
        )
        with self.assertRaises(ProtectedError):
            victim_inst.delete()
        task.delete()

        # 3. DailyProgress protection
        dp = DailyProgress.objects.create(
            installation=victim_inst,
            date="2026-10-23",
            description="Protected Progress",
        )
        with self.assertRaises(ProtectedError):
            victim_inst.delete()
        dp.delete()

        # 4. PushDevice cascades without protection error
        PushDevice.objects.create(
            installation=victim_inst,
            expo_push_token="ExponentPushToken[disposable-token]",
            device_name="Disposable Phone",
        )
        # Deleting the installation now succeeds and cascades the push device
        inst_id = victim_inst.id
        victim_inst.delete()
        self.assertFalse(Installation.objects.filter(id=inst_id).exists())
        self.assertFalse(PushDevice.objects.filter(expo_push_token="ExponentPushToken[disposable-token]").exists())

    def test_push_token_reassignment_deactivates_prior_installation(self):
        token = "ExponentPushToken[transferred-device-xyz]"

        # Installation A registers push token
        res_a = self.client_a.post(
            reverse("register-push-device"),
            {"expo_push_token": token, "device_name": "Device A"},
            format="json",
        )
        self.assertEqual(res_a.status_code, status.HTTP_201_CREATED)
        device_a = PushDevice.objects.get(installation=self.inst_a, expo_push_token=token)
        self.assertTrue(device_a.is_active)

        # Installation B registers the SAME push token (e.g. app reinstalled or device transferred)
        res_b = self.client_b.post(
            reverse("register-push-device"),
            {"expo_push_token": token, "device_name": "Device B"},
            format="json",
        )
        self.assertEqual(res_b.status_code, status.HTTP_201_CREATED)
        device_b = PushDevice.objects.get(installation=self.inst_b, expo_push_token=token)
        self.assertTrue(device_b.is_active)

        # Obsolete registration for Installation A is deactivated
        device_a.refresh_from_db()
        self.assertFalse(device_a.is_active)

        # Installation B re-registers same token -> remains active, A remains inactive
        res_b2 = self.client_b.post(
            reverse("register-push-device"),
            {"expo_push_token": token, "device_name": "Device B Refreshed"},
            format="json",
        )
        self.assertEqual(res_b2.status_code, status.HTTP_201_CREATED)
        device_b.refresh_from_db()
        self.assertTrue(device_b.is_active)
        device_a.refresh_from_db()
        self.assertFalse(device_a.is_active)

    def test_bootstrap_throttling(self):
        cache.clear()
        try:
            anon = APIClient()
            url = reverse("installation-bootstrap")

            # 30 requests should succeed (rate is 30/minute)
            for i in range(30):
                res = anon.post(url, {"device_name": f"Phone {i}"}, format="json")
                self.assertEqual(res.status_code, status.HTTP_201_CREATED)

            # 31st request should be throttled
            res_throttled = anon.post(url, {"device_name": "Phone 31"}, format="json")
            self.assertEqual(res_throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        finally:
            cache.clear()

    def test_assign_legacy_workspace_rejects_inactive_target(self):
        inactive_inst = Installation.objects.create(
            token_hash="hash_inactive_test",
            device_name="Inactive Device",
            is_active=False,
        )
        legacy_prod = Product.objects.create(
            installation=None,
            name="Orphan Product",
            sku="ORPHAN-TEST-01",
            price="5.00",
            quantity=1,
        )

        with self.assertRaises(CommandError) as ctx:
            call_command("assign_legacy_workspace", f"--target-installation-id={inactive_inst.id}")

        self.assertIn("inactive", str(ctx.exception).lower())
        legacy_prod.refresh_from_db()
        self.assertIsNone(legacy_prod.installation)

    def test_assign_legacy_workspace_detects_sku_collision(self):
        # Target installation already has a product with SKU "COLLIDE-SKU"
        Product.objects.create(
            installation=self.inst_a,
            name="Existing Product",
            sku="COLLIDE-SKU",
            price="12.00",
            quantity=3,
        )
        legacy_prod = Product.objects.create(
            installation=None,
            name="Legacy Colliding Product",
            sku="COLLIDE-SKU",
            price="15.00",
            quantity=4,
        )
        legacy_task = Task.objects.create(
            installation=None,
            title="Legacy Colliding Task",
            is_completed=False,
        )

        with self.assertRaises(CommandError) as ctx:
            call_command("assign_legacy_workspace", f"--target-installation-id={self.inst_a.id}")

        self.assertIn("COLLIDE-SKU", str(ctx.exception))
        # Ensure transactional rollback - no partial assignment
        legacy_prod.refresh_from_db()
        legacy_task.refresh_from_db()
        self.assertIsNone(legacy_prod.installation)
        self.assertIsNone(legacy_task.installation)

    def test_assign_legacy_workspace_detects_date_collision(self):
        # Target installation already has DailyProgress on 2026-10-30
        DailyProgress.objects.create(
            installation=self.inst_a,
            date="2026-10-30",
            description="Existing Installation A Progress",
        )
        legacy_dp = DailyProgress.objects.create(
            installation=None,
            date="2026-10-30",
            description="Legacy Progress Colliding",
        )

        with self.assertRaises(CommandError) as ctx:
            call_command("assign_legacy_workspace", f"--target-installation-id={self.inst_a.id}")

        self.assertIn("2026-10-30", str(ctx.exception))
        # Ensure transactional rollback
        legacy_dp.refresh_from_db()
        self.assertIsNone(legacy_dp.installation)


class RecoveryKeyAndRestoreAPITests(APITestCase):
    """
    Comprehensive tests for Recovery Credential generation, status, in-place UUID restore,
    token rotation, push device deactivation, rate limiting, and atomic rollback.
    """

    def setUp(self):
        super().setUp()
        cache.clear()
        self.raw_token = "primary-installation-secret-token-32b"
        self.installation = Installation.objects.create(
            token_hash=Installation.hash_token(self.raw_token),
            device_name="Primary Android Phone",
        )
        self.client.credentials(
            HTTP_X_INSTALLATION_ID=str(self.installation.id),
            HTTP_X_INSTALLATION_TOKEN=self.raw_token,
        )

    def tearDown(self):
        cache.clear()
        super().tearDown()

    def test_recovery_key_encoding_normalization_and_checksum_algorithm(self):
        formatted_key, lookup_id, secret_chars, salt_hex, key_hash = generate_recovery_key()

        # Check key format
        self.assertTrue(formatted_key.startswith("SF-"))
        self.assertEqual(len(formatted_key), 42)  # SF- + 32 chars + 7 hyphens

        # Normalization ignores spaces, lowercase, hyphens, and applies optical substitutions
        messy_key = formatted_key.lower().replace("-", " ")
        normalized = normalize_recovery_key(messy_key)
        self.assertEqual(len(normalized), 32)
        self.assertTrue(verify_recovery_key_format_and_checksum(normalized))

        # Test optical substitutions: O -> 0, I -> 1, L -> 1
        substituted = "SF-OOOO-IIII-LLLL-0000-1111-2222-3333-4444"
        norm_sub = normalize_recovery_key(substituted)
        self.assertEqual(norm_sub[:12], "000011111111")

        # Typo detection: modifying a single symbol in the payload causes checksum rejection
        corrupted_symbol = list(normalized)
        corrupted_symbol[5] = "Z" if corrupted_symbol[5] != "Z" else "A"
        corrupted_key = "".join(corrupted_symbol)
        self.assertFalse(verify_recovery_key_format_and_checksum(corrupted_key))

        # Typo detection: swapping two adjacent symbols causes checksum rejection
        swapped = list(normalized)
        swapped[10], swapped[11] = swapped[11], swapped[10]
        if swapped[10] != swapped[11]:
            self.assertFalse(verify_recovery_key_format_and_checksum("".join(swapped)))

        # Truncated or invalid length raises ValueError
        with self.assertRaises(ValueError):
            normalize_recovery_key("SF-TOO-SHORT")

    def test_recovery_setup_and_status(self):
        # 1. Initial status has no recovery key
        res_status_initial = self.client.get(reverse("recovery-status"))
        self.assertEqual(res_status_initial.status_code, status.HTTP_200_OK)
        self.assertFalse(res_status_initial.data["has_recovery_key"])

        # 2. Setup endpoint generates a recovery key
        res_setup = self.client.post(reverse("recovery-setup"))
        self.assertEqual(res_setup.status_code, status.HTTP_201_CREATED)
        self.assertIn("recovery_key", res_setup.data)
        self.assertTrue(res_setup.data["recovery_key"].startswith("SF-"))

        # Verify DB stored only the hash and salt, never the plaintext secret
        cred = RecoveryCredential.objects.get(installation=self.installation, is_active=True)
        self.assertNotIn(cred.key_hash, res_setup.data["recovery_key"])
        self.assertEqual(len(cred.salt), 32)

        # 3. Status reflects active recovery key
        res_status_after = self.client.get(reverse("recovery-status"))
        self.assertEqual(res_status_after.status_code, status.HTTP_200_OK)
        self.assertTrue(res_status_after.data["has_recovery_key"])

        # 4. Re-running setup rotates the key; old credential is deactivated with revoked prefix
        res_setup_2 = self.client.post(reverse("recovery-setup"))
        self.assertEqual(res_setup_2.status_code, status.HTTP_201_CREATED)
        cred.refresh_from_db()
        self.assertFalse(cred.is_active)
        self.assertTrue(cred.lookup_id.startswith("revoked_"))
        self.assertEqual(RecoveryCredential.objects.filter(installation=self.installation, is_active=True).count(), 1)

    def test_recovery_restore_preserves_installation_uuid_and_rotates_token(self):
        # Create product and task under primary installation
        prod = Product.objects.create(
            installation=self.installation,
            name="Restorable Widget",
            sku="WIDGET-RESTORE-01",
            price="19.99",
            quantity=50,
        )
        task = Task.objects.create(
            installation=self.installation,
            title="Restorable Task",
            is_completed=False,
        )

        # Generate recovery key
        res_setup = self.client.post(reverse("recovery-setup"))
        recovery_key = res_setup.data["recovery_key"]

        # Restore from a new device (unauthenticated public client)
        anon_client = APIClient()
        res_restore = anon_client.post(
            reverse("recovery-restore"),
            {"recovery_key": recovery_key, "device_name": "New Pixel 9"},
            format="json",
        )
        self.assertEqual(res_restore.status_code, status.HTTP_200_OK)

        # CRITICAL ASSERTION: The installation UUID is preserved in-place!
        restored_id = res_restore.data["installation_id"]
        self.assertEqual(restored_id, str(self.installation.id))

        new_token = res_restore.data["installation_token"]
        self.assertNotEqual(new_token, self.raw_token)

        # New token succeeds and immediately accesses products and tasks
        new_client = APIClient()
        new_client.credentials(
            HTTP_X_INSTALLATION_ID=restored_id,
            HTTP_X_INSTALLATION_TOKEN=new_token,
        )
        res_prod = new_client.get(reverse("product-list-create"))
        self.assertEqual(res_prod.status_code, status.HTTP_200_OK)
        items = res_prod.data if isinstance(res_prod.data, list) else res_prod.data.get("results", [])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["sku"], "WIDGET-RESTORE-01")

        # CRITICAL ASSERTION: Old device token is immediately rejected with HTTP 401
        res_old = self.client.get(reverse("product-list-create"))
        self.assertEqual(res_old.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_recovery_restore_continuous_data_accessibility(self):
        # Create full set of records
        Product.objects.create(installation=self.installation, name="Item A", sku="SKU-A", price="10.00", quantity=5)
        Task.objects.create(installation=self.installation, title="Task A", is_completed=True)
        DailyProgress.objects.create(installation=self.installation, date="2026-10-25", description="Day notes")

        res_setup = self.client.post(reverse("recovery-setup"))
        key = res_setup.data["recovery_key"]

        anon = APIClient()
        res_restore = anon.post(reverse("recovery-restore"), {"recovery_key": key}, format="json")
        self.assertEqual(res_restore.status_code, status.HTTP_200_OK)
        self.assertEqual(res_restore.data["restored_counts"]["products"], 1)
        self.assertEqual(res_restore.data["restored_counts"]["tasks"], 1)
        self.assertEqual(res_restore.data["restored_counts"]["daily_progress"], 1)

        # Foreign keys were not mutated
        self.assertEqual(Product.objects.filter(installation=self.installation).count(), 1)
        self.assertEqual(Task.objects.filter(installation=self.installation).count(), 1)
        self.assertEqual(DailyProgress.objects.filter(installation=self.installation).count(), 1)

    def test_recovery_restore_rotates_key_and_old_key_cannot_be_reused(self):
        res_setup = self.client.post(reverse("recovery-setup"))
        key_1 = res_setup.data["recovery_key"]

        anon = APIClient()
        res_restore_1 = anon.post(reverse("recovery-restore"), {"recovery_key": key_1}, format="json")
        self.assertEqual(res_restore_1.status_code, status.HTTP_200_OK)
        key_2 = res_restore_1.data["new_recovery_key"]
        self.assertNotEqual(key_1, key_2)

        # Attempting to restore again with key_1 fails with HTTP 401 (no replay attack)
        res_replay = anon.post(reverse("recovery-restore"), {"recovery_key": key_1}, format="json")
        self.assertEqual(res_replay.status_code, status.HTTP_401_UNAUTHORIZED)

        # Restoring with replacement key_2 succeeds
        res_restore_2 = anon.post(reverse("recovery-restore"), {"recovery_key": key_2}, format="json")
        self.assertEqual(res_restore_2.status_code, status.HTTP_200_OK)
        self.assertEqual(res_restore_2.data["installation_id"], str(self.installation.id))

    def test_recovery_restore_deactivates_push_devices(self):
        # Register a push device for the installation
        self.client.post(
            reverse("register-push-device"),
            {"expo_push_token": "ExponentPushToken[old-phone-token]", "device_name": "Old Phone"},
            format="json",
        )
        push_dev = PushDevice.objects.get(installation=self.installation)
        self.assertTrue(push_dev.is_active)

        # Setup and restore
        key = self.client.post(reverse("recovery-setup")).data["recovery_key"]
        anon = APIClient()
        res = anon.post(reverse("recovery-restore"), {"recovery_key": key}, format="json")
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        # Obsolete push device registration is deactivated
        push_dev.refresh_from_db()
        self.assertFalse(push_dev.is_active)

    def test_recovery_restore_expiring_lockout_prevents_dos(self):
        key = self.client.post(reverse("recovery-setup")).data["recovery_key"]
        normalized = normalize_recovery_key(key)
        lookup_id = normalized[:6]
        # Construct an invalid key with the valid lookup_id and valid checksum, but wrong secret
        wrong_payload = lookup_id + "A" * 24
        chk_val = compute_checksum_10bit(wrong_payload)
        chk_chars = encode_checksum_chars(chk_val)
        wrong_key = "SF-" + wrong_payload + chk_chars

        anon = APIClient()
        cred = RecoveryCredential.objects.get(lookup_id=lookup_id)

        # 4 failed attempts: credential remains active without lockout
        for _ in range(4):
            res = anon.post(reverse("recovery-restore"), {"recovery_key": wrong_key}, format="json")
            self.assertEqual(res.status_code, status.HTTP_401_UNAUTHORIZED)
        cred.refresh_from_db()
        self.assertEqual(cred.failed_attempts, 4)
        self.assertIsNone(cred.lockout_until)

        # 5th failed attempt triggers temporary 15-minute lockout
        res_5 = anon.post(reverse("recovery-restore"), {"recovery_key": wrong_key}, format="json")
        self.assertEqual(res_5.status_code, status.HTTP_401_UNAUTHORIZED)
        cred.refresh_from_db()
        self.assertIsNotNone(cred.lockout_until)
        self.assertTrue(cred.lockout_until > timezone.now())

        # Attempting restore during lockout window fails even with the VALID key
        res_during_lockout = anon.post(reverse("recovery-restore"), {"recovery_key": key}, format="json")
        self.assertEqual(res_during_lockout.status_code, status.HTTP_401_UNAUTHORIZED)

        # Fast-forward time past lockout: valid key now SUCCEEDS (preventing permanent DoS)
        cred.lockout_until = timezone.now() - datetime.timedelta(seconds=1)
        cred.save(update_fields=["lockout_until"])

        res_after_lockout = anon.post(reverse("recovery-restore"), {"recovery_key": key}, format="json")
        self.assertEqual(res_after_lockout.status_code, status.HTTP_200_OK)

    def test_recovery_restore_rate_limiting(self):
        cache.clear()
        try:
            anon = APIClient()
            url = reverse("recovery-restore")
            invalid_key = "SF-00000000000000000000000000000000"

            # 10 attempts allowed under 10/hour throttle
            for _ in range(10):
                res = anon.post(url, {"recovery_key": invalid_key}, format="json")
                self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

            # 11th attempt is rate-limited
            res_throttled = anon.post(url, {"recovery_key": invalid_key}, format="json")
            self.assertEqual(res_throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        finally:
            cache.clear()

    def test_recovery_restore_generic_error_responses(self):
        anon = APIClient()

        # 1. Invalid checksum
        res_chk = anon.post(reverse("recovery-restore"), {"recovery_key": "SF-0000-0000-0000-0000-0000-0000-0000-0000"}, format="json")
        self.assertEqual(res_chk.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(res_chk.data["error"], "Invalid or expired recovery key.")

        # 2. Non-existent lookup ID with valid checksum
        dummy_payload = "ZZZZZZ" + "9" * 24
        chk_val = compute_checksum_10bit(dummy_payload)
        chk_chars = encode_checksum_chars(chk_val)
        fake_key = "SF-" + dummy_payload + chk_chars

        res_missing = anon.post(reverse("recovery-restore"), {"recovery_key": fake_key}, format="json")
        self.assertEqual(res_missing.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res_missing.data["error"], "Invalid or expired recovery key.")

    def test_recovery_restore_transactional_rollback_on_failure(self):
        key = self.client.post(reverse("recovery-setup")).data["recovery_key"]
        old_token_hash = self.installation.token_hash

        anon = APIClient()
        # Simulate database failure during Installation.save inside the atomic block
        with patch.object(Installation, "save", side_effect=RuntimeError("Simulated DB failure")):
            with self.assertRaises(RuntimeError):
                anon.post(reverse("recovery-restore"), {"recovery_key": key}, format="json")

        # Entire transaction rolled back: token hash is unchanged, credential is still active
        self.installation.refresh_from_db()
        self.assertEqual(self.installation.token_hash, old_token_hash)
        cred = RecoveryCredential.objects.get(installation=self.installation)
        self.assertTrue(cred.is_active)


class RecoverySetupConcurrencyTests(APITransactionTestCase):
    """
    Tests serialization and single-active-credential enforcement for RecoverySetupView.
    Note: SQLite test runner enforces file/table locking and does not prove PostgreSQL MVCC
    row-level locking (select_for_update); this test verifies application serialization logic,
    rotation behavior, and database-level partial unique constraint enforcement.
    """

    def setUp(self):
        super().setUp()
        cache.clear()
        from django.db import connection
        if connection.vendor == "sqlite":
            with connection.cursor() as cursor:
                cursor.execute("PRAGMA journal_mode=WAL;")
                cursor.execute("PRAGMA busy_timeout=10000;")
        self.raw_token = "primary-installation-secret-token-32b"
        self.installation = Installation.objects.create(
            token_hash=Installation.hash_token(self.raw_token),
            device_name="Primary Android Phone",
        )
        self.client.credentials(
            HTTP_X_INSTALLATION_ID=str(self.installation.id),
            HTTP_X_INSTALLATION_TOKEN=self.raw_token,
        )

    def tearDown(self):
        cache.clear()
        from django.db import connection, connections
        connections.close_all()
        super().tearDown()

    def test_setup_rotates_previous_credential_and_leaves_exactly_one_active(self):
        res_1 = self.client.post(reverse("recovery-setup"))
        self.assertEqual(res_1.status_code, status.HTTP_201_CREATED)
        key_1 = res_1.data["recovery_key"]

        self.assertEqual(
            RecoveryCredential.objects.filter(installation=self.installation, is_active=True).count(),
            1,
        )

        res_2 = self.client.post(reverse("recovery-setup"))
        self.assertEqual(res_2.status_code, status.HTTP_201_CREATED)
        key_2 = res_2.data["recovery_key"]
        self.assertNotEqual(key_1, key_2)

        self.assertEqual(
            RecoveryCredential.objects.filter(installation=self.installation, is_active=True).count(),
            1,
        )
        self.assertEqual(
            RecoveryCredential.objects.filter(installation=self.installation).count(),
            2,
        )

    def test_database_constraint_rejects_multiple_active_credentials_for_same_installation(self):
        from django.db import IntegrityError
        RecoveryCredential.objects.create(
            installation=self.installation,
            lookup_id="LOOKUP_ACTIVE_1",
            key_hash="hash1",
            salt="salt1",
            is_active=True,
        )

        with self.assertRaises(IntegrityError):
            RecoveryCredential.objects.create(
                installation=self.installation,
                lookup_id="LOOKUP_ACTIVE_2",
                key_hash="hash2",
                salt="salt2",
                is_active=True,
            )

        # Inactive credentials can coexist
        inactive = RecoveryCredential.objects.create(
            installation=self.installation,
            lookup_id="LOOKUP_INACTIVE_1",
            key_hash="hash3",
            salt="salt3",
            is_active=False,
        )
        self.assertFalse(inactive.is_active)

    def test_concurrent_or_serialized_setup_guarantees_single_active_credential(self):
        """
        Simulates multiple setup requests targeting the same installation.
        Verifies that after completion, exactly one active recovery credential remains.
        """
        import threading

        responses = []
        errors = []

        def worker():
            from rest_framework.test import APIClient
            from django.db import connections
            c = APIClient()
            c.credentials(
                HTTP_X_INSTALLATION_ID=str(self.installation.id),
                HTTP_X_INSTALLATION_TOKEN=self.raw_token,
            )
            try:
                r = c.post(reverse("recovery-setup"))
                responses.append(r)
            except Exception as e:
                errors.append(e)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=worker) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)
            self.assertFalse(t.is_alive(), "Worker thread did not finish within bounded 10s timeout.")

        from django.db import connections
        connections.close_all()

        # 1. Assert no unexpected worker exceptions occurred
        self.assertEqual(errors, [], f"Worker threads encountered unexpected exceptions: {errors}")

        # 2. Assert every request was completed and returned HTTP 201 Created
        self.assertEqual(len(responses), len(threads), "All concurrent setup requests must complete.")
        for resp in responses:
            self.assertEqual(
                resp.status_code,
                status.HTTP_201_CREATED,
                f"Expected HTTP 201 from recovery-setup, got {resp.status_code}: {getattr(resp, 'data', None)}",
            )
            self.assertIn("recovery_key", resp.data)

        # 3. Assert exactly ONE active credential exists for this installation
        active_count = RecoveryCredential.objects.filter(installation=self.installation, is_active=True).count()
        self.assertEqual(active_count, 1, "There must be exactly one active recovery credential.")

        # 4. Total credentials count must match the number of completed setup operations
        total_count = RecoveryCredential.objects.filter(installation=self.installation).count()
        self.assertEqual(total_count, len(threads), "All previous credentials must be rotated into inactive state.")


class RecoveryConcurrentRestoreTests(APITransactionTestCase):
    """
    Multithreaded concurrency tests using APITransactionTestCase to allow cross-thread DB visibility.
    """

    def setUp(self):
        super().setUp()
        cache.clear()
        from django.db import connection
        if connection.vendor == "sqlite":
            with connection.cursor() as cursor:
                cursor.execute("PRAGMA journal_mode=WAL;")
                cursor.execute("PRAGMA busy_timeout=10000;")
        self.raw_token = "primary-installation-secret-token-32b"
        self.installation = Installation.objects.create(
            token_hash=Installation.hash_token(self.raw_token),
            device_name="Primary Android Phone",
        )
        self.client.credentials(
            HTTP_X_INSTALLATION_ID=str(self.installation.id),
            HTTP_X_INSTALLATION_TOKEN=self.raw_token,
        )

    def tearDown(self):
        cache.clear()
        from django.db import connections
        connections.close_all()
        super().tearDown()

    def test_recovery_restore_concurrent_requests_sqlite(self):
        """
        Tests race condition handling on the test runner.
        Demonstrates that once the active credential is processed and rotated,
        any concurrent or subsequent request with the same recovery key is rejected with HTTP 401.
        """
        key = self.client.post(reverse("recovery-setup")).data["recovery_key"]

        client_1 = APIClient()
        client_2 = APIClient()

        # Request 1 claims the recovery key
        res_1 = client_1.post(
            reverse("recovery-restore"),
            {"recovery_key": key, "device_name": "Device 1"},
            format="json",
        )
        self.assertEqual(res_1.status_code, status.HTTP_200_OK)

        # Request 2 attempting to claim the same recovery key is rejected
        res_2 = client_2.post(
            reverse("recovery-restore"),
            {"recovery_key": key, "device_name": "Device 2"},
            format="json",
        )
        self.assertEqual(res_2.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(res_2.data["error"], "Invalid or expired recovery key.")


class PostgresConcurrentRestoreIntegrationTests(APITestCase):
    """
    Integration test designed to verify PostgreSQL row-level locking (select_for_update)
    across isolated database connections when a dedicated PostgreSQL test database is configured.
    """

    def test_postgres_concurrent_restore_serialization(self):
        postgres_test_url = os.getenv("TEST_POSTGRES_DB_URL")
        if not postgres_test_url:
            self.skipTest(
                "Skipping PostgreSQL concurrency test: No PostgreSQL test database URL configured "
                "(TEST_POSTGRES_DB_URL). SQLite alone cannot prove PostgreSQL row-locking behavior."
            )

        # Strict safety guard: Disallow pointing to production Supabase
        lower_url = postgres_test_url.lower()
        if "supabase.co" in lower_url or "pooler.supabase.com" in lower_url:
            from django.core.exceptions import ImproperlyConfigured
            raise ImproperlyConfigured(
                "TEST_POSTGRES_DB_URL is prohibited from targeting production Supabase. "
                "Tests must run exclusively against a dedicated disposable PostgreSQL database."
            )

        import threading
        import time
        import uuid
        import psycopg

        # 1. Connect to isolated test database and prepare disposable test table
        with psycopg.connect(postgres_test_url, autocommit=True) as admin_conn:
            with admin_conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS test_disposable_recovery (
                        id UUID PRIMARY KEY,
                        lookup_id VARCHAR(64) UNIQUE,
                        is_active BOOLEAN
                    )
                    """
                )
                test_id = uuid.uuid4()
                test_lookup = f"TEST_{test_id.hex[:8]}"
                cur.execute(
                    "INSERT INTO test_disposable_recovery (id, lookup_id, is_active) VALUES (%s, %s, %s)",
                    (test_id, test_lookup, True),
                )

        results = {}

        def thread_1_work():
            try:
                with psycopg.connect(postgres_test_url) as conn1:
                    with conn1.cursor() as cur1:
                        cur1.execute(
                            "SELECT id, is_active FROM test_disposable_recovery WHERE lookup_id = %s FOR UPDATE",
                            (test_lookup,),
                        )
                        row = cur1.fetchone()
                        results["t1_read_active"] = row[1] if row else None
                        time.sleep(0.3)  # Hold lock to demonstrate serialization
                        cur1.execute(
                            "UPDATE test_disposable_recovery SET is_active = FALSE WHERE lookup_id = %s",
                            (test_lookup,),
                        )
                    conn1.commit()
                results["t1_success"] = True
            except Exception as e:
                results["t1_error"] = str(e)

        def thread_2_work():
            time.sleep(0.05)  # Let Thread 1 acquire lock first
            try:
                with psycopg.connect(postgres_test_url) as conn2:
                    with conn2.cursor() as cur2:
                        # Will block on row-lock until Thread 1 commits
                        cur2.execute(
                            "SELECT id, is_active FROM test_disposable_recovery WHERE lookup_id = %s AND is_active = TRUE FOR UPDATE",
                            (test_lookup,),
                        )
                        row = cur2.fetchone()
                        results["t2_row"] = row  # Must be None because Thread 1 set is_active=FALSE before commit
                    conn2.commit()
                results["t2_success"] = True
            except Exception as e:
                results["t2_error"] = str(e)

        t1 = threading.Thread(target=thread_1_work)
        t2 = threading.Thread(target=thread_2_work)
        t1.start()
        t2.start()
        t1.join(timeout=5)
        t2.join(timeout=5)

        # Cleanup disposable test table
        try:
            with psycopg.connect(postgres_test_url, autocommit=True) as admin_conn:
                with admin_conn.cursor() as cur:
                    cur.execute("DROP TABLE IF EXISTS test_disposable_recovery")
        except Exception:
            pass

        self.assertTrue(results.get("t1_success"), f"Thread 1 failed: {results.get('t1_error')}")
        self.assertTrue(results.get("t2_success"), f"Thread 2 failed: {results.get('t2_error')}")
        self.assertTrue(results.get("t1_read_active"))
        self.assertIsNone(results.get("t2_row"), "Thread 2 must observe serialized update and read 0 active rows.")
