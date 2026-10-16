import { Platform } from 'react-native';
import { getLocalDateString, parseDateString } from '@/utils/timezone';
import {
  isExpoGoClient,
  sendImmediateNotificationAsync,
  INVENTORY_ALERTS_CHANNEL_ID,
} from '@/services/notifications';

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
  currentQuantity?: number;
  reorderLevel?: number;
  daysLeft?: number;
};

export interface ProductAlertState {
  productId: number;
  lastQuantity: number;
  threshold: number;
  isLowStock: boolean;
  alertDelivered: boolean;
  lastAlertTimestamp?: number;
}

export interface InventoryTransitionResult {
  alertsToDispatch: Array<{
    product: Product;
    alertType: 'low_stock' | 'out_of_stock';
    title: string;
    body: string;
  }>;
  nextStore: Record<number, ProductAlertState>;
  replenishedProductIds: number[];
}

// In-memory alert tracking store
let alertStateStore: Record<number, ProductAlertState> = {};
let isStoreInitialized = false;

// Tracks alert signatures delivered for expiry alerts
const deliveredExpiryKeys = new Set<string>();

const STORAGE_FILE_NAME = 'stockflow_inventory_alert_state.json';
const WEB_STORAGE_KEY = 'stockflow_inventory_alert_state';

function getFileSystem() {
  if (Platform.OS === 'web') return null;
  try {
    return require('expo-file-system');
  } catch {
    return null;
  }
}

/**
 * Loads persisted inventory alert tracking store from device storage or web localStorage.
 */
export async function loadAlertStoreAsync(): Promise<Record<number, ProductAlertState>> {
  if (isStoreInitialized) {
    return alertStateStore;
  }

  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const raw = window.localStorage.getItem(WEB_STORAGE_KEY);
        if (raw) {
          alertStateStore = JSON.parse(raw);
          isStoreInitialized = true;
          return alertStateStore;
        }
      }
    } catch {}
    isStoreInitialized = true;
    return alertStateStore;
  }

  const FileSystem = getFileSystem();
  if (FileSystem && FileSystem.documentDirectory) {
    try {
      const fileUri = `${FileSystem.documentDirectory}${STORAGE_FILE_NAME}`;
      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) {
        const content = await FileSystem.readAsStringAsync(fileUri);
        if (content) {
          alertStateStore = JSON.parse(content);
          isStoreInitialized = true;
          return alertStateStore;
        }
      }
    } catch (err) {
      console.warn('[InventoryAlerts] Could not read alert state from file:', err);
    }
  }

  isStoreInitialized = true;
  return alertStateStore;
}

/**
 * Persists inventory alert tracking store to device storage or web localStorage.
 */
export async function saveAlertStoreAsync(
  store: Record<number, ProductAlertState>
): Promise<void> {
  alertStateStore = { ...store };
  isStoreInitialized = true;

  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(WEB_STORAGE_KEY, JSON.stringify(store));
      }
    } catch {}
    return;
  }

  const FileSystem = getFileSystem();
  if (FileSystem && FileSystem.documentDirectory) {
    try {
      const fileUri = `${FileSystem.documentDirectory}${STORAGE_FILE_NAME}`;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(store));
    } catch (err) {
      console.warn('[InventoryAlerts] Could not write alert state to file:', err);
    }
  }
}

/**
 * Resets the in-memory and persistent alert tracking store (useful for tests and resets).
 */
export async function resetAlertStoreAsync(): Promise<void> {
  alertStateStore = {};
  isStoreInitialized = false;
  deliveredExpiryKeys.clear();

  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(WEB_STORAGE_KEY);
      }
    } catch {}
    return;
  }

  const FileSystem = getFileSystem();
  if (FileSystem && FileSystem.documentDirectory) {
    try {
      const fileUri = `${FileSystem.documentDirectory}${STORAGE_FILE_NAME}`;
      const info = await FileSystem.getInfoAsync(fileUri);
      if (info.exists) {
        await FileSystem.deleteAsync(fileUri);
      }
    } catch {}
  }
}

/**
 * Pure state machine evaluator that detects:
 * 1. Low-stock / out-of-stock threshold crossings (triggers notification alert).
 * 2. Unresolved low-stock conditions (suppresses duplicate notifications).
 * 3. Stock replenishment above threshold (resets alert state so subsequent drops can re-trigger).
 */
export function evaluateInventoryAlertTransitions(
  products: Product[],
  currentStore: Record<number, ProductAlertState>
): InventoryTransitionResult {
  const nextStore: Record<number, ProductAlertState> = { ...currentStore };
  const alertsToDispatch: InventoryTransitionResult['alertsToDispatch'] = [];
  const replenishedProductIds: number[] = [];

  for (const product of products) {
    const qty = Number(product.quantity ?? 0);
    const threshold = Number(product.reorder_level ?? 10);
    const isLow = qty <= threshold;
    const isZero = qty === 0;
    const prev = currentStore[product.id];

    if (!isLow) {
      // 1. Stock is above threshold (healthy / replenished)
      if (prev && prev.isLowStock) {
        // Was previously low, now replenished!
        replenishedProductIds.push(product.id);
      }

      // Reset alert state so future drops below threshold trigger a new alert
      nextStore[product.id] = {
        productId: product.id,
        lastQuantity: qty,
        threshold,
        isLowStock: false,
        alertDelivered: false,
      };
    } else {
      // 2. Stock is at or below threshold (low-stock or out-of-stock)
      const isThresholdCrossing = !prev || !prev.isLowStock || !prev.alertDelivered;

      if (isThresholdCrossing) {
        // Trigger alert!
        const title = isZero
          ? `🚨 Restock Needed: ${product.name}`
          : `⚠️ Low Stock Alert: ${product.name}`;
        const body = isZero
          ? `${product.name} is out of stock! Current quantity: 0 (Threshold: ${threshold}). Restock required.`
          : `${product.name} is running low! Current quantity: ${qty} (Threshold: ${threshold}). Restock needed.`;

        alertsToDispatch.push({
          product,
          alertType: isZero ? 'out_of_stock' : 'low_stock',
          title,
          body,
        });

        nextStore[product.id] = {
          productId: product.id,
          lastQuantity: qty,
          threshold,
          isLowStock: true,
          alertDelivered: true,
          lastAlertTimestamp: Date.now(),
        };
      } else {
        // Unresolved condition already alerted:
        // DUPLICATE SUPPRESSION - preserve alertDelivered=true without re-notifying
        nextStore[product.id] = {
          ...prev,
          lastQuantity: qty,
          threshold,
        };
      }
    }
  }

  return {
    alertsToDispatch,
    nextStore,
    replenishedProductIds,
  };
}

