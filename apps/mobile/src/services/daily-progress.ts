import { DAILY_PROGRESS_API_URL } from '@/constants/api';
import { getInstallationHeadersAsync } from '@/services/installation';
import {
  getLocalDailyProgressAsync,
  getAllLocalDailyProgressAsync,
  saveLocalDailyProgressAsync,
} from '@/services/database';

export type DailyProgress = {
  id?: number;
  date: string; // YYYY-MM-DD
  description: string;
  achievements?: string;
  blockers?: string;
  next_steps?: string;
  notes?: string;
  linked_task?: number | null;
  created_at?: string;
  updated_at?: string;
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  return await getInstallationHeadersAsync();
}

/**
 * Fetch daily progress entry for a specific date (YYYY-MM-DD).
 * Reads from offline SQLite first, falling back to background sync if needed.
 */
export async function fetchDailyProgress(date: string): Promise<DailyProgress | null> {
  try {
    const local = await getLocalDailyProgressAsync(date);
    if (local && local.description) {
      return local;
    }

    // Optional background network fallback
    const authHeaders = await getAuthHeaders();
    const url = `${DAILY_PROGRESS_API_URL}date/${date}/`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders,
      },
    });

    if (response.ok) {
      const data: DailyProgress = await response.json();
      await saveLocalDailyProgressAsync(data);
      return data;
    }

    return local || null;
  } catch (err) {
    // Return local SQLite record if network is offline
    try {
      return await getLocalDailyProgressAsync(date);
    } catch {
      return null;
    }
  }
}

/**
 * Save or update daily progress for a given date.
 * Persists immediately to local SQLite (zero network dependency), then asynchronously syncs to cloud if reachable.
 */
export async function saveDailyProgress(progress: DailyProgress): Promise<DailyProgress> {
  // 1. Immediate local SQLite persistence (offline-first single source of truth)
  const savedLocal = await saveLocalDailyProgressAsync(progress);

  // 2. Best-effort background cloud sync (does not block or fail if offline)
  (async () => {
    try {
      const authHeaders = await getAuthHeaders();
      const url = `${DAILY_PROGRESS_API_URL}date/${progress.date}/`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify(progress),
      });

      if (!response.ok) {
        await fetch(DAILY_PROGRESS_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...authHeaders,
          },
          body: JSON.stringify(progress),
        });
      }
    } catch (netErr) {
      // Offline mode: normal operation, saved in SQLite
    }
  })();

  return savedLocal;
}

/**
 * Fetch list of daily progress entries in a date range.
 * Reads from local SQLite single source of truth.
 */
export async function fetchDailyProgressList(
  startDate?: string,
  endDate?: string
): Promise<DailyProgress[]> {
  try {
    const localList = await getAllLocalDailyProgressAsync();
    if (localList && localList.length > 0) {
      return localList;
    }

    // If local is empty, attempt initial seed fetch from backend
    const authHeaders = await getAuthHeaders();
    let url = DAILY_PROGRESS_API_URL;
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...authHeaders,
      },
    });

    if (!response.ok) {
      return localList || [];
    }

    const data = await response.json();
    const list: DailyProgress[] = Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : [];
    for (const item of list) {
      await saveLocalDailyProgressAsync(item);
    }
    return list;
  } catch (err) {
    return (await getAllLocalDailyProgressAsync().catch(() => [])) || [];
  }
}
