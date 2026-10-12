from django.contrib import admin
from .models import Product, PushDevice, Task

admin.site.register(Product)
admin.site.register(PushDevice)
admin.site.register(Task)
