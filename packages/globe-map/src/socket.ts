import { MODULE_ID, SOCKET_EVENT, type PingPayload } from "./types";

export type RefreshType = "pins-updated" | "party-updated" | "waypoints-updated";

// Only these world-setting keys may be written on behalf of a non-GM client.
const WRITABLE = new Set(["pins", "party", "waypoints", "hexConfig"]);

let lib: SocketlibSocket | null = null;
let onRefresh: (type: RefreshType) => void = () => {};
let onPingLocal: (p: PingPayload) => void = () => {};

/** Wire the dispatch targets (the running app) without importing it here. */
export function wireDispatch(
  refresh: (t: RefreshType) => void,
  ping: (p: PingPayload) => void,
): void {
  onRefresh = refresh;
  onPingLocal = ping;
}

/** Called from the socketlib.ready hook. Safe to call when socketlib is absent. */
export function initSocketlib(): void {
  if (typeof socketlib === "undefined" || !socketlib) return;
  lib = socketlib.registerModule(MODULE_ID);
  lib.register("persist", _gmPersist);
  lib.register("refresh", (t: RefreshType) => onRefresh(t));
  lib.register("ping", (p: PingPayload) => onPingLocal(p));
  console.info(`[${MODULE_ID}] socketlib bridge active`);
}

export function hasSocketlib(): boolean {
  return !!lib;
}

/** Legacy fallback listener, attached by index.ts only when socketlib is absent. */
export function attachLegacyListener(): void {
  game.socket.on(SOCKET_EVENT, (payload: any) => {
    if (!payload || typeof payload !== "object") return;
    if (payload.type === "ping") onPingLocal(payload as PingPayload);
    else onRefresh(payload.type as RefreshType);
  });
}

async function _gmPersist(key: string, value: unknown, refreshType: RefreshType): Promise<void> {
  if (!game.user.isGM) return; // only the authoritative GM writes world settings
  if (!WRITABLE.has(key)) return;
  await game.settings.set(MODULE_ID, key, value);
  broadcastRefresh(refreshType);
}

/**
 * Persist a world-scoped data store. GM clients write directly; players route
 * the write through the GM via socketlib. Returns false if no path exists
 * (no socketlib and no GM authority), after warning the user.
 */
export async function persistWorldSetting(
  key: string,
  value: unknown,
  refreshType: RefreshType,
): Promise<boolean> {
  if (game.user.isGM) {
    await game.settings.set(MODULE_ID, key, value);
    broadcastRefresh(refreshType);
    return true;
  }
  if (lib) {
    await lib.executeAsGM("persist", key, value, refreshType);
    return true;
  }
  ui.notifications.warn(game.i18n.localize("GLOBEMAP.NeedGM"));
  return false;
}

/** Tell every client (including this one) to redraw the given layer. */
export function broadcastRefresh(type: RefreshType): void {
  if (lib) {
    lib.executeForEveryone("refresh", type);
  } else {
    game.socket.emit(SOCKET_EVENT, { type });
    onRefresh(type);
  }
}

/** Fire a ping that animates on every connected client. */
export function sendPing(lng: number, lat: number, color?: string): void {
  const payload: PingPayload = {
    type: "ping",
    lng,
    lat,
    userId: game.user.id,
    userName: game.user.name,
    color,
  };
  if (lib) {
    lib.executeForEveryone("ping", payload);
  } else {
    game.socket.emit(SOCKET_EVENT, payload);
    onPingLocal(payload);
  }
}
