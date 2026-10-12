from rest_framework import serializers
from .models import Product, Task, DailyProgress


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = "__all__"


class TaskSerializer(serializers.ModelSerializer):
    journal_entry = serializers.SerializerMethodField(read_only=True)
    daily_progress = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Task
        fields = "__all__"

    def get_journal_entry(self, obj):
        if obj.notes:
            return obj.notes
        dp = obj.linked_daily_progress.first()
        if dp and dp.description:
            return dp.description
        return obj.description or ""

    def get_daily_progress(self, obj):
        dp = obj.linked_daily_progress.first()
        if not dp and obj.scheduled_at:
            dp = DailyProgress.objects.filter(date=obj.scheduled_at.date()).first()
        if dp:
            return {
                "id": dp.id,
                "date": str(dp.date),
                "description": dp.description,
                "notes": dp.notes,
            }
        return None

    def _sync_daily_progress(self, task):
        journal_note = (task.notes or task.description or "").strip()
        if not journal_note or not task.scheduled_at:
            return

        task_date = task.scheduled_at.date()
        dp = DailyProgress.objects.filter(date=task_date).first()
        if dp:
            if not dp.description:
                dp.description = journal_note
            elif journal_note not in dp.description:
                dp.description = f"{dp.description}\n• [{task.title}]: {journal_note}"
            if not dp.linked_task_id:
                dp.linked_task = task
            dp.save()
        else:
            DailyProgress.objects.create(
                date=task_date,
                description=journal_note,
                linked_task=task,
            )

    def validate(self, attrs):
        scheduled_at = attrs.get("scheduled_at", getattr(self.instance, "scheduled_at", None))
        end_at = attrs.get("end_at", getattr(self.instance, "end_at", None))
        if scheduled_at and end_at and end_at < scheduled_at:
            raise serializers.ValidationError({"end_at": "End time cannot be earlier than start time."})
        return attrs

    def create(self, validated_data):
        is_completed = validated_data.get("is_completed")
        status = validated_data.get("status")
        if status == "completed":
            validated_data["is_completed"] = True
        elif status in ("pending", "in_progress") and is_completed is None:
            validated_data["is_completed"] = False
        elif is_completed is True:
            validated_data["status"] = "completed"
        elif is_completed is False and status is None:
            validated_data["status"] = "pending"
        task = super().create(validated_data)
        self._sync_daily_progress(task)
        return task

    def update(self, instance, validated_data):
        if "is_completed" in validated_data and not validated_data["is_completed"]:
            if "status" not in validated_data or validated_data["status"] == "completed":
                validated_data["status"] = "pending"
        elif validated_data.get("is_completed") is True:
            validated_data["status"] = "completed"
        elif validated_data.get("status") == "completed":
            validated_data["is_completed"] = True
        elif validated_data.get("status") in ("pending", "in_progress") and "is_completed" not in validated_data:
            validated_data["is_completed"] = False
        task = super().update(instance, validated_data)
        self._sync_daily_progress(task)
        return task



class DailyProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyProgress
        fields = "__all__"
