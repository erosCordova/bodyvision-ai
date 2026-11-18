/** glTF loaders sanitize object.name; userData.name preserves the catalogue name. */
export function anatomyMeshName(object: { name: string; userData: Record<string, unknown> }) {
  return typeof object.userData.name === "string" ? object.userData.name : object.name;
}
export function anatomyNameKey(name: string) {
  return name.normalize("NFD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/\.\d+$/, "").replace(/[\s_.-]/g, "");
}
