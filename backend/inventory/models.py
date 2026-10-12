
from django.db import models


class Product(models.Model):
    name = models.CharField(max_length=150)
    sku = models.CharField(max_length=50, unique=True)
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

    def __str__(self):
        return f"{self.name} ({self.sku})"


class PushDevice(models.Model):
    expo_push_token = models.CharField(max_length=255, unique=True)
    device_name = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

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
    date = models.DateField(unique=True, db_index=True)
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
        ]

    def __str__(self):
        return f"Daily Progress for {self.date}"
