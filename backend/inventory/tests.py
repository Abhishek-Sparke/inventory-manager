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


class ProductAPIIntegrityTests(APITestCase):
    def test_existing_product_list(self):
        url = reverse("product-list-create")
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)


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


