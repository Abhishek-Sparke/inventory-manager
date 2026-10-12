/**
 * Shared in-memory synchronization manager for Tasks and Planner tabs.
 *
 * Ensures that changes made in either tab (creation, edit, toggle, deletion)
 * immediately trigger an update across both tabs, and throttles duplicate
 * network requests when switching between tabs.
 */

type TaskChangeListener = () => void;

const listeners = new Set<TaskChangeListener>();
let lastFetchedTimestamp = 0;
let isFetchInProgress = false;

/**
 * Register a listener to be notified when tasks are mutated.
 */
export function subscribeToTaskChanges(listener: TaskChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Broadcast task mutations (create, update, toggle, delete) to all subscribers.
 */
export function notifyTaskChange(): void {
  lastFetchedTimestamp = 0; // invalidate throttle cache
  listeners.forEach(cb => {
    try {
      cb();
    } catch (e) {
      console.error('[task-sync] Listener error:', e);
    }
  });
}

/**
 * Checks whether a new API fetch should be initiated.
 * Prevents duplicate rapid-fire requests on tab focus.
 */
export function shouldFetchTasks(minIntervalMs = 2000): boolean {
  if (isFetchInProgress) return false;
  const now = Date.now();
  return now - lastFetchedTimestamp >= minIntervalMs;
}

/**
 * Marks that a task fetch operation has started.
 */
export function setFetchInProgress(inProgress: boolean): void {
  isFetchInProgress = inProgress;
}

/**
 * Marks that tasks were successfully fetched.
 */
export function markTasksFetched(): void {
  lastFetchedTimestamp = Date.now();
  isFetchInProgress = false;
}