/**
 * Evaluates all product inventory for restock alerts and expiry warnings (for UI and badges).
 */
export function evaluateProductAlerts(
  products: Product[],
  advanceWarningDays = 7
): {
  restockAlerts: ProductAlert[];
  expiryAlerts: ProductAlert[];
  allAlerts: ProductAlert[];
} {
  const startMs = Date.now();
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
        id: `restock-${product.id}`,
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        type: 'restock',
        title: isZero ? `Out of Stock: ${product.name}` : `Low Stock: ${product.name}`,
        message: isZero
          ? `${product.name} is out of stock! Current quantity: 0 (Reorder level: ${reorder}). Immediate replenishment needed.`
          : `${product.name} has ${qty} unit${qty === 1 ? '' : 's'} remaining (Reorder level: ${reorder}). Restock needed.`,
        severity: isZero ? 'critical' : 'warning',
        currentQuantity: qty,
        reorderLevel: reorder,
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
            id: `expiry-expired-${product.id}`,
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
            id: `expiry-soon-${product.id}`,
            productId: product.id,
            productName: product.name,
            sku: product.sku,
            type: 'expiring_soon',
            title: `Expiring Soon: ${product.name}`,
            message: diffDays === 0
              ? `${product.name} expires today! Prioritize usage or discounting.`
              : `${product.name} expires in ${diffDays} day${diffDays === 1 ? '' : 's'} (${product.expiry_date}).`,
            severity: diffDays <= 2 ? 'warning' : 'info',
            daysLeft: diffDays,
          });
        }
      }
    }
  }

  const elapsed = Date.now() - startMs;
  console.log(`[StartupTiming] Inventory alert calculation: ${elapsed}ms (${products.length} products evaluated)`);
  console.log(`[AlertsDiagnostic] Evaluated ${products.length} products in ${elapsed}ms: ${restockAlerts.length} restock alerts, ${expiryAlerts.length} expiry alerts`);

  return {
    restockAlerts,
    expiryAlerts,
    allAlerts: [...restockAlerts, ...expiryAlerts],
  };
}

/**
 * Evaluates inventory transitions and triggers OS notifications for threshold crossings.
 * Handles duplicate suppression, replenishment resets, and persistence across app restarts.
 */
export async function syncInventoryAlertNotificationsAsync(
  productsOrAlerts: Product[] | ProductAlert[],
  optionalAlerts?: ProductAlert[]
): Promise<void> {
  if (Platform.OS === 'web' || isExpoGoClient()) {
    return;
  }

  try {
    // 1. Load persisted alert store if not loaded yet
    const currentStore = await loadAlertStoreAsync();

    // Determine products and alerts from arguments
    let products: Product[] = [];
    let alerts: ProductAlert[] = [];

    if (Array.isArray(productsOrAlerts) && productsOrAlerts.length > 0) {
      if ('quantity' in productsOrAlerts[0]) {
        products = productsOrAlerts as Product[];
        alerts = optionalAlerts || evaluateProductAlerts(products).allAlerts;
      } else {
        alerts = productsOrAlerts as ProductAlert[];
      }
    }

    // 2. Evaluate low-stock threshold transitions
    if (products.length > 0) {
      const { alertsToDispatch, nextStore } = evaluateInventoryAlertTransitions(
        products,
        currentStore
      );

      // Dispatch OS notifications for threshold crossings
      for (const item of alertsToDispatch) {
        await sendImmediateNotificationAsync({
          title: item.title,
          body: item.body,
          data: {
            productId: item.product.id,
            productName: item.product.name,
            quantity: item.product.quantity,
            threshold: item.product.reorder_level,
            type: item.alertType,
          },
          channelId: INVENTORY_ALERTS_CHANNEL_ID,
        });
      }

      // Persist updated state
      await saveAlertStoreAsync(nextStore);
    }

    // 3. Handle expiry alerts without duplicate spamming
    for (const alert of alerts) {
      if (alert.type === 'expired' || alert.type === 'expiring_soon') {
        const key = `${alert.type}-${alert.productId}-${alert.daysLeft}`;
        if (!deliveredExpiryKeys.has(key)) {
          deliveredExpiryKeys.add(key);
          await sendImmediateNotificationAsync({
            title: alert.title,
            body: alert.message,
            data: { productId: alert.productId, type: alert.type },
            channelId: INVENTORY_ALERTS_CHANNEL_ID,
          });
        }
      }
    }
  } catch (err) {
    console.warn('[InventoryAlerts] Could not trigger native notification:', err);
  }
}
