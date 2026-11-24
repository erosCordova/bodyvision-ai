import { invalidatePrivateSession, tryRefreshPrivateSession } from "./sessionInvalidation";

function checkCancellation(signal?: AbortSignal | null) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Consulta cancelada.", "AbortError");
}

/** Cancelling one reader must not cancel the shared cookie rotation. */
async function waitForRenewal(token: string, signal?: AbortSignal | null) {
  checkCancellation(signal);
  const pending = tryRefreshPrivateSession(token);
  if (!signal) return pending;
  return new Promise<string | null>((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new DOMException("Consulta cancelada.", "AbortError"));
    signal.addEventListener("abort", cancel, { once: true });
    pending.then(value => {
      signal.removeEventListener("abort", cancel);
      if (signal.aborted) cancel();
      else resolve(value);
    }, error => {
      signal.removeEventListener("abort", cancel);
      reject(error);
    });
  });
}

/** Only an authorization failure before mutation is eligible for one retry.
 * Callers supply replayable JSON/Blob bodies and keep their own error messages.
 * Network errors, denied permissions and ambiguous server errors are not retried.
 */
export async function withPrivateSession(
  token: string,
  send: (bearer: string) => Promise<Response>,
  signal?: AbortSignal | null,
): Promise<Response> {
  checkCancellation(signal);
  let currentToken = token;
  let response = await send(currentToken);
  checkCancellation(signal);
  if (response.status === 401) {
    const replacement = await waitForRenewal(token, signal);
    checkCancellation(signal);
    if (replacement && replacement !== token) {
      currentToken = replacement;
      response = await send(replacement);
      checkCancellation(signal);
    }
  }
  if (response.status === 401) invalidatePrivateSession(currentToken);
  return response;
}
