/**
 * Error normalization and user-facing message translation utility.
 * Categorizes network, storage, authentication, timeout, and server errors.
 * Guarantees that internal exception strings, stack traces, and library details
 * are never exposed to the user interface.
 */

export function getUserFacingErrorMessage(error: unknown): string {
  if (!error) {
    return 'Unable to load data. Please retry.';
  }

  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  // 1. Timeout, fetch abort, or long cold boot cancellation
  if (
    (error as any)?.isTimeout ||
    (error as any)?.name === 'AbortError' ||
    /timeout|taking longer than expected|aborted|canceled|cancelled/i.test(message)
  ) {
    return 'The server is taking longer than expected. Please retry.';
  }

  // 2. Secure storage / Hardware Keystore / Invalid key error
  if (
    /SecureStore|keystore|keychain|secure hardware storage/i.test(message) ||
    /invalid key provided to securestore/i.test(message)
  ) {
    return 'Secure device storage could not be accessed. Please restart the app.';
  }

  // 3. HTTP 404 - Endpoint not deployed yet or resource missing
  if (status === 404 || /HTTP 404|not found/i.test(message)) {
    return 'The service is currently unavailable or updating. Please retry shortly.';
  }

  // 4. HTTP 401 / 403 - Workspace unauthorized or authentication denied
  if (
    status === 401 ||
    status === 403 ||
    /HTTP 401|HTTP 403|unauthorized|forbidden|credentials could not be established/i.test(message)
  ) {
    return 'Workspace access was denied. Please verify your connection or retry.';
  }

  // 5. HTTP 429 - Throttled / Rate limited
  if (status === 429 || /HTTP 429|too many requests|throttled/i.test(message)) {
    return 'Too many requests. Please wait a moment before retrying.';
  }

  // 6. HTTP 5xx - Server side errors
  if (
    (typeof status === 'number' && status >= 500) ||
    /HTTP 5\d\d|internal server error|bad gateway|service unavailable/i.test(message)
  ) {
    return 'The server encountered an issue. Please retry in a few moments.';
  }

  // 7. Network / Offline / DNS / Failed to fetch
  if (
    /network request failed|failed to fetch|networkerror|econnrefused|enotfound|offline|fetch failed/i.test(message)
  ) {
    return 'Unable to connect to the server. Please check your internet connection and retry.';
  }

  // 8. Safe fallback message
  return 'Unable to load data. Please retry.';
}
