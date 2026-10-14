import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { INSTALLATION_BOOTSTRAP_API_URL } from '@/constants/api';

export interface InstallationCredentials {
  installationId: string;
  installationToken: string;
}

export const STORAGE_KEY_ID = 'stockflow_installation_id_v1';
export const STORAGE_KEY_TOKEN = 'stockflow_installation_token_v1';

export const VALID_SECURE_STORE_KEY_REGEX = /^[a-zA-Z0-9.\-_]+$/;

/**
 * Validates that a storage key conforms to Expo SecureStore's strict naming rules:
 * Non-empty and alphanumeric characters, ".", "-", and "_" only.
 */
export function isValidSecureStoreKey(key: string): boolean {
  return typeof key === 'string' && key.length > 0 && VALID_SECURE_STORE_KEY_REGEX.test(key);
}

let inMemoryCredentials: InstallationCredentials | null = null;
let activeBootstrapPromise: Promise<InstallationCredentials> | null = null;
let activeGetStoredPromise: Promise<InstallationCredentials | null> | null = null;

/**
 * Validates whether hardware-backed secure storage is available on the device.
 */
export async function isSecureStoreAvailableAsync(): Promise<boolean> {
  if (Platform.OS === 'web') {
    return false;
  }
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Stores installation credentials securely using Expo SecureStore.
 * In native builds, refuses to silently fall back to plaintext AsyncStorage for installation secrets.
 */
async function setSecureItemAsync(key: string, value: string): Promise<void> {
  if (!isValidSecureStoreKey(key)) {
    throw new Error(
      `Invalid key provided to SecureStore: "${key}". Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".`
    );
  }

  if (Platform.OS === 'web') {
    // Web development preview fallback
    await AsyncStorage.setItem(key, value);
    return;
  }

  const available = await isSecureStoreAvailableAsync();
  if (!available) {
    throw new Error(
      'Secure hardware storage (Expo SecureStore) is unavailable on this device. ' +
      'Installation credentials cannot be saved in plaintext.'
    );
  }

  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

async function getSecureItemAsync(key: string): Promise<string | null> {
  if (!isValidSecureStoreKey(key)) {
    throw new Error(
      `Invalid key provided to SecureStore: "${key}". Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".`
    );
  }

  if (Platform.OS === 'web') {
    return await AsyncStorage.getItem(key);
  }

  const available = await isSecureStoreAvailableAsync();
  if (!available) {
    throw new Error(
      'Secure hardware storage (Expo SecureStore) is unavailable on this device. ' +
      'Installation credentials cannot be retrieved safely.'
    );
  }

  return await SecureStore.getItemAsync(key);
}

async function removeSecureItemAsync(key: string): Promise<void> {
  if (!isValidSecureStoreKey(key)) {
    throw new Error(
      `Invalid key provided to SecureStore: "${key}". Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".`
    );
  }

  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(key);
    return;
  }

  const available = await isSecureStoreAvailableAsync();
  if (available) {
    await SecureStore.deleteItemAsync(key);
  }
}

/**
 * Loads stored installation credentials from device storage.
 * Never silently swallows storage errors or drops valid credentials.
 */
export async function getStoredInstallationCredentialsAsync(): Promise<InstallationCredentials | null> {
  const startMs = Date.now();
  if (inMemoryCredentials) {
    const elapsed = Date.now() - startMs;
    console.log(`[StartupTiming] SecureStore credential retrieval: ${elapsed}ms (memory cache)`);
    return inMemoryCredentials;
  }

  if (activeGetStoredPromise) {
    return await activeGetStoredPromise;
  }

  activeGetStoredPromise = (async () => {
    try {
      const [id, token] = await Promise.all([
        getSecureItemAsync(STORAGE_KEY_ID),
        getSecureItemAsync(STORAGE_KEY_TOKEN),
      ]);

      const elapsed = Date.now() - startMs;
      console.log(`[StartupTiming] SecureStore credential retrieval: ${elapsed}ms`);

      if (id && token && id.trim().length > 0 && token.trim().length > 0) {
        inMemoryCredentials = {
          installationId: id.trim(),
          installationToken: token.trim(),
        };
        return inMemoryCredentials;
      }

      // Web preview only: check and migrate legacy AsyncStorage keys
      if (Platform.OS === 'web') {
        try {
          const legacyId = await AsyncStorage.getItem('@stockflow_installation_id_v1');
          const legacyToken = await AsyncStorage.getItem('@stockflow_installation_token_v1');
          if (legacyId && legacyToken && legacyId.trim().length > 0 && legacyToken.trim().length > 0) {
            const creds: InstallationCredentials = {
              installationId: legacyId.trim(),
              installationToken: legacyToken.trim(),
            };
            await Promise.all([
              AsyncStorage.setItem(STORAGE_KEY_ID, creds.installationId),
              AsyncStorage.setItem(STORAGE_KEY_TOKEN, creds.installationToken),
              AsyncStorage.removeItem('@stockflow_installation_id_v1'),
              AsyncStorage.removeItem('@stockflow_installation_token_v1'),
            ]);
            inMemoryCredentials = creds;
            return creds;
          }
        } catch {
          // Non-fatal web migration attempt
        }
      }

      return null;
    } catch (err) {
      console.error('[Installation] Error reading stored credentials from SecureStore:', err);
      throw err;
    } finally {
      activeGetStoredPromise = null;
    }
  })();

  return await activeGetStoredPromise;
}

/**
 * Performs server bootstrap handshake to register a new verified installation workspace.
 */
export async function bootstrapInstallationAsync(
  deviceName?: string,
  timeoutMs = 60000
): Promise<InstallationCredentials> {
  const startMs = Date.now();
  console.log('[StartupTiming] Installation bootstrap: started');
  const effectiveDeviceName = deviceName || Device.modelName || 'Android Device';

  let didTimeout = false;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(INSTALLATION_BOOTSTRAP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        device_name: effectiveDeviceName,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const err = new Error(`Installation bootstrap failed (HTTP ${response.status}): ${errText}`);
      (err as any).status = response.status;
      (err as any).responseBody = errText;
      throw err;
    }

    const data = await response.json();
    if (!data.installation_id || !data.installation_token) {
      throw new Error('Server returned invalid installation credentials payload.');
    }

    const creds: InstallationCredentials = {
      installationId: String(data.installation_id).trim(),
      installationToken: String(data.installation_token).trim(),
    };

    // Persist securely to device storage
    await Promise.all([
      setSecureItemAsync(STORAGE_KEY_ID, creds.installationId),
      setSecureItemAsync(STORAGE_KEY_TOKEN, creds.installationToken),
    ]);

    inMemoryCredentials = creds;
    const elapsed = Date.now() - startMs;
    console.log(`[StartupTiming] Installation bootstrap: ${elapsed}ms`);
    console.log(`[Installation] Successfully bootstrapped workspace: ${creds.installationId}`);
    return creds;
  } catch (err) {
    const isTimeout =
      didTimeout ||
      controller.signal.aborted ||
      (err instanceof Error &&
        (err.name === 'AbortError' || /cancel|aborted/i.test(err.message)));
    if (isTimeout) {
      const timeoutErr = new Error('The server is taking longer than expected. Please retry.');
      (timeoutErr as any).isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retrieves existing installation credentials or bootstraps a new workspace once.
 * Deduplicates concurrent calls during app startup.
 */
export async function getOrBootstrapInstallationAsync(): Promise<InstallationCredentials> {
  const existing = await getStoredInstallationCredentialsAsync();
  if (existing) {
    return existing;
  }

  if (activeBootstrapPromise) {
    return await activeBootstrapPromise;
  }

  activeBootstrapPromise = bootstrapInstallationAsync()
    .finally(() => {
      activeBootstrapPromise = null;
    });

  return await activeBootstrapPromise;
}

/**
 * Generates authentication headers for the verified installation workspace.
 * Throws when valid credentials cannot be established; never sends unauthenticated requests.
 */
export async function getInstallationHeadersAsync(): Promise<Record<string, string>> {
  const creds = await getOrBootstrapInstallationAsync();
  if (!creds?.installationId || !creds?.installationToken) {
    throw new Error('Valid installation workspace credentials could not be established.');
  }
  return {
    'X-Installation-Id': creds.installationId,
    'X-Installation-Token': creds.installationToken,
  };
}

/**
 * Clears stored installation credentials (used for testing or workspace reset).
 */
export async function resetInstallationCredentialsAsync(): Promise<void> {
  inMemoryCredentials = null;
  activeBootstrapPromise = null;
  activeGetStoredPromise = null;
  await Promise.all([
    removeSecureItemAsync(STORAGE_KEY_ID),
    removeSecureItemAsync(STORAGE_KEY_TOKEN),
  ]);
}
