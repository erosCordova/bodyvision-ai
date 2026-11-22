import { invalidatePrivateSession, tryRefreshPrivateSession } from "./sessionInvalidation";

export async function secureRequest(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  if (token.length < 40) throw new Error("Se requiere una sesión de pruebas.");
  const send = (bearer: string) => fetch(`/api/v1/auth${path}`, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
  });
  let currentToken = token;
  let response = await send(currentToken);
  if (response.status === 401) {
    const replacement = await tryRefreshPrivateSession(token);
    if (replacement && replacement !== token) {
      currentToken = replacement;
      response = await send(replacement);
    }
  }
  if (response.status === 401) {
    invalidatePrivateSession(currentToken);
    throw new Error("La sesión ha caducado. Inicia sesión de nuevo.");
  }
  if (response.status === 403 || response.status === 429) {
    const body = await response.clone().json().catch(() => ({})) as { code?: string };
    if (body.code === "SELF_REAUTH_REQUIRED") throw new Error("Confirma tu contraseña actual.");
    if (["RESET_REAUTH_REQUIRED", "ACCOUNT_REAUTH_REQUIRED"].includes(body.code ?? "")) throw new Error("Confirma la contraseña del administrador.");
    if (["RESET_RATE_LIMITED", "ACCOUNT_RATE_LIMITED", "SELF_RATE_LIMITED"].includes(body.code ?? "")) throw new Error("Demasiados intentos. Espera 15 minutos.");
  }
  if (response.status === 403) throw new Error("No tienes permisos para esta operación.");
  if (response.status === 409) throw new Error("Ya existe una cuenta con ese correo.");
  if (response.status === 404) throw new Error("El destino no está disponible para esta operación.");
  if (!response.ok) {
    throw new Error("No se pudo completar la operación. Comprueba el servidor de pruebas.");
  }
  return response.json();
}

