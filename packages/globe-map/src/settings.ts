import {
  MODULE_ID,
  type Pin,
  type PartyPosition,
  type Projection,
  type HexGridConfig,
  DEFAULT_PARTY_ICON,
  DEFAULT_PIN_ICON,
  DEFAULT_PIN_COLOR,
} from "./types";

export const SETTINGS = {
  // Map look + framing (world / global)
  TILE_STYLE: "tileStyle",
  TILE_DATA_BASE: "tileDataBase",
  INITIAL_CENTER: "initialCenter",
  INITIAL_ZOOM: "initialZoom",
  DEFAULT_PROJECTION: "defaultProjection",
  ANIMATIONS: "animations",

  // Scene control + campaign-tools folder (world / global defaults)
  CONTROL_ENABLED: "controlEnabled",
  CONTROL_ICON: "controlIcon",
  GROUP_ENABLED: "groupEnabled",
  GROUP_NAME: "groupName",
  GROUP_ICON: "groupIcon",

  // Personal overrides (client)
  PERSONAL_OVERRIDE: "personalOverride",
  CONTROL_ENABLED_P: "controlEnabledPersonal",
  CONTROL_ICON_P: "controlIconPersonal",
  GROUP_NAME_P: "groupNamePersonal",
  GROUP_ICON_P: "groupIconPersonal",

  // Party / pin defaults (world / global)
  PARTY_ICON: "partyIcon",
  DEFAULT_PIN_ICON: "defaultPinIcon",
  DEFAULT_PIN_COLOR: "defaultPinColor",

  // Kingmaker hex grid (world / global)
  HEX_CONFIG: "hexConfig",

  // Per-user view memory (client)
  LAST_PROJECTION: "lastProjection",
  LAST_HEX: "lastHex",

  // Hidden data stores (world)
  PINS: "pins",
  PARTY: "party",
  WAYPOINTS: "waypoints",
} as const;

export const STYLE_PRESETS = ["golarion", "earth"] as const;
const DEFAULT_TILE_STYLE = "golarion";

// Where the Golarion tile data (golarion.pmtiles + terrain/) is fetched from.
// Default: the shared CDN bucket, so the map data "comes with the module" on any
// server without copying the 305 MB file locally. Leave blank to fetch from the
// Foundry server itself (Data/modules/globe-map/...). Switch to the pretty CDN
// domain (https://foundry-modules.schmooky.dev/globe-map) once its DNS is live.
const DEFAULT_TILE_DATA_BASE = "https://s3.twcstorage.ru/foundry-modules/globe-map";

// Stolen Lands on the pf-wikis Golarion map, measured from the tile data:
// bounded by Pitax (lng ~3.9), Mivon (~6.0) and the Little Sellen (~8.45) east,
// Brevoy/Rostland (lat ~48.6) north, and the Sellen River (~45.5) south. Center
// ~(6.0, 47.1). 12 miles across is the canonical Kingmaker hex ("12 miles from
// side to side"); at this map's Earth scale the grid spans ~214 mi (~35k sq mi),
// matching the Stolen Lands. The GM nudges center/size to taste.
export const DEFAULT_HEX_CONFIG: HexGridConfig = {
  centerLng: 6.0,
  centerLat: 47.1,
  hexMiles: 12,
  // Small, local grid: an explorable neighbourhood the players can realistically
  // claim, not the whole region. ~96 x 108 mi. Grow it in the hex settings.
  cols: 8,
  rows: 9,
  orientation: "flat",
  color: "#e0a92b",
  opacity: 0.95,
  fillOpacity: 0.06,
  showLabels: false,
  followParty: true,
};

