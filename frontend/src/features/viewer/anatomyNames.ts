/** glTF loaders sanitize object.name; userData.name preserves the catalogue name. */
export function anatomyMeshName(object: { name: string; userData: Record<string, unknown> }) {
  return typeof object.userData.name === "string" ? object.userData.name : object.name;
}
export function anatomyNameKey(name: string) {
  return name.normalize("NFD").toLowerCase().replace(/[\u0300-\u036f]/g, "")
    .replace(/\.\d+$/, "").replace(/[\s_.-]/g, "");
}

/**
 * Reviewed UI-only Spanish labels for common atlas structures. Keep source
 * names unchanged for GLTF selection, provenance and exact catalogue matching.
 * Unknown structures retain their original name rather than inventing a
 * possibly inaccurate medical translation.
 */
const spanishAnatomyNames: Readonly<Record<string, string>> = {
  "frontal bone": "Hueso frontal",
  "sternum": "Esternón",
  "humerus": "Húmero",
  "femur": "Fémur",
  "tibia": "Tibia",
  "fibula": "Peroné",
  "patella": "Rótula",
  "radius": "Radio",
  "ulna": "Cúbito",
  "pelvis": "Pelvis",
  "clavicle": "Clavícula",
  "scapula": "Escápula",
  "mandible": "Mandíbula",
  "skull": "Cráneo",
  "rib": "Costilla",
  "vertebral column": "Columna vertebral",
  "biceps brachii": "Bíceps braquial",
  "triceps brachii": "Tríceps braquial",
  "pectoralis major": "Pectoral mayor",
  "rectus abdominis": "Recto abdominal",
  "gastrocnemius": "Gastrocnemio",
  "deltoid": "Deltoides",
  "diaphragm": "Diafragma",
  "achilles tendon": "Tendón de Aquiles",
  "aorta": "Aorta",
  "common carotid artery": "Arteria carótida común",
  "femoral artery": "Arteria femoral",
  "great saphenous vein": "Vena safena mayor",
  "median nerve": "Nervio mediano",
  "ulnar nerve": "Nervio cubital",
  "sciatic nerve": "Nervio ciático",
};

/** Display-only translation, with laterality preserved for named left/right meshes. */
export function anatomyDisplayName(name: string): string {
  const clean = name.replace(/(?:\.\d+)+$/, "").replace(/_/g, " ").trim();
  const lateral = clean.match(/[.\s-]([lr])$/i);
  const base = lateral ? clean.slice(0, -lateral[0].length) : clean;
  const key = base.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const translated = spanishAnatomyNames[key];
  if (!translated) return clean;
  return lateral ? translated + (lateral[1].toLowerCase() === "l" ? " izquierdo" : " derecho") : translated;
}
