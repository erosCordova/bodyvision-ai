import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import {
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
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
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const query = useQuery({
    queryKey: ["profiles", id, search, offset],
    queryFn: () => api.profiles(search, offset),
  });
  const form = useForm<Inputs>({
    resolver: zodResolver(schema),
    defaultValues: { display_name: "", birth_year: 1995 },
  });
  const mutation = useMutation({
    mutationFn: (data: Inputs) =>
      api.createProfile({ ...data, display_name: data.display_name || null }),
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
              <input {...form.register("display_name")} />
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
            <p className="muted">
              Los menores solo podrán tener mediciones manuales; la captura de
              imágenes no está habilitada en esta fase.
            </p>
            {mutation.isError && <InlineError error={mutation.error} />}
            <button className="primary-button" disabled={mutation.isPending}>
              {mutation.isPending ? "Guardando…" : "Crear expediente"}
            </button>
          </form>
        </section>
      )}
      <label className="search-label">
        Buscar por código o referencia
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setOffset(0);
          }}
          placeholder="Buscar expediente ficticio…"
        />
      </label>
      {query.isPending ? (
        <LoadingState />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {query.data.items.length === 0 ? (
            <EmptyState
              text={
                search
                  ? "No hay expedientes con esa búsqueda"
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
                  <span className="open-record">Abrir expediente →</span>
                </Link>
              ))}
            </div>
          )}
          <div className="pagination">
            <span>{query.data.total} expedientes</span>
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 12))}
            >
              Anterior
            </button>
            <button
              disabled={offset + 12 >= query.data.total}
              onClick={() => setOffset(offset + 12)}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
    </>
  );
}
