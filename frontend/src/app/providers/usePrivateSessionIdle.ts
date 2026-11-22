/** Synthetic-only idle policy for private sessions.
 *
 * Refresh tokens and background requests do not constitute human activity.
 * Interactions are deliberately scoped to pointer, touch and keyboard input,
 * with a throttled bearer heartbeat checked by PostgreSQL.
 */
import { useCallback, useEffect, useRef } from "react";

export const PRIVATE_IDLE_LIMIT_MS = 15 * 60_000;
export const PRIVATE_IDLE_WARNING_MS = 2 * 60_000;
const ACTIVITY_HEARTBEAT_MS = 60_000;

export function usePrivateSessionIdle(
  session: { token: string } | null,
  onIdle: () => void,
  onWarning: (visible: boolean) => void,
) {
  const lastInteraction = useRef<number | null>(null);
  const lastHeartbeat = useRef<number | null>(null);
  const expiring = useRef(false);
  const requestActivity = useRef<() => void>(() => {});

  const confirmActivity = useCallback(() => {
    // Only real button activation invokes this explicit activity callback.
    // The server may still reject it if the idle window has already elapsed.
    requestActivity.current();
  }, []);
  const token = session?.token ?? null;

  useEffect(() => {
    if (!token) {
      lastInteraction.current = null;
      lastHeartbeat.current = null;
      expiring.current = false;
      requestActivity.current = () => {};
      onWarning(false);
      return;
    }

    if (lastInteraction.current === null) {
      lastInteraction.current = Date.now();
      lastHeartbeat.current = Date.now();
    }
    let active = true;
    let timeout = 0;
    let warningTimeout = 0;

    const expire = () => {
      if (!active || expiring.current) return;
      expiring.current = true;
      onWarning(false);
      onIdle();
    };
    const overdue = () => {
      const last = lastInteraction.current ?? Date.now();
      if (Date.now() - last >= PRIVATE_IDLE_LIMIT_MS) {
        expire();
        return true;
      }
      return false;
    };
    const schedule = () => {
      window.clearTimeout(timeout);
      window.clearTimeout(warningTimeout);
      const elapsed = Date.now() - (lastInteraction.current ?? Date.now());
      const warningIn = PRIVATE_IDLE_LIMIT_MS - PRIVATE_IDLE_WARNING_MS - elapsed;
      if (warningIn <= 0) {
        onWarning(true);
      } else {
        onWarning(false);
        warningTimeout = window.setTimeout(() => {
          if (active && !overdue()) onWarning(true);
        }, warningIn);
      }
      const remaining = PRIVATE_IDLE_LIMIT_MS - elapsed;
      timeout = window.setTimeout(() => {
        if (!overdue()) schedule();
      }, Math.max(1, remaining));
    };
    const interact = () => {
      // A click after device sleep cannot resurrect an idle session.
      if (overdue()) return;
      const now = Date.now();
      lastInteraction.current = now;
      schedule();
      if (now - (lastHeartbeat.current ?? now) < ACTIVITY_HEARTBEAT_MS) return;
      lastHeartbeat.current = now;
      // A cookie alone never signals activity. Only the current bearer session
      // can update the authoritative database timestamp.
      void fetch("/api/v1/auth/activity", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Authorization: `Bearer ${token}` },
      }).then(response => {
        if (active && response.status === 401) expire();
      }).catch(() => {
        // Network loss cannot extend the server-side idle window.
      });
    };
    requestActivity.current = interact;
    const resume = () => {
      if (overdue()) return;
      // Focus/visibility cannot renew activity: only reveal a due warning.
      const elapsed = Date.now() - (lastInteraction.current ?? Date.now());
      if (elapsed >= PRIVATE_IDLE_LIMIT_MS - PRIVATE_IDLE_WARNING_MS) onWarning(true);
    };

    schedule();
    window.addEventListener("pointerdown", interact, { passive: true });
    window.addEventListener("keydown", interact);
    window.addEventListener("touchstart", interact, { passive: true });
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      requestActivity.current = () => {};
      window.clearTimeout(timeout);
      window.clearTimeout(warningTimeout);
      window.removeEventListener("pointerdown", interact);
      window.removeEventListener("keydown", interact);
      window.removeEventListener("touchstart", interact);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [token, onIdle, onWarning]);
  return confirmActivity;
}
