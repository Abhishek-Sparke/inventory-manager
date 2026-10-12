import { DAILY_PROGRESS_API_URL } from '@/constants/api';

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

/**
 * Fetch daily progress entry for a specific date (YYYY-MM-DD).
 */
export async function fetchDailyProgress(date: string): Promise<DailyProgress | null> {
  try {
    const url = `${DAILY_PROGRESS_API_URL}date/${date}/`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to fetch daily progress: HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error(`[DailyProgress] Error fetching progress for ${date}:`, err);
    return null;
  }
}

/**
 * Save or update daily progress for a given date.
 */
export async function saveDailyProgress(progress: DailyProgress): Promise<DailyProgress> {
  const url = `${DAILY_PROGRESS_API_URL}date/${progress.date}/`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(progress),
  });

  if (!response.ok) {
    // Fallback to POST on list endpoint
    const postRes = await fetch(DAILY_PROGRESS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(progress),
    });
    if (!postRes.ok) {
      const errData = await postRes.text();
      throw new Error(`Failed to save daily progress: ${errData}`);
    }
    return await postRes.json();
  }

  return await response.json();
}

/**
 * Fetch list of daily progress entries in a date range.
 */
export async function fetchDailyProgressList(
  startDate?: string,
  endDate?: string
): Promise<DailyProgress[]> {
  try {
    let url = DAILY_PROGRESS_API_URL;
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    console.error('[DailyProgress] Error fetching progress list:', err);
    return [];
  }
}
