
import { useCallback, useEffect, useState } from 'react';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Pressable,
  Alert,
  Platform,
} from 'react-native';

import {
  PRODUCTS_API_URL,
  NOTIFICATIONS_REGISTER_API_URL,
} from '@/constants/api';
import { isExpoGoClient } from '@/services/notifications';

type Product = {
  id: number;
  name: string;
  sku: string;
  category: string;
  description?: string;
  quantity: number;
  reorder_level: number;
  price: number | string;
  expiry_date?: string | null;
};

const API_URL = PRODUCTS_API_URL;

async function registerForPushNotifications() {
  if (Platform.OS === 'web') {
    return null;
  }

  // Expo Go does not support Android remote push notifications.
  // Use an EAS development build or standalone APK for this feature.
  if (Constants.executionEnvironment === 'storeClient' || isExpoGoClient()) {
    console.log(
      'Push notifications require an EAS development build. Skipping registration in Expo Go.'
    );
    return null;
  }
  const Notifications = await import('expo-notifications');

  if (!Device.isDevice) {
    Alert.alert(
      'Physical device required',
      'Test push notifications on a real phone.'
    );
    return null;
  }

  const { status: existingStatus } =
    await Notifications.getPermissionsAsync();

  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } =
      await Notifications.requestPermissionsAsync();

    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    Alert.alert(
      'Permission required',
      'Allow notifications in your phone settings to receive StockFlow alerts.'
    );
    return null;
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  if (!projectId) {
    Alert.alert(
      'Setup required',
      'An Expo EAS project ID is needed for push notifications.'
    );
    return null;
  }

  const token = (
    await Notifications.getExpoPushTokenAsync({ projectId })
  ).data;

  const response = await fetch(NOTIFICATIONS_REGISTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      expo_push_token: token,
      device_name: Device.modelName || 'Android device',
    }),
  });

  if (!response.ok) {
    throw new Error(
      'Could not register this device with StockFlow.'
    );
  }

  Alert.alert(
    'Notifications enabled',
    'Your device is registered for StockFlow alerts.'
  );

  return token;
}


