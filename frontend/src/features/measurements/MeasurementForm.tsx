import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../services/api/client";
import { type Measurement, type Metric } from "../../services/api/records";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { InlineError } from "../../components/ui/States";
import { Modal } from "../../components/ui/Modal";
export function limaInput(date = new Date(Date.now() - 60000)) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
// Accept Spanish comma or decimal point, but never ambiguous thousands separators.
export function parseMeasurementValue(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw !== "string") return NaN;
  const value = raw.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(value)) return NaN;
  return Number(value.replace(",", "."));
}
const schema = z.object({
  metric_code: z.string().min(1),
  value: z.number({ error: "Introduce un número válido, por ejemplo 80,5." }).finite(),
  measured_at: z
    .string()
    .min(1)
    .refine(
      (v) =>
        Number.isFinite(Date.parse(`${v}:00-05:00`)) &&
        Date.parse(`${v}:00-05:00`) <= Date.now(),
      "La fecha debe ser válida y no futura.",
    ),
  method: z.enum(["manual", "device"]),
  instrument: z.string().max(100),
  notes: z.string().max(500),
  correction_reason: z.string(),
});
type Inputs = z.infer<typeof schema>;
export function MeasurementForm({
  profileId,
  metrics,
  correction,
  initialMetricCode,
  onClose,
  onSaved,
}: {
  profileId: string;
  metrics: Metric[];
  correction?: Measurement;
  initialMetricCode?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { id, api, readOnly } = useWorkspace();
  const cache = useQueryClient();
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [confirmed, setConfirmed] = useState(false);
  const originalLocalTime = correction ? limaInput(new Date(correction.measured_at)) : undefined;
  const initialMetric = metrics.find(m=>m.code===(correction?.metric_code??initialMetricCode))??metrics[0];
  const form = useForm<Inputs>({
    resolver: zodResolver(schema),
    defaultValues: {
      metric_code: correction?.metric_code ?? initialMetric?.code ?? "weight",
      value: correction?.value ?? undefined,
      measured_at: originalLocalTime ?? limaInput(),
      method: correction?.method ?? (initialMetric?.allowed_methods.includes("manual") ? "manual" : "device"),
      instrument: correction?.instrument ?? "",
      notes: correction?.notes ?? "",
      correction_reason: "",
    },
  });
  const metricCode = form.watch("metric_code");
  const method = form.watch("method");
  const metric = metrics.find((m) => m.code === metricCode);
  const dirty = form.formState.isDirty;
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const mutation = useMutation({
    mutationFn: (data: Inputs) => {
      const { correction_reason, ...values } = data;
      return api.save(
        profileId,
        {
          ...values,
          unit: metric?.unit,
          // The minute-only field must not truncate an unchanged observation's
          // seconds/microseconds. Preserve the API string, not a Date roundtrip.
          measured_at: correction && data.measured_at === originalLocalTime
            ? correction.measured_at : `${data.measured_at}:00-05:00`,
          instrument: data.instrument || null,
          notes: data.notes || null,
          outlier_confirmed: confirmed,
          duplicate_confirmed: confirmed,
          ...(correction ? { correction_reason } : {}),
        },
        key,
        correction?.id,
      );
    },
    onSuccess: async () => {
      await Promise.all(
        ["measurements", "derived", "series", "summary", "profiles"].map(
          (name) => cache.invalidateQueries({ queryKey: [name, id] }),
        ),
      );
      onSaved();
    },
  });
  const close = () => {
    if (
      !dirty ||
      window.confirm("Hay cambios sin guardar. ¿Cerrar el formulario?")
    )
      onClose();
  };
  const warning =
    mutation.error instanceof ApiError &&
    [
      "OUTLIER_CONFIRMATION_REQUIRED",
      "DUPLICATE_CONFIRMATION_REQUIRED",
    ].includes(mutation.error.code);
  const submit = (data: Inputs) => {
    if (!metric || readOnly || mutation.isPending) return;
    const precision = Math.max(0, Math.min(2, metric.precision));
    const scaled = data.value * 10 ** precision;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-7) {
      form.setError("value", {message: `Utiliza como máximo ${precision} decimales.`});
      return;
    }
    if (!metric.allowed_methods.includes(data.method)) {
      form.setError("method", {message:"Selecciona un método válido para esta métrica."});
      return;
    }
    if (data.value < metric.min_value || data.value > metric.max_value) {
      form.setError("value", {
        message: `Introduce un valor entre ${metric.min_value} y ${metric.max_value}.`,
      });
      return;
    }
    if (data.method === "device" && !data.instrument.trim()) {
      form.setError("instrument", { message: "Indica el instrumento." });
      return;
    }
    if (correction && data.correction_reason.trim().length < 5) {
      form.setError("correction_reason", {
        message: "Describe el motivo con al menos 5 caracteres.",
      });
      return;
    }
    mutation.mutate(data);
  };
  return (
    <Modal
      title={correction ? "Corregir medición" : "Registrar medición"}
      onClose={close}
    >
      <DataTypeBadge type="OBSERVADO" />
      <p className="muted">
        Introduce únicamente valores ficticios observados. Una corrección
        conserva la versión anterior.
      </p>
      <form
        onSubmit={form.handleSubmit(submit)}
        noValidate
        onChange={(event) => {
          if (
            event.target instanceof HTMLInputElement &&
            event.target.type === "checkbox"
          )
            return;
          if (warning || mutation.isError) {
            mutation.reset();
            setKey(crypto.randomUUID());
            setConfirmed(false);
          }
        }}
      >
        <label>
          Métrica
          <select
            {...form.register("metric_code")}
            aria-disabled={!!correction}
            onChange={(e) => {
              form.setValue("metric_code", e.target.value, {
                shouldDirty: true,
              });
              const selected = metrics.find((m) => m.code === e.target.value);
              form.setValue(
                "method",
                selected?.allowed_methods.includes("manual")
                  ? "manual"
                  : "device",
              );
            }}
          >
            {metrics
              .filter((m) => !correction || m.code === correction.metric_code)
              .map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label} ({m.unit})
                </option>
              ))}
          </select>
        </label>
        <p className="muted">{metric?.instructions}</p>
        <div className="form-grid">
          <div className="measurement-value-field">
            <label htmlFor="measurement-value">Valor ({metric?.unit})</label>
            <input
              id="measurement-value"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              placeholder={metricCode === "weight" ? "Ej. 80,5" : "Introduce el valor"}
              aria-describedby="measurement-value-range"
              aria-invalid={Boolean(form.formState.errors.value)}
              {...form.register("value", { setValueAs: parseMeasurementValue })}
            />
            <small id="measurement-value-range" className="muted">{metric ? `Rango permitido: ${metric.min_value}–${metric.max_value} ${metric.unit}` : "Selecciona una métrica."}</small>
            {form.formState.errors.value && (
              <small role="alert">
                {form.formState.errors.value.message ??
                  "Introduce un número válido."}
              </small>
            )}
          </div>
          <label>
            Fecha y hora (Lima)
            <input
              type="datetime-local"
              max={limaInput(new Date())}
              {...form.register("measured_at")}
            />
            {form.formState.errors.measured_at && (
              <small role="alert">
                {form.formState.errors.measured_at.message}
              </small>
            )}
          </label>
        </div>
        <label>
          Método
          <select {...form.register("method")}>
            {metric?.allowed_methods.map((m) => (
              <option key={m} value={m}>
                {m === "manual" ? "Manual" : "Dispositivo"}
              </option>
            ))}
          </select>
          {form.formState.errors.method && <small role="alert">{form.formState.errors.method.message}</small>}
        </label>
        {method === "device" && (
          <label>
            Instrumento
            <input {...form.register("instrument")} />
            {form.formState.errors.instrument && (
              <small role="alert">
                {form.formState.errors.instrument.message}
              </small>
            )}
          </label>
        )}
        <label>
          Notas (opcional)
          <textarea rows={2} {...form.register("notes")} />
          {form.formState.errors.notes && (
            <small role="alert">Máximo 500 caracteres.</small>
          )}
        </label>
        {correction && (
          <label>
            Motivo de la corrección
            <textarea {...form.register("correction_reason")} />
            {form.formState.errors.correction_reason && (
              <small role="alert">
                {form.formState.errors.correction_reason.message}
              </small>
            )}
          </label>
        )}
        {mutation.isError && <InlineError error={mutation.error} />}
        {warning && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            He revisado el valor y confirmo el registro.
          </label>
        )}
        <div className="form-actions">
          <button type="button" onClick={close}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={readOnly || mutation.isPending || (warning && !confirmed)}
          >
            {mutation.isPending
              ? "Guardando…"
              : correction
                ? "Guardar corrección"
                : "Guardar medición"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
