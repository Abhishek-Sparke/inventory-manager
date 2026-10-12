import { Platform } from 'react-native';
import { getLocalDateString, parseDateString } from '@/utils/timezone';
import { isExpoGoClient } from '@/services/notifications';

export type Product = {
  id: number;
  name: string;
  sku: string;
  category?: string;
  description?: string;
  quantity: number;
  reorder_level: number;
  price: number | string;
  expiry_date?: string | null;
};

export type ProductAlert = {
  id: string;
  productId: number;
  productName: string;
  sku: string;
  type: 'restock' | 'expired' | 'expiring_soon';
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  daysLeft?: number;
};

// Tracks alert signatures that were already delivered as OS notifications in this session
const deliveredNotificationKeys = new Set<string>();

/**
 * Evaluates all product inventory for restock alerts and expiry warnings.
 */
export function evaluateProductAlerts(
  products: Product[],
  advanceWarningDays = 7
): {
  restockAlerts: ProductAlert[];
  expiryAlerts: ProductAlert[];
  allAlerts: ProductAlert[];
} {
  const todayStr = getLocalDateString();
  const todayDate = new Date(todayStr + 'T00:00:00');

  const restockAlerts: ProductAlert[] = [];
  const expiryAlerts: ProductAlert[] = [];

  for (const product of products) {
    const qty = Number(product.quantity ?? 0);
    const reorder = Number(product.reorder_level ?? 10);

    // 1. Restock alert: quantity is at or below reorder level
    if (qty <= reorder) {
      const isZero = qty === 0;
      restockAlerts.push({
        id: `restock-${product.id}-${qty}-${reorder}`,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        type: 'restock',
        title: isZero ? `Out of Stock: ${product.name}` : `Low Stock: ${product.name}`,
        message: isZero
          ? `Quantity is 0 (Reorder level: ${reorder}). Immediate replenishment needed.`
          : `Only ${qty} unit${qty === 1 ? '' : 's'} remaining (Reorder level: ${reorder}).`,
        severity: isZero ? 'critical' : 'warning',
      });
    }

    // 2. Expiry alert: evaluate expiry_date if present
    if (product.expiry_date) {
      const { year, month, day } = parseDateString(product.expiry_date);
      const expDate = new Date(year, month - 1, day);

      if (!isNaN(expDate.getTime())) {
        const diffMs = expDate.getTime() - todayDate.getTime();
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          // Expired
          expiryAlerts.push({
            id: `expiry-expired-${product.id}-${product.expiry_date}`,
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            type: 'expired',
            title: `Expired Stock: ${product.name}`,
            message: `Expired on ${product.expiry_date} (${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} ago). Remove from active inventory.`,
            severity: 'critical',
            daysLeft: diffDays,
          });
        } else if (diffDays <= advanceWarningDays) {
          // Expiring soon
          expiryAlerts.push({
            id: `expiry-soon-${product.id}-${product.expiry_date}-${diffDays}`,
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            type: 'expiring_soon',
            title: `Expiring Soon: ${product.name}`,
            message: diffDays === 0
              ? 'Expires today! Prioritize usage or discounting.'
              : `Expires in ${diffDays} day${diffDays === 1 ? '' : 's'} (${product.expiry_date}).`,
            severity: diffDays <= 2 ? 'warning' : 'info',
            daysLeft: diffDays,
          });
        }
      }
    }
  }

  return {
    restockAlerts,
    expiryAlerts,
    allAlerts: [...restockAlerts, ...expiryAlerts],
  };
}

/**
 * Triggers OS notifications for new/changed critical inventory alerts (non-Expo Go native builds).
 */
export async function syncInventoryAlertNotificationsAsync(
  alerts: ProductAlert[]
): Promise<void> {
  if (Platform.OS === 'web' || isExpoGoClient()) {
    return;
  }

  try {
    const Notifications = require('expo-notifications');
    for (const alert of alerts) {
      if (!deliveredNotificationKeys.has(alert.id)) {
        deliveredNotificationKeys.add(alert.id);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: alert.title,
            body: alert.message,
            sound: true,
            data: { productId: alert.productId, type: alert.type },
          },
          trigger: null, // deliver immediately
        });
      }
    }
  } catch (err) {
    console.warn('[InventoryAlerts] Could not trigger native notification:', err);
  }
}
