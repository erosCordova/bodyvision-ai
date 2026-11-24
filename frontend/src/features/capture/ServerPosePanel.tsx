import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serverPoseApi, type ServerPoseJob } from "../../services/api/syntheticCaptures";

const labels: Record<ServerPoseJob["status"], string> = {
  queued: "En cola", processing: "Procesando", needs_review: "Requiere revisión",
  failed: "No completado", accepted: "Aceptado para visualización de prueba",
  rejected: "Rechazado",
};

export function ServerPosePanel({ token, organizationId, actorId, profileId, captureId, canWrite }: {
  token: string; organizationId: string; actorId: string;
  profileId: string; captureId: string; canWrite: boolean;
}) {
  const cache = useQueryClient();
  const key = ["server-pose-job", organizationId, actorId, profileId, captureId];
  const api = serverPoseApi(token, profileId, captureId);
  const query = useQuery({
    queryKey: key, queryFn: api.get, retry: false,
    refetchInterval: query => ["queued", "processing"].includes(query.state.data?.status ?? "")
      ? 3000 : false,
  });
  const mutation = useMutation({
    mutationFn: (decision: "enqueue" | "accepted" | "rejected") =>
      decision === "enqueue" ? api.enqueue() : api.review(decision),
    onSuccess: data => { cache.setQueryData(key, data); },
  });
  const job = query.data;
  return <section aria-label="Procesamiento de pose en servidor">
    <h4>Estimación visual ficticia · servidor</h4>
    <p>Requiere un trabajador privado configurado. No calcula medidas corporales ni emite
      diagnósticos. Los resultados de este módulo no son los del análisis local.</p>
    {query.isPending && <p role="status">Consultando estado…</p>}
    {query.isError && <p role="status">{query.error.message} Puedes solicitar un trabajo o consultar de nuevo.</p>}
    {!job && canWrite && <button type="button" disabled={mutation.isPending}
      onClick={() => mutation.mutate("enqueue")}>Solicitar análisis ficticio</button>}
    <button type="button" disabled={query.isFetching || mutation.isPending}
      onClick={() => { void query.refetch(); }}>Consultar estado del servidor</button>
    {job && <>
      <p role="status">{labels[job.status]} · Intentos: {job.attempts}/3</p>
      {job.error_code && <p>Error del trabajador: {job.error_code}</p>}
      {job.result && <p>Detección visual: {job.result.detected ? "Sí" : "No"} ·
        Puntos visibles: {job.result.visible_points}/33 · {job.result.model_revision}</p>}
      {job.status === "needs_review" && canWrite && <>
        <button type="button" disabled={mutation.isPending || !job.result?.detected}
          onClick={() => mutation.mutate("accepted")}>Aceptar resultado ficticio</button>
        <button type="button" disabled={mutation.isPending}
          onClick={() => mutation.mutate("rejected")}>Rechazar resultado ficticio</button>
      </>}
    </>}
    {mutation.isError && <p role="alert">{mutation.error.message}</p>}
  </section>;
}
