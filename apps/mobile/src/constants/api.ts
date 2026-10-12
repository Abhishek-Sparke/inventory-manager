import { Platform } from 'react-native';

const getBaseUrl = (): string => {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname || 'localhost';
    return `http://${host}:8000/api`;
  }
  return 'http://10.17.226.70:8000/api';
};

export const API_BASE_URL = getBaseUrl();

export const PRODUCTS_API_URL = `${API_BASE_URL}/products/`;
export const TASKS_API_URL = `${API_BASE_URL}/tasks/`;
export const NOTIFICATIONS_REGISTER_API_URL = `${API_BASE_URL}/notifications/register/`;
