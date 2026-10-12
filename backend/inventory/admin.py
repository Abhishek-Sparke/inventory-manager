from django.contrib import admin
from .models import Product, PushDevice, Task, DailyProgress

admin.site.register(Product)
admin.site.register(PushDevice)
admin.site.register(Task)
admin.site.register(DailyProgress)