export function registerSettings(): void {
  const reg = (key: string, options: any) => game.settings.register(MODULE_ID, key, options);

  reg(SETTINGS.TILE_STYLE, {
    name: "GLOBEMAP.SettingTileStyle",
    hint: "GLOBEMAP.SettingTileStyleHint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_TILE_STYLE,
    onChange: () => reopenIfOpen(),
  });

  reg(SETTINGS.TILE_DATA_BASE, {
    name: "GLOBEMAP.SettingTileDataBase",
    hint: "GLOBEMAP.SettingTileDataBaseHint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_TILE_DATA_BASE,
    onChange: () => reopenIfOpen(),
  });

  reg(SETTINGS.INITIAL_CENTER, {
    name: "GLOBEMAP.SettingInitialCenter",
    hint: "GLOBEMAP.SettingInitialCenterHint",
    scope: "world",
    config: true,
    type: String,
    default: "0,20",
  });

  reg(SETTINGS.INITIAL_ZOOM, {
    name: "GLOBEMAP.SettingInitialZoom",
    hint: "GLOBEMAP.SettingInitialZoomHint",
    scope: "world",
    config: true,
    type: Number,
    default: 1.5,
    range: { min: 0, max: 12, step: 0.5 },
  });

  reg(SETTINGS.DEFAULT_PROJECTION, {
    name: "GLOBEMAP.SettingDefaultProjection",
    hint: "GLOBEMAP.SettingDefaultProjectionHint",
    scope: "world",
    config: true,
    type: String,
    choices: { globe: "GLOBEMAP.Projection.globe", flat: "GLOBEMAP.Projection.flat" },
    default: "globe",
  });

  reg(SETTINGS.ANIMATIONS, {
    name: "GLOBEMAP.SettingAnimations",
    hint: "GLOBEMAP.SettingAnimationsHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (v: boolean) => document.body.classList.toggle("globe-map-reduce-motion", !v),
  });

  // ---- Scene control + folder (global defaults) -----------------------------

  reg(SETTINGS.CONTROL_ENABLED, {
    name: "GLOBEMAP.SettingControlEnabled",
    hint: "GLOBEMAP.SettingControlEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.CONTROL_ICON, {
    name: "GLOBEMAP.SettingControlIcon",
    hint: "GLOBEMAP.SettingControlIconHint",
    scope: "world",
    config: true,
    type: String,
    default: "fa-solid fa-earth-americas",
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.GROUP_ENABLED, {
    name: "GLOBEMAP.SettingGroupEnabled",
    hint: "GLOBEMAP.SettingGroupEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.GROUP_NAME, {
    name: "GLOBEMAP.SettingGroupName",
    hint: "GLOBEMAP.SettingGroupNameHint",
    scope: "world",
    config: true,
    type: String,
    default: "Campaign Tools",
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.GROUP_ICON, {
    name: "GLOBEMAP.SettingGroupIcon",
    hint: "GLOBEMAP.SettingGroupIconHint",
    scope: "world",
    config: true,
    type: String,
    default: "fa-solid fa-toolbox",
    onChange: () => rerenderControls(),
  });

  // ---- Personal overrides (client) ------------------------------------------

  reg(SETTINGS.PERSONAL_OVERRIDE, {
    name: "GLOBEMAP.SettingPersonalOverride",
    hint: "GLOBEMAP.SettingPersonalOverrideHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.CONTROL_ENABLED_P, {
    name: "GLOBEMAP.SettingControlEnabledP",
    hint: "GLOBEMAP.SettingControlEnabledPHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.CONTROL_ICON_P, {
    name: "GLOBEMAP.SettingControlIconP",
    hint: "GLOBEMAP.SettingControlIconPHint",
    scope: "client",
    config: true,
    type: String,
    default: "",
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.GROUP_NAME_P, {
    name: "GLOBEMAP.SettingGroupNameP",
    hint: "GLOBEMAP.SettingGroupNamePHint",
    scope: "client",
    config: true,
    type: String,
    default: "",
    onChange: () => rerenderControls(),
  });

  reg(SETTINGS.GROUP_ICON_P, {
    name: "GLOBEMAP.SettingGroupIconP",
    hint: "GLOBEMAP.SettingGroupIconPHint",
    scope: "client",
    config: true,
    type: String,
    default: "",
    onChange: () => rerenderControls(),
  });

  // ---- Party / pin defaults -------------------------------------------------

  reg(SETTINGS.PARTY_ICON, {
    name: "GLOBEMAP.SettingPartyIcon",
    hint: "GLOBEMAP.SettingPartyIconHint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_PARTY_ICON,
  });

  reg(SETTINGS.DEFAULT_PIN_ICON, {
    name: "GLOBEMAP.SettingDefaultPinIcon",
    hint: "GLOBEMAP.SettingDefaultPinIconHint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_PIN_ICON,
  });

  reg(SETTINGS.DEFAULT_PIN_COLOR, {
    name: "GLOBEMAP.SettingDefaultPinColor",
    hint: "GLOBEMAP.SettingDefaultPinColorHint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_PIN_COLOR,
  });

  // ---- Kingmaker hex grid ---------------------------------------------------

  reg(SETTINGS.HEX_CONFIG, {
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_HEX_CONFIG,
    onChange: () => reopenHexIfOpen(),
  });

  // ---- Per-user view memory -------------------------------------------------

  reg(SETTINGS.LAST_PROJECTION, { scope: "client", config: false, type: String, default: "" });
  reg(SETTINGS.LAST_HEX, { scope: "client", config: false, type: Boolean, default: false });

  // ---- Hidden data stores ---------------------------------------------------

  reg(SETTINGS.PINS, { scope: "world", config: false, type: Array, default: [] as Pin[] });
  reg(SETTINGS.PARTY, { scope: "world", config: false, type: Object, default: null as PartyPosition | null });
  reg(SETTINGS.WAYPOINTS, { scope: "world", config: false, type: Array, default: [] });
}

// ---- Reads ------------------------------------------------------------------

const get = (k: string) => game.settings.get(MODULE_ID, k);

export function getTileStyle(): string {
  return get(SETTINGS.TILE_STYLE) || DEFAULT_TILE_STYLE;
}

/** Base URL for golarion.pmtiles + terrain tiles. Empty => Foundry-served. */
export function getTileDataBase(): string {
  const v = get(SETTINGS.TILE_DATA_BASE);
  return typeof v === "string" ? v.trim().replace(/\/+$/, "") : DEFAULT_TILE_DATA_BASE;
}

export function getInitialCenter(): [number, number] {
  const raw = String(get(SETTINGS.INITIAL_CENTER) || "0,20");
  const [lng, lat] = raw.split(",").map((s) => Number(s.trim()));
  if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  return [0, 20];
}

export function getInitialZoom(): number {
  const z = Number(get(SETTINGS.INITIAL_ZOOM));
  return Number.isFinite(z) ? z : 1.5;
}

export function getDefaultProjection(): Projection {
  return get(SETTINGS.DEFAULT_PROJECTION) === "flat" ? "flat" : "globe";
}

export function getAnimationsEnabled(): boolean {
  return get(SETTINGS.ANIMATIONS) !== false;
}

export function getPartyIcon(): string {
  return String(get(SETTINGS.PARTY_ICON) || DEFAULT_PARTY_ICON);
}

export function getDefaultPinIcon(): string {
  return String(get(SETTINGS.DEFAULT_PIN_ICON) || DEFAULT_PIN_ICON);
}

export function getDefaultPinColor(): string {
  return String(get(SETTINGS.DEFAULT_PIN_COLOR) || DEFAULT_PIN_COLOR);
}

export function getHexConfig(): HexGridConfig {
  const raw = get(SETTINGS.HEX_CONFIG);
  if (raw && typeof raw === "object") return { ...DEFAULT_HEX_CONFIG, ...raw };
  return { ...DEFAULT_HEX_CONFIG };
}

export async function setHexConfig(patch: Partial<HexGridConfig>): Promise<void> {
  await game.settings.set(MODULE_ID, SETTINGS.HEX_CONFIG, { ...getHexConfig(), ...patch });
}

export function getLastProjection(): Projection | null {
  const v = get(SETTINGS.LAST_PROJECTION);
  return v === "flat" || v === "globe" ? v : null;
}

export function rememberProjection(p: Projection): void {
  void game.settings.set(MODULE_ID, SETTINGS.LAST_PROJECTION, p);
}

export function getLastHex(): boolean {
  return get(SETTINGS.LAST_HEX) === true;
}

export function rememberHex(on: boolean): void {
  void game.settings.set(MODULE_ID, SETTINGS.LAST_HEX, on);
}

// ---- Scene control resolution (global default vs personal override) ---------

export interface ControlConfig {
  enabled: boolean;
  icon: string;
  groupEnabled: boolean;
  groupName: string;
  groupIcon: string;
}

export function resolveControlConfig(): ControlConfig {
  const personal = get(SETTINGS.PERSONAL_OVERRIDE) === true;
  const pick = (globalKey: string, personalKey: string, fallback: string): string => {
    if (personal) {
      const p = String(get(personalKey) || "").trim();
      if (p) return p;
    }
    return String(get(globalKey) || fallback);
  };
  return {
    enabled: personal ? get(SETTINGS.CONTROL_ENABLED_P) !== false : get(SETTINGS.CONTROL_ENABLED) !== false,
    icon: pick(SETTINGS.CONTROL_ICON, SETTINGS.CONTROL_ICON_P, "fa-solid fa-earth-americas"),
    groupEnabled: get(SETTINGS.GROUP_ENABLED) !== false,
    groupName: pick(SETTINGS.GROUP_NAME, SETTINGS.GROUP_NAME_P, "Campaign Tools"),
    groupIcon: pick(SETTINGS.GROUP_ICON, SETTINGS.GROUP_ICON_P, "fa-solid fa-toolbox"),
  };
}

// ---- Small re-render hooks --------------------------------------------------
// Kept as thin indirection so settings.ts stays free of app/UI imports.

type Cb = () => void;
let onReopen: Cb = () => {};
let onReopenHex: Cb = () => {};
export function registerReopenHandlers(full: Cb, hex: Cb): void {
  onReopen = full;
  onReopenHex = hex;
}
function reopenIfOpen(): void {
  onReopen();
}
function reopenHexIfOpen(): void {
  onReopenHex();
}
function rerenderControls(): void {
  try {
    (globalThis as any).ui?.controls?.render?.(true);
  } catch {
    /* controls not ready */
  }
}
