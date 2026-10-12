import logging
import requests
from .models import PushDevice

logger = logging.getLogger(__name__)

EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send"


def send_low_stock_push_notification(product):
    """
    Sends remote Expo push notifications to all registered active devices
    when a product crosses from above threshold to at or below reorder_level.
    This enables alert delivery even when the StockFlow mobile app is closed/terminated.
    """
    devices = PushDevice.objects.filter(is_active=True)
    if not devices.exists():
        return 0

    is_zero = product.quantity == 0
    title = f"Restock Needed: {product.name}" if is_zero else f"Low Stock Alert: {product.name}"
    body = (
        f"{product.name} is out of stock! Current quantity: 0 (Threshold: {product.reorder_level}). Restock required."
        if is_zero
        else f"{product.name} is running low! Current quantity: {product.quantity} (Threshold: {product.reorder_level}). Restock needed."
    )

    messages = []
    for device in devices:
        raw_token = device.expo_push_token
        if not raw_token or not isinstance(raw_token, str):
            continue
        token = raw_token.strip()
        # Expo push tokens format: ExponentPushToken[...] or ExpoPushToken[...]
        if not (token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")):
            logger.debug("Skipping invalid Expo push token for device %s", device.id)
            continue

        messages.append({
            "to": token,
            "sound": "default",
            "title": title,
            "body": body,
            "data": {
                "productId": product.id,
                "productName": product.name,
                "quantity": product.quantity,
                "threshold": product.reorder_level,
                "type": "restock",
            },
            "channelId": "inventory-alerts",
            "priority": "high",
        })

    if not messages:
        return 0

    try:
        response = requests.post(
            EXPO_PUSH_API_URL,
            json=messages,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            timeout=5,
        )
        if response.ok:
            logger.info("Dispatched %d Expo push notification(s) for product %s (%s)", len(messages), product.id, product.name)
            return len(messages)
        else:
            logger.warning("Expo push API returned HTTP %s for product %s", response.status_code, product.id)
            return 0
    except requests.exceptions.Timeout:
        logger.warning("Expo push API request timed out after 5s for product %s", product.id)
        return 0
    except requests.exceptions.RequestException as exc:
        logger.warning("Expo push API request error for product %s: %s", product.id, type(exc).__name__)
        return 0
    except Exception as exc:
        logger.warning("Unexpected error dispatching push notification for product %s: %s", product.id, type(exc).__name__)
        return 0