export default function HomeScreen() {

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(''); const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restockingProduct, setRestockingProduct] = useState<Product | null>(null);
  const [restockQuantity, setRestockQuantity] = useState('1');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const [editForm, setEditForm] = useState({
    name: '',
    sku: '',
    category: '',
    description: '',
    price: '',
    quantity: '0',
    reorder_level: '10',
    expiry_date: '',
  });

  const [form, setForm] = useState({
    name: '',
    sku: '',
    category: '',
    description: '',
    price: '',
    quantity: '0',
    reorder_level: '10',
    expiry_date: '',
  });






  const loadProducts = useCallback(async (pullToRefresh = false) => {
    if (pullToRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError('');

    try {
      console.log('StockFlow API URL:', API_URL);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      let response: Response;

      try {
        response = await fetch(API_URL, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      console.log('StockFlow API status:', response.status);

      if (!response.ok) {
        throw new Error(`API returned HTTP ${response.status}`);
      }

      const data = await response.json();

      const productList = Array.isArray(data)
        ? data
        : Array.isArray(data.results)
          ? data.results
          : [];

      setProducts(productList);
      console.log('StockFlow products loaded:', productList.length);
    } catch (error) {
      console.error('StockFlow API request failed:', error);

      const message =
        error instanceof Error
          ? error.name === 'AbortError'
            ? 'Request timed out after 15 seconds. Check the server and network.'
            : `${error.name}: ${error.message}`
          : String(error);

      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);


  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    let isMounted = true;

    async function setupNotifications() {
      try {
        const token = await registerForPushNotifications();

        if (token && isMounted) {
          console.log('StockFlow push token registered');
        }
      } catch (error) {
        console.error('Push notification setup failed:', error);
      }
    }

    setupNotifications();

    return () => {
      isMounted = false;
    };
  }, []);

  const totalUnits = products.reduce(
    (sum, product) => sum + Number(product.quantity),
    0
  );

  const lowStock = products.filter(
    product => Number(product.quantity) <= Number(product.reorder_level)
  ).length;

  const categories = new Set(products.map(product => product.category));

  async function addProduct() {
    if (!form.name.trim() || !form.sku.trim() || !form.price.trim()) {
      Alert.alert('Missing details', 'Enter product name, SKU and price.');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          quantity: Number(form.quantity),
          reorder_level: Number(form.reorder_level),
          expiry_date: form.expiry_date || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const message = Object.entries(data)
          .map(([field, errors]) =>
            `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`
          )
          .join('\n');

        throw new Error(message || 'Unable to add product.');
      }

      Alert.alert('Success', 'Product added successfully!');
      setForm({
        name: '',
        sku: '',
        category: '',
        description: '',
        price: '',
        quantity: '0',
        reorder_level: '10',
        expiry_date: '',
      });
      setShowForm(false);
      await loadProducts();
    } catch (error) {
      Alert.alert(
        'Error',
        error instanceof Error ? error.message : 'Could not add product.'
      );
    } finally {
      setSaving(false);
    }
  }

  function startEditing(product: Product) {
    setEditingProduct(product);
    setEditForm({
      name: product.name,
      sku: product.sku,
      category: product.category || '',
      description: product.description || '',
      price: String(product.price ?? ''),
      quantity: String(product.quantity),
      reorder_level: String(product.reorder_level),
      expiry_date: product.expiry_date || '',
    });
  }

  function updateEditForm(field: string, value: string) {
    setEditForm(previous => ({
      ...previous,
      [field]: value,
    }));
  }

  async function saveEditedProduct() {
    if (!editingProduct) return;

    setSaving(true);

    try {
      const response = await fetch(`${API_URL}${editingProduct.id}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...editForm,
          price: Number(editForm.price),
          quantity: Number(editForm.quantity),
          reorder_level: Number(editForm.reorder_level),
          expiry_date: editForm.expiry_date || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(JSON.stringify(data));
      }

      setProducts(previous =>
        previous.map(product =>
          product.id === editingProduct.id ? data : product
        )
      );

      setEditingProduct(null);
      Alert.alert('Success', 'Product updated successfully.');
    } catch (error) {
      Alert.alert(
        'Update failed',
        error instanceof Error ? error.message : 'Could not update product.'
      );
    } finally {
      setSaving(false);
    }
  }

  function deleteProduct(product: Product) {
    Alert.alert(
      'Delete product',
      `Delete "${product.name}" (${product.sku})? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${API_URL}${product.id}/`, {
                method: 'DELETE',
              });

              if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
              }

              await loadProducts();
              Alert.alert('Deleted', 'Product removed successfully.');
            } catch (error) {
              Alert.alert(
                'Delete failed',
                error instanceof Error
                  ? error.message
                  : 'Could not delete product.'
              );
            }
          },
        },
      ]
    );
  }

  async function submitRestock() {
    if (!restockingProduct) return;

    const quantityToAdd = Number(restockQuantity);

    if (!Number.isFinite(quantityToAdd) || quantityToAdd <= 0) {
      Alert.alert('Invalid quantity', 'Enter a positive number of units.');
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API_URL}${restockingProduct.id}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quantity: Number(restockingProduct.quantity) + quantityToAdd,
        }),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message = data && typeof data === 'object'
          ? Object.entries(data)
            .map(([field, errors]) =>
              `${field}: ${Array.isArray(errors) ? errors.join(', ') : errors}`
            )
            .join('\n')
          : 'Unable to restock product.';

        throw new Error(message || 'Unable to restock product.');
      }

      const nextQuantity = Number(
        data?.quantity ?? Number(restockingProduct.quantity) + quantityToAdd
      );

      setProducts(previous =>
        previous.map(product =>
          product.id === restockingProduct.id
            ? { ...product, quantity: nextQuantity }
            : product
        )
      );

      setRestockingProduct(null);
      setRestockQuantity('1');
      Alert.alert(
        'Success',
        `Restocked ${restockingProduct.name} by ${quantityToAdd} units.`
      );
    } catch (error) {
      Alert.alert(
        'Restock failed',
        error instanceof Error ? error.message : 'Could not restock product.'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      refreshControl={

        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadProducts(true)}
        />
      }
    >
      <StatusBar barStyle="light-content" backgroundColor="#172033" />

      <View style={styles.header}>
        <Text style={styles.logo}>S</Text>
        <View>
          <Text style={styles.brand}>StockFlow</Text>
          <Text style={styles.subtitle}>Inventory Management</Text>
        </View>
      </View>

      <View style={styles.welcome}>
        <Text style={styles.greeting}>Dashboard</Text>
        <Text style={styles.description}>
          Here's your live stock overview.
        </Text>
      </View>

      {loading ? (
        <View style={styles.message}>
          <ActivityIndicator size="large" color="#4263EB" />
          <Text style={styles.messageText}>Loading inventory...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Connection failed</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Text style={styles.retry} onPress={() => loadProducts()}>
            Tap here to retry
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total Products</Text>
              <Text style={styles.statValue}>{products.length}</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total Units</Text>
              <Text style={styles.statValue}>{totalUnits}</Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Low Stock</Text>
              <Text style={[styles.statValue, { color: '#D97706' }]}>
                {lowStock}
              </Text>
            </View>

            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Categories</Text>
              <Text style={styles.statValue}>{categories.size}</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Product Inventory</Text>
          <Pressable
            style={styles.addButton}
            onPress={() => setShowForm(!showForm)}
          >
            <Text style={styles.addButtonText}>
              {showForm ? 'Cancel' : '+ Add Product'}
            </Text>
          </Pressable>

          {showForm && (
            <View style={styles.formCard}>
              {([
                ['name', 'Product name'],
                ['sku', 'SKU'],
                ['category', 'Category'],
                ['description', 'Description'],
                ['price', 'Price'],
                ['quantity', 'Quantity'],
                ['reorder_level', 'Reorder level'],
                ['expiry_date', 'Expiry date (YYYY-MM-DD, optional)'],
              ] as const).map(([key, label]) => (
                <View key={key} style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{label}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={label}
                    placeholderTextColor="#94A3B8"
                    value={form[key]}
                    onChangeText={value =>
                      setForm(previous => ({ ...previous, [key]: value }))
                    }
                    keyboardType={
                      key === 'price' || key === 'quantity' || key === 'reorder_level'
                        ? 'decimal-pad'
                        : 'default'
                    }
                    autoCapitalize={key === 'sku' ? 'characters' : 'sentences'}
                  />
                </View>
              ))}

              <Pressable
                style={[styles.addButton, saving && { opacity: 0.6 }]}
                disabled={saving}
                onPress={addProduct}
              >
                <Text style={styles.addButtonText}>
                  {saving ? 'Saving...' : 'Save Product'}
                </Text>
              </Pressable>
            </View>
          )}

          {editingProduct && (
            <View style={styles.formCard}>
              <Text style={styles.sectionTitle}>Edit Product</Text>
              {([
                ['name', 'Product name'],
                ['sku', 'SKU'],
                ['category', 'Category'],
                ['description', 'Description'],
                ['price', 'Price'],
                ['quantity', 'Quantity'],
                ['reorder_level', 'Reorder level'],
                ['expiry_date', 'Expiry date (YYYY-MM-DD, optional)'],
              ] as const).map(([key, label]) => (
                <View key={key} style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{label}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={label}
                    placeholderTextColor="#94A3B8"
                    value={editForm[key]}
                    onChangeText={value => updateEditForm(key, value)}
                    keyboardType={
                      key === 'price' || key === 'quantity' || key === 'reorder_level'
                        ? 'decimal-pad'
                        : 'default'
                    }
                    autoCapitalize={key === 'sku' ? 'characters' : 'sentences'}
                  />
                </View>
              ))}

              <View style={styles.actionRow}>
                <Pressable
                  style={[styles.editButton, saving && { opacity: 0.6 }]}
                  disabled={saving}
                  onPress={saveEditedProduct}
                >
                  <Text style={styles.editButtonText}>
                    {saving ? 'Updating...' : 'Update Product'}
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.deleteButton}
                  onPress={() => setEditingProduct(null)}
                >
                  <Text style={styles.deleteButtonText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          )}

          {products.map(product => {
            const isLow =
              Number(product.quantity) <= Number(product.reorder_level);

            return (
              <View style={styles.productCard} key={product.id}>
                <View style={styles.productTop}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text
                    style={[
                      styles.badge,
                      isLow ? styles.lowBadge : styles.stockBadge,
                    ]}
                  >
                    {isLow ? 'Low Stock' : 'In Stock'}
                  </Text>
                </View>




                <Text style={styles.sku}>
                  {product.sku} · {product.category || 'General'}
                </Text>

                <View style={styles.productBottom}>
                  <Text style={styles.quantity}>
                    {product.quantity} units
                  </Text>
                  <Text style={styles.category}>
                    Reorder at {product.reorder_level}
                  </Text>
                </View>
                <View style={styles.actionRow}>
                  <Pressable
                    style={styles.editButton}
                    onPress={() => startEditing(product)}
                  >
                    <Text style={styles.editButtonText}>
                      Edit
                    </Text>
                  </Pressable>

                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => deleteProduct(product)}
                  >
                    <Text style={styles.deleteButtonText}>
                      Delete
                    </Text>
                  </Pressable>
                </View>

                <Pressable
                  style={[styles.addButton, { marginTop: 12 }]}
                  onPress={() => {
                    setRestockingProduct(product);
                    setRestockQuantity('1');
                  }}
                >
                  <Text style={styles.addButtonText}>+ Restock</Text>
                </Pressable>

                {restockingProduct?.id === product.id && (
                  <View style={styles.formCard}>
                    <Text style={styles.inputLabel}>
                      Units received for {product.name}
                    </Text>

                    <TextInput
                      style={styles.input}
                      placeholder="Enter quantity received"
                      keyboardType="number-pad"
                      value={restockQuantity}
                      onChangeText={setRestockQuantity}
                    />

                    <Pressable
                      style={styles.addButton}
                      disabled={saving}
                      onPress={submitRestock}
                    >
                      <Text style={styles.addButtonText}>
                        {saving ? 'Restocking...' : 'Confirm Restock'}
                      </Text>
                    </Pressable>
                  </View>
                )}

              </View>
            );
          })}

          {products.length === 0 && (
            <Text style={styles.messageText}>No products found.</Text>
          )}
        </>
      )}

      <Text style={styles.footer}>StockFlow · Inventory Management</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F3F6FB' },
  header: {
    backgroundColor: '#172033',
    paddingHorizontal: 22,
    paddingTop: 54,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logo: {
    backgroundColor: '#4263EB',
    color: '#FFFFFF',
    fontSize: 25,
    fontWeight: '800',
    width: 48,
    height: 48,
    textAlign: 'center',
    textAlignVertical: 'center',
    borderRadius: 14,
    overflow: 'hidden',
  },
  brand: { color: '#FFFFFF', fontSize: 23, fontWeight: '800' },
  subtitle: { color: '#B9C4D8', fontSize: 13, marginTop: 3 },
  welcome: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 18 },
  greeting: { color: '#172033', fontSize: 28, fontWeight: '800' },
  description: { color: '#64748B', fontSize: 14, marginTop: 6 },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
  },
  statCard: {
    width: '46%',
    flexGrow: 1,
    backgroundColor: '#FFFFFF',
    margin: 6,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statLabel: { color: '#64748B', fontSize: 13 },
  statValue: {
    color: '#172033',
    fontSize: 29,
    fontWeight: '800',
    marginTop: 10,
  },
  sectionTitle: {
    color: '#172033',
    fontSize: 20,
    fontWeight: '800',
    marginHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  productCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 18,
    marginBottom: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  productTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  productName: {
    color: '#172033',
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    overflow: 'hidden',
  },
  lowBadge: { backgroundColor: '#FEF3C7', color: '#92400E' },
  stockBadge: { backgroundColor: '#D1FAE5', color: '#065F46' },
  sku: { color: '#64748B', fontSize: 13, marginTop: 10 },
  productBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  quantity: { color: '#172033', fontSize: 15, fontWeight: '700' },
  category: { color: '#64748B', fontSize: 12 },
  message: { alignItems: 'center', padding: 40 },
  messageText: { color: '#64748B', textAlign: 'center', marginTop: 12 },
  errorCard: {
    backgroundColor: '#FFFFFF',
    margin: 18,
    padding: 18,
    borderRadius: 16,
  },
  errorTitle: { color: '#B91C1C', fontSize: 18, fontWeight: '800' },
  errorText: { color: '#475569', marginTop: 8, lineHeight: 21 },
  retry: { color: '#4263EB', fontWeight: '700', marginTop: 16 },
  footer: {
    textAlign: 'center',
    color: '#94A3B8',
    marginTop: 20,
    marginBottom: 30,
    fontSize: 12,
  },
  addButton: {
    backgroundColor: '#4263EB',
    marginHorizontal: 18,
    marginBottom: 16,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 18,
    marginBottom: 20,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: '#172033',
    backgroundColor: '#FFFFFF',
  },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  editButton: {
    backgroundColor: '#EEF2FF',
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 9,
  },
  editButtonText: {
    color: '#4263EB',
    fontWeight: '700',
  },
  deleteButton: {
    backgroundColor: '#FEF2F2',
    paddingVertical: 9,
    paddingHorizontal: 18,
    borderRadius: 9,
  },
  deleteButtonText: {
    color: '#DC2626',
    fontWeight: '700',
  },

});
