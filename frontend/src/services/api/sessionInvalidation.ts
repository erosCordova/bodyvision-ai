// Internal, memory-only notifications. No browser events or persisted tokens.
const listeners = new Set<(token: string) => void>();

export function invalidatePrivateSession(token: string) {
  for (const listener of listeners) listener(token);
}

export function onPrivateSessionInvalidated(listener: (token: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One refresh provider per mounted private auth tree. No tokens are persisted. */
type RefreshHandler = (expiredToken: string) => Promise<string | null>;
let refreshHandler: RefreshHandler | null = null;
const pendingRefreshes = new Map<string, Promise<string | null>>();

export function registerPrivateSessionRefresh(handler: RefreshHandler) {
  refreshHandler = handler;
  return () => {
    if (refreshHandler === handler) refreshHandler = null;
  };
}

export function tryRefreshPrivateSession(token: string): Promise<string | null> {
  const current = refreshHandler;
  if (!current) return Promise.resolve(null);
  const existing = pendingRefreshes.get(token);
  if (existing) return existing;
  const task = Promise.resolve().then(() => current(token)).catch(() => null);
  pendingRefreshes.set(token, task);
  void task.finally(() => {
    if (pendingRefreshes.get(token) === task) pendingRefreshes.delete(token);
  });
  return task;
}
