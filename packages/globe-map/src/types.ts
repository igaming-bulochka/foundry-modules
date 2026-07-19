export const MODULE_ID = "globe-map";
export const SOCKET_EVENT = `module.${MODULE_ID}`;

export const TRAVEL_MODES = ["foot", "horse", "cart", "ship", "flight", "teleport", "other"] as const;
export type TravelMode = (typeof TRAVEL_MODES)[number];

// FontAwesome glyph per travel mode, used on waypoint cards and the journey line.
export const TRAVEL_MODE_ICONS: Record<TravelMode, string> = {
  foot: "fa-solid fa-person-walking",
  horse: "fa-solid fa-horse",
  cart: "fa-solid fa-caravan",
  ship: "fa-solid fa-sailboat",
  flight: "fa-solid fa-dragon",
  teleport: "fa-solid fa-hat-wizard",
  other: "fa-solid fa-route",
};

// Curated pin icon palette. Users pick from these in the pin editor; the value
// stored is the FontAwesome class string so custom classes also round-trip.
export interface PinIconChoice {
  id: string;
  icon: string;
  labelKey: string;
}

export const PIN_ICONS: PinIconChoice[] = [
  { id: "pin", icon: "fa-solid fa-location-dot", labelKey: "GLOBEMAP.Icon.pin" },
  { id: "city", icon: "fa-solid fa-city", labelKey: "GLOBEMAP.Icon.city" },
  { id: "castle", icon: "fa-solid fa-chess-rook", labelKey: "GLOBEMAP.Icon.castle" },
  { id: "town", icon: "fa-solid fa-house-chimney", labelKey: "GLOBEMAP.Icon.town" },
  { id: "ruin", icon: "fa-solid fa-dungeon", labelKey: "GLOBEMAP.Icon.ruin" },
  { id: "dungeon", icon: "fa-solid fa-torii-gate", labelKey: "GLOBEMAP.Icon.dungeon" },
  { id: "cave", icon: "fa-solid fa-mountain-sun", labelKey: "GLOBEMAP.Icon.cave" },
  { id: "mountain", icon: "fa-solid fa-mountain", labelKey: "GLOBEMAP.Icon.mountain" },
  { id: "forest", icon: "fa-solid fa-tree", labelKey: "GLOBEMAP.Icon.forest" },
  { id: "camp", icon: "fa-solid fa-campground", labelKey: "GLOBEMAP.Icon.camp" },
  { id: "tavern", icon: "fa-solid fa-beer-mug-empty", labelKey: "GLOBEMAP.Icon.tavern" },
  { id: "temple", icon: "fa-solid fa-place-of-worship", labelKey: "GLOBEMAP.Icon.temple" },
  { id: "port", icon: "fa-solid fa-anchor", labelKey: "GLOBEMAP.Icon.port" },
  { id: "quest", icon: "fa-solid fa-scroll", labelKey: "GLOBEMAP.Icon.quest" },
  { id: "danger", icon: "fa-solid fa-skull", labelKey: "GLOBEMAP.Icon.danger" },
  { id: "battle", icon: "fa-solid fa-khanda", labelKey: "GLOBEMAP.Icon.battle" },
  { id: "treasure", icon: "fa-solid fa-gem", labelKey: "GLOBEMAP.Icon.treasure" },
  { id: "crown", icon: "fa-solid fa-crown", labelKey: "GLOBEMAP.Icon.crown" },
  { id: "flag", icon: "fa-solid fa-flag", labelKey: "GLOBEMAP.Icon.flag" },
  { id: "star", icon: "fa-solid fa-star", labelKey: "GLOBEMAP.Icon.star" },
];

export const DEFAULT_PIN_ICON = "fa-solid fa-location-dot";
export const DEFAULT_PIN_COLOR = "#d4534a";
export const DEFAULT_PARTY_ICON = "fa-solid fa-people-group";

export interface Waypoint {
  id: string;
  name: string;
  lng: number;
  lat: number;
  arrivalDate?: string;
  departureDate?: string;
  travelDays?: number;
  travelMode: TravelMode;
  notes?: string;
  order: number;
}

export interface Pin {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  lng: number;
  lat: number;
}

export interface PartyPosition {
  lng: number;
  lat: number;
}

export type Projection = "globe" | "flat";

// A configurable pointy/flat-top hex grid, used to drop a Kingmaker style
// exploration grid over the Stolen Lands. All values are GM-configurable so
// the same grid works for any hex-crawl region on the map.
export interface HexGridConfig {
  centerLng: number;
  centerLat: number;
  hexMiles: number; // flat-to-flat width of a single hex in miles
  cols: number;
  rows: number;
  orientation: "flat" | "pointy";
  color: string;
  opacity: number;
  fillOpacity: number;
  showLabels: boolean;
}

// ---- Socket payloads --------------------------------------------------------

export interface PingPayload {
  type: "ping";
  lng: number;
  lat: number;
  userId: string;
  userName: string;
  color?: string;
}

export interface RefreshPayload {
  type: "pins-updated" | "party-updated" | "waypoints-updated";
}

export type SocketPayload = PingPayload | RefreshPayload;

// ---- Minimal Foundry ambient globals (until fvtt-types is wired in) ---------

declare global {
  const Hooks: {
    on(event: string, fn: (...args: any[]) => any): number;
    once(event: string, fn: (...args: any[]) => any): number;
    off(event: string, id: number): void;
    callAll(event: string, ...args: any[]): boolean;
  };
  const game: {
    user: { id: string; name: string; isGM: boolean; color?: { css?: string } | string };
    users: { get(id: string): { id: string; name: string } | undefined } & Iterable<any>;
    i18n: {
      localize(key: string): string;
      format(key: string, data: Record<string, unknown>): string;
    };
    settings: {
      register(namespace: string, key: string, options: any): void;
      registerMenu(namespace: string, key: string, options: any): void;
      get(namespace: string, key: string): any;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    socket: {
      on(event: string, fn: (...args: any[]) => any): void;
      emit(event: string, payload: unknown): void;
    };
    modules: Map<string, { id: string; active: boolean; api?: unknown }>;
    macros?: { find(fn: (m: any) => boolean): any };
    keybindings?: { register(namespace: string, action: string, data: any): void };
  };
  const ui: {
    notifications: {
      info(msg: string, opts?: object): void;
      warn(msg: string, opts?: object): void;
      error(msg: string, opts?: object): void;
    };
  };
  const foundry: {
    applications: {
      api: {
        ApplicationV2: any;
        DialogV2: any;
      };
    };
    utils: {
      randomID(length?: number): string;
      debounce<T extends (...a: any[]) => any>(fn: T, ms: number): T;
    };
  };
  const Macro: any;
  const socketlib:
    | {
        registerModule(id: string): SocketlibSocket;
      }
    | undefined;
  interface SocketlibSocket {
    register(name: string, fn: (...args: any[]) => any): void;
    executeAsGM(name: string, ...args: any[]): Promise<any>;
    executeForEveryone(name: string, ...args: any[]): Promise<any>;
    executeForOthers(name: string, ...args: any[]): Promise<any>;
  }
  interface Window {
    GlobeMap: any;
  }
}
