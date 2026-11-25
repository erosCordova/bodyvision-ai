export function DataTypeBadge({ type }: { type: "OBSERVADO" | "DERIVADO" | "SIMULADO" }) {
  return <span className={`data-badge ${type.toLowerCase()}`}>{type}</span>;
}
