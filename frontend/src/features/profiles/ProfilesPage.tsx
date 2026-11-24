import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { Profile } from "../../services/api/records";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import {
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
  dateTime,
} from "../../components/ui/States";
const schema = z.object({
  display_name: z.string().max(100),
  birth_year: z.coerce
    .number<number>()
    .int()
    .min(1900)
    .max(new Date().getFullYear()),
});
type Inputs = z.infer<typeof schema>;
export function ProfilesPage() {
  const { id, api, readOnly } = useWorkspace();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [params, setParams] = useSearchParams();
  const requested = params.get("status");
  const status: Profile["status"] | undefined =
    requested === "active" || requested === "restricted" || requested === "archived" ? requested : undefined;
  const changeStatus = (next: string) => {
    setOffset(0);
    setParams(previous => {
      const updated = new URLSearchParams(previous);
      if (next) updated.set("status", next);
      else updated.delete("status");
      return updated;
    }, { replace: true });
  };
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["profiles", id, search, offset, status],
    queryFn: () => api.profiles(search.trim(), offset, status),
  });
  const form = useForm<Inputs>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: "", birth_year: 1995 },
  });
  const mutation = useMutation({
    mutationFn: (data: Inputs) =>
      api.createProfile({ ...data, display_name: data.display_name.trim() || null }),
    onSuccess: async (profile) => {
      await cache.invalidateQueries({ queryKey: ["profiles", id] });
      await cache.invalidateQueries({ queryKey: ["summary", id] });
      navigate(`/profiles/${profile.id}`);
    },
  });
  return (
    <>
      <div className="data-heading">
        <div>
          <p className="eyebrow">REGISTRO CORPORAL</p>
          <h1>Expedientes</h1>
          <p className="intro">
            Datos mínimos y una historia de mediciones para cada expediente
            ficticio.
          </p>
        </div>
        <button
          className="primary-button"
          disabled={readOnly}
          onClick={() => setCreating(!creating)}
        >
          {readOnly
            ? "Vista de solo lectura"
            : creating
              ? "Cerrar formulario"
              : "+ Nuevo expediente"}
        </button>
      </div>
      {creating && (
        <section className="panel form-panel">
          <h2>Crear expediente ficticio</h2>
          <form
            onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
            noValidate
          >
            <label>
              Nombre de referencia (opcional)
              <input maxLength={100} {...form.register("display_name")} />
            </label>
            <label>
              Año de nacimiento
              <input
                type="number"
                {...form.register("birth_year", { valueAsNumber: true })}
              />
            </label>
            {form.formState.errors.birth_year && (
              <p role="alert">Introduce un año válido.</p>
            )}
            <p className="muted">Usa únicamente datos ficticios. La captura requiere consentimiento vigente y mayoría de edad.</p>
            {mutation.isError && <InlineError error={mutation.error} />}
            <button className="primary-button" disabled={mutation.isPending}>
              {mutation.isPending ? "Guardando…" : "Crear expediente"}
            </button>
          </form>
        </section>
      )}
      <div className="profiles-toolbar">
      <label className="search-label">
        Buscar por código o referencia
        <input
          type="search"
          maxLength={100}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Buscar expediente ficticio…"
        />
      </label>
      <label>Estado del expediente
        <select value={status ?? ""} onChange={e=>changeStatus(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="restricted">Restringidos</option>
          <option value="archived">Archivados</option>
        </select>
      </label>
      {(search || status) && <button type="button" onClick={()=>{setSearch("");changeStatus("");}}>Limpiar filtros</button>}
      </div>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.items.length === 0 ? (
            <EmptyState
              text={
                search || status
                  ? "No hay expedientes con esos filtros"
                  : "Aún no hay expedientes"
              }
            />
          ) : (
            <div className="profiles-grid">
              {query.data.items.map((p) => (
                <Link
                  className="panel profile-card"
                  to={`/profiles/${p.id}`}
                  key={p.id}
                >
                  <span className={`status-pill ${p.status}`}>
                    {p.status === "active"
                      ? "Activo"
                      : p.status === "restricted"
                        ? "Restringido"
                        : "Archivado"}
                  </span>
                  <span className="profile-symbol" aria-hidden="true">
                    ◉
                  </span>
                  <h2>{p.display_name || p.display_code}</h2>
                  <p>{p.display_code}</p>
                  <small>Año de nacimiento: {p.birth_year}</small>
                  <small>Registro: {dateTime(p.created_at)}</small>
                  <span className="open-record">Abrir expediente →</span>
                </Link>
              ))}
            </div>
          )}
          <div className="pagination">
            <span role="status">{query.data.total ? `${query.data.offset + 1}–${query.data.offset + query.data.items.length} de ${query.data.total}` : "0"} expedientes</span>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - query.data.limit))}
            >
              Anterior
            </button>
            <button
              disabled={offset + query.data.limit >= query.data.total}
              onClick={() => setOffset(offset + query.data.limit)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </>
  );
}
