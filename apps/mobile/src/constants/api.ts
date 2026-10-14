const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'https://stockflow-api-lv0v.onrender.com/api';

export { API_BASE_URL };

export const INSTALLATION_BOOTSTRAP_API_URL = `${API_BASE_URL}/installations/bootstrap/`;
export const INSTALLATION_INFO_API_URL = `${API_BASE_URL}/installations/info/`;
export const PRODUCTS_API_URL = `${API_BASE_URL}/products/`;
export const TASKS_API_URL = `${API_BASE_URL}/tasks/`;
export const DAILY_PROGRESS_API_URL = `${API_BASE_URL}/daily-progress/`;
export const NOTIFICATIONS_REGISTER_API_URL = `${API_BASE_URL}/notifications/register/`;
