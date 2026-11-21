// Internal, memory-only notifications. No browser events or persisted tokens.
const listeners = new Set<(token: string) => void>();

export function invalidatePrivateSession(token: string) {
  for (const listener of listeners) listener(token);
}

export function onPrivateSessionInvalidated(listener: (token: string) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
