export function DataTypeBadge({ type }: { type: "OBSERVADO" | "DERIVADO" | "SIMULADO" }) {
  return (
    <span className={`data-badge ${type.toLowerCase()}`}>
      <span aria-hidden="true">{type === "OBSERVADO" ? "●" : type === "DERIVADO" ? "ƒ" : "◇"}</span>
      <span>{type}</span>
    </span>
  );
}
