from rest_framework import generics, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models import Product, PushDevice, Task, DailyProgress
from .serializers import ProductSerializer, TaskSerializer, DailyProgressSerializer


class ProductListCreateView(generics.ListCreateAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer


class ProductDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer


class TaskListCreateView(generics.ListCreateAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        queryset = Task.objects.all()
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


class TaskDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer


class DailyProgressListCreateView(generics.ListCreateAPIView):
    serializer_class = DailyProgressSerializer

    def get_queryset(self):
        queryset = DailyProgress.objects.all()
        date_param = self.request.query_params.get("date")
        if date_param:
            queryset = queryset.filter(date=date_param)

        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")
        if start_date:
            queryset = queryset.filter(date__gte=start_date)
        if end_date:
            queryset = queryset.filter(date__lte=end_date)

        return queryset

    def create(self, request, *args, **kwargs):
        # Support idempotent upsert based on date
        target_date = request.data.get("date")
        if target_date:
            existing = DailyProgress.objects.filter(date=target_date).first()
            if existing:
                serializer = self.get_serializer(existing, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)
                serializer.save()
                return Response(serializer.data, status=status.HTTP_200_OK)
        return super().create(request, *args, **kwargs)


class DailyProgressDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = DailyProgress.objects.all()
    serializer_class = DailyProgressSerializer


class DailyProgressByDateView(generics.GenericAPIView):
    serializer_class = DailyProgressSerializer

    def get(self, request, date):
        progress = DailyProgress.objects.filter(date=date).first()
        if not progress:
            return Response(
                {"date": date, "description": "", "achievements": "", "blockers": "", "next_steps": "", "notes": ""},
                status=status.HTTP_200_OK,
            )
        serializer = self.get_serializer(progress)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def put(self, request, date):
        progress, _ = DailyProgress.objects.get_or_create(date=date)
        serializer = self.get_serializer(progress, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, date):
        progress = DailyProgress.objects.filter(date=date).first()
        if progress:
            progress.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        return Response({"detail": "Not found"}, status=status.HTTP_404_NOT_FOUND)



@api_view(["POST"])
def register_push_device(request):
    token = request.data.get("expo_push_token")
    device_name = request.data.get("device_name", "")

    if not token:
        return Response(
            {"error": "expo_push_token is required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    device, created = PushDevice.objects.update_or_create(
        expo_push_token=token,
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

