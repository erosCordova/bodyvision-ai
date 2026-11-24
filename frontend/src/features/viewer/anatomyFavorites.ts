import type { AnatomicalLayer } from "./AnatomyScene";
import { anatomyRevision } from "./atlasSource";

/** Only public anatomical catalogue keys are stored. No patient identifiers. */
export type FavoriteStructure = { id: string; layer: AnatomicalLayer };
export const FAVORITES_LIMIT = 12;
export const FAVORITES_STORAGE_KEY = "bodyvision:atlas-favorites:v1:" + anatomyRevision;
const layers = new Set<string>(["skin", "muscles", "skeleton", "arteries", "veins", "nerves"]);

function validFavorite(value: unknown): value is FavoriteStructure {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return Object.keys(entry).length === 2
    && typeof entry.id === "string" && entry.id.length > 0 && entry.id.length <= 160
    && Array.from(entry.id).every(char => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    && typeof entry.layer === "string" && layers.has(entry.layer);
}

/** Storage failures, stale revisions and malformed entries fail closed. */
export function loadAtlasFavorites(): FavoriteStructure[] {
  try {
    const raw = window.sessionStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw || raw.length > 4096) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > FAVORITES_LIMIT) return [];
    const unique = new Set<string>();
    for (const item of parsed) {
      if (!validFavorite(item)) return [];
      const key = item.layer + ":" + item.id;
      if (unique.has(key)) return [];
      unique.add(key);
    }
    return parsed as FavoriteStructure[];
  } catch {
    return [];
  }
}

export function saveAtlasFavorites(favorites: readonly FavoriteStructure[]): void {
  try {
    if (favorites.length > FAVORITES_LIMIT || !favorites.every(validFavorite)) return;
    if (favorites.length === 0) {
      window.sessionStorage.removeItem(FAVORITES_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    }
  } catch {
    // A private browser with disabled session storage still supports in-memory favorites.
  }
}
