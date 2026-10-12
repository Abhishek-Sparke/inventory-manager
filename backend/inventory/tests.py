from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase
from .models import Task, Product


class TaskAPITests(APITestCase):
    def setUp(self):
        self.task = Task.objects.create(
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
        self.assertEqual(Task.objects.count(), 2)

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
        self.assertEqual(Task.objects.count(), 0)

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
            title="Today Task",
            scheduled_at="2026-10-12T14:00:00Z",
            status="pending",
        )
        Task.objects.create(
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


class DailyProgressAPITests(APITestCase):
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



class ProductAPIIntegrityTests(APITestCase):
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
        from inventory.models import PushDevice
        from inventory.notifications import send_low_stock_push_notification

        PushDevice.objects.create(expo_push_token="InvalidTokenString", device_name="Bad Device")
        PushDevice.objects.create(expo_push_token="ExponentPushToken[valid-test-token]", device_name="Good Device")

        product_low = Product.objects.create(name="Green Tea", sku="TEA-01", price="5.00", quantity=3, reorder_level=5)
        product_zero = Product.objects.create(name="Black Tea", sku="TEA-02", price="5.00", quantity=0, reorder_level=5)

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


