/**
 * Agent Message Timeout Checker — periodic scheduler that detects
 * expired request messages and triggers reminder/escalation actions.
 *
 * Returns a `stop()` function for graceful shutdown.
 * Test environments can call `msgCheckExpired()` directly without
 * starting the interval.
 */

import { msgCheckExpired } from "./agent-message-service.js";

const DEFAULT_INTERVAL_MS = 30_000; // 30 seconds

let _intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic timeout checker.
 * Returns a `stop()` function to cancel the interval.
 */
export function startMessageTimeoutChecker(
  intervalMs = DEFAULT_INTERVAL_MS,
  maxRetries = 3,
  sessionId?: string,
): { stop: () => void } {
  if (_intervalId !== null) {
    throw new Error("Message timeout checker is already running");
  }

  _intervalId = setInterval(() => {
    try {
      msgCheckExpired(maxRetries, sessionId);
    } catch {
      // Swallow errors in the interval — the checker should not crash the server.
      // Errors are logged inside msgCheckExpired via logEvent.
    }
  }, intervalMs);

  // Allow the Node process to exit even if the interval is still running
  if (_intervalId.unref) _intervalId.unref();

  return {
    stop: () => {
      if (_intervalId !== null) {
        clearInterval(_intervalId);
        _intervalId = null;
      }
    },
  };
}

/**
 * Returns true if the timeout checker is currently running.
 */
export function isMessageTimeoutCheckerActive(): boolean {
  return _intervalId !== null;
}

/**
 * Stop the timeout checker if running. Safe to call multiple times.
 */
export function stopMessageTimeoutChecker(): void {
  if (_intervalId !== null) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}
