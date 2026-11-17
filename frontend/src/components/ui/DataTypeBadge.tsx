export function DataTypeBadge({ type }: { type: "OBSERVADO" | "DERIVADO" }) {
  return (
    <span className={`data-badge ${type.toLowerCase()}`}>
      <span aria-hidden="true">{type === "OBSERVADO" ? "●" : "ƒ"}</span>
      <span>{type}</span>
    </span>
  );
}
