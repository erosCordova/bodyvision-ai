/** Verify an explicitly selected *saved* report against the already verified API response.
 * Only the user's browser reads the file; nothing is uploaded or persisted here.
 * A matching SHA-256 proves byte equality at selection time, not authorship,
 * a digital signature, or that the file will remain on disk.
 */

export type SavedReportReference = Readonly<{
  format: "pdf" | "csv";
  filename: string;
  sha256: string;
}>;

const LIMITS = {
  pdf: 16 * 1024 * 1024,
  csv: 8 * 1024 * 1024,
} as const;

const FILE_NAMES = {
  pdf: /^bodyvision-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.pdf$/,
  csv: /^bodyvision-historial-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.csv$/,
} as const;

export async function verifySavedReportFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  reference: SavedReportReference,
): Promise<void> {
  if (
    !FILE_NAMES[reference.format].test(reference.filename)
    || !/^[a-f0-9]{64}$/.test(reference.sha256)
  ) {
    throw new Error("Los datos de verificación del informe no son válidos.");
  }
  if (file.name !== reference.filename) {
    throw new Error("Selecciona el mismo archivo PDF o CSV que acabas de descargar.");
  }
  if (file.size < 1 || file.size > LIMITS[reference.format]) {
    throw new Error("El archivo guardado está vacío o supera el límite de tamaño.");
  }

  // Read back the selected filesystem copy, not the in-memory export Blob.
  // A single bounded buffer also works on browsers without File.stream().
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > LIMITS[reference.format]) {
    throw new Error("La lectura del archivo guardado está incompleta.");
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (item) =>
    item.toString(16).padStart(2, "0"),
  ).join("");
  if (sha256 !== reference.sha256) {
    throw new Error("El archivo guardado no coincide con el informe verificado.");
  }
}
