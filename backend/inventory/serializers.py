from rest_framework import serializers
from .models import Product, Task, DailyProgress


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = "__all__"


class TaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = "__all__"

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
        return super().create(validated_data)

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
        return super().update(instance, validated_data)



class DailyProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyProgress
        fields = "__all__"
