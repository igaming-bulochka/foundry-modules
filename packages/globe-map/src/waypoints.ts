import { MODULE_ID, type Waypoint, type TravelMode } from "./types";
import { SETTINGS } from "./settings";
import { persistWorldSetting } from "./socket";

export function getWaypoints(): Waypoint[] {
  const raw = game.settings.get(MODULE_ID, SETTINGS.WAYPOINTS);
  const list = Array.isArray(raw) ? (raw as Waypoint[]) : [];
  return list.slice().sort((a, b) => a.order - b.order);
}

async function persist(list: Waypoint[]): Promise<void> {
  await persistWorldSetting(SETTINGS.WAYPOINTS, list, "waypoints-updated");
}

export async function addWaypoint(w: Omit<Waypoint, "id" | "order">): Promise<Waypoint | null> {
  const list = getWaypoints();
  const created: Waypoint = { ...w, id: foundry.utils.randomID(12), order: list.length };
  const ok = await persistWorldSetting(SETTINGS.WAYPOINTS, [...list, created], "waypoints-updated");
  return ok ? created : null;
}

export async function updateWaypoint(id: string, patch: Partial<Waypoint>): Promise<void> {
  const next = getWaypoints().map((w) => (w.id === id ? { ...w, ...patch, id } : w));
  await persist(next);
}

export async function deleteWaypoint(id: string): Promise<void> {
  const next = getWaypoints()
    .filter((w) => w.id !== id)
    .map((w, i) => ({ ...w, order: i }));
  await persist(next);
}

export async function reorderWaypoint(id: string, direction: -1 | 1): Promise<void> {
  const list = getWaypoints();
  const idx = list.findIndex((w) => w.id === id);
  if (idx === -1) return;
  const target = idx + direction;
  if (target < 0 || target >= list.length) return;
  const next = list.slice();
  [next[idx], next[target]] = [next[target], next[idx]];
  next.forEach((w, i) => (w.order = i));
  await persist(next);
}

/** Move a waypoint to an absolute index (used by drag-to-reorder). */
export async function moveWaypointToIndex(id: string, targetIdx: number): Promise<void> {
  const list = getWaypoints();
  const idx = list.findIndex((w) => w.id === id);
  if (idx === -1) return;
  const clamped = Math.max(0, Math.min(list.length - 1, targetIdx));
  if (clamped === idx) return;
  const next = list.slice();
  const [moved] = next.splice(idx, 1);
  next.splice(clamped, 0, moved);
  next.forEach((w, i) => (w.order = i));
  await persist(next);
}

const EARTH_RADIUS_MI = 3958.8;
export function haversineMiles(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const ALL_TRAVEL_MODES: TravelMode[] = [
  "foot",
  "horse",
  "cart",
  "ship",
  "flight",
  "teleport",
  "other",
];
