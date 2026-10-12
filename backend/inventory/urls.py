from django.urls import path
from .views import (
    ProductListCreateView,
    ProductDetailView,
    TaskListCreateView,
    TaskDetailView,
    DailyProgressListCreateView,
    DailyProgressDetailView,
    DailyProgressByDateView,
    register_push_device,
)

urlpatterns = [
    path("products/", ProductListCreateView.as_view(), name="product-list-create"),
    path("products/<int:pk>/", ProductDetailView.as_view(), name="product-detail"),
    path("tasks/", TaskListCreateView.as_view(), name="task-list-create"),
    path("tasks/<int:pk>/", TaskDetailView.as_view(), name="task-detail"),
    path("daily-progress/", DailyProgressListCreateView.as_view(), name="daily-progress-list-create"),
    path("daily-progress/<int:pk>/", DailyProgressDetailView.as_view(), name="daily-progress-detail"),
    path("daily-progress/date/<str:date>/", DailyProgressByDateView.as_view(), name="daily-progress-by-date"),
    path(
        "notifications/register/",
        register_push_device,
        name="register-push-device",
    ),
]
