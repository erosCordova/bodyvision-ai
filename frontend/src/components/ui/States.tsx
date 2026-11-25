import { ApiError } from "../../services/api/client";
import { Icon } from "./Icon";
export function LoadingState() {
  return (
    <p role="status" className="panel state loading-state">
      <span className="loading-orbit" aria-hidden="true" />
      Cargando información…
    </p>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: Error | null;
  retry: () => void;
}) {
  return (
    <div role="alert" className="panel state">
      <h2>No se pudo cargar la información</h2>
      <p>{error?.message}</p>
      {error instanceof ApiError && (
        <details className="reference"><summary>Referencia de soporte</summary>{error.correlationId}</details>
      )}
      <button onClick={retry}><Icon name="refresh" size={15} /> Reintentar</button>
    </div>
  );
}
export function EmptyState({ text }: { text: string }) {
  return (
    <div className="panel state empty">
      <span aria-hidden="true"><Icon name="inbox" size={34} strokeWidth={1.4} /></span>
      <h2>{text}</h2>

    </div>
  );
}
export function InlineError({ error }: { error: unknown }) {
  return (
    <div role="alert" className="inline-error">
      {error instanceof Error
        ? error.message
        : "Revisa los datos e inténtalo de nuevo."}
      {error instanceof ApiError && (
        <small>Referencia: {error.correlationId}</small>
      )}
    </div>
  );
}
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
