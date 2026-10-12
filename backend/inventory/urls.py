from django.urls import path
from .views import (
    ProductListCreateView,
    ProductDetailView,
    TaskListCreateView,
    TaskDetailView,
    register_push_device,
)

urlpatterns = [
    path("products/", ProductListCreateView.as_view(), name="product-list-create"),
    path("products/<int:pk>/", ProductDetailView.as_view(), name="product-detail"),
    path("tasks/", TaskListCreateView.as_view(), name="task-list-create"),
    path("tasks/<int:pk>/", TaskDetailView.as_view(), name="task-detail"),
    path(
        "notifications/register/",
        register_push_device,
        name="register-push-device",
    ),
]
