from rest_framework import generics, status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from .models import Product, PushDevice, Task
from .serializers import ProductSerializer, TaskSerializer


class ProductListCreateView(generics.ListCreateAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer


class ProductDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Product.objects.all()
    serializer_class = ProductSerializer


class TaskListCreateView(generics.ListCreateAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer


class TaskDetailView(generics.RetrieveUpdateDestroyAPIView):
    queryset = Task.objects.all()
    serializer_class = TaskSerializer


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

