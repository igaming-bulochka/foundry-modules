import { MODULE_ID, type Pin, type PartyPosition } from "./types";
import { SETTINGS } from "./settings";
import { persistWorldSetting } from "./socket";

export function getPins(): Pin[] {
  const raw = game.settings.get(MODULE_ID, SETTINGS.PINS);
  return Array.isArray(raw) ? (raw as Pin[]) : [];
}

export async function addPin(pin: Omit<Pin, "id">): Promise<Pin | null> {
  const created: Pin = { ...pin, id: foundry.utils.randomID(12) };
  const ok = await persistWorldSetting(SETTINGS.PINS, [...getPins(), created], "pins-updated");
  return ok ? created : null;
}

export async function updatePin(id: string, patch: Partial<Pin>): Promise<void> {
  const next = getPins().map((p) => (p.id === id ? { ...p, ...patch, id } : p));
  await persistWorldSetting(SETTINGS.PINS, next, "pins-updated");
}

export async function deletePin(id: string): Promise<void> {
  const next = getPins().filter((p) => p.id !== id);
  await persistWorldSetting(SETTINGS.PINS, next, "pins-updated");
}

export function getParty(): PartyPosition | null {
  const raw = game.settings.get(MODULE_ID, SETTINGS.PARTY);
  if (raw && typeof raw === "object" && "lng" in raw && "lat" in raw) {
    return raw as PartyPosition;
  }
  return null;
}

export async function setParty(pos: PartyPosition | null): Promise<void> {
  await persistWorldSetting(SETTINGS.PARTY, pos, "party-updated");
}
