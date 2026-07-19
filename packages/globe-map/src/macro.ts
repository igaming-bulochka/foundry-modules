import { MODULE_ID } from "./types";
import { GlobeApp } from "./globe-app";

const OPEN_COMMAND = `game.modules.get("${MODULE_ID}")?.api?.open?.() ?? window.GlobeMap?.open?.();`;

/** Public API surface, exposed on both window.GlobeMap and the module's `api`. */
export const GlobeMapAPI = {
  open: () => GlobeApp.show(),
  close: () => GlobeApp.current?.close(),
  toggle: () => (GlobeApp.current ? GlobeApp.current.close() : GlobeApp.show()),
  isOpen: () => !!GlobeApp.current,
  createMacro: () => createOpenMacro(),
};

/**
 * Create (or reveal) a hotbar-ready macro that opens the map. Idempotent: keyed
 * by a module flag so repeated calls do not spawn duplicates.
 */
export async function createOpenMacro(): Promise<unknown> {
  const name = game.i18n.localize("GLOBEMAP.OpenButton");
  const existing = game.macros?.find(
    (m: any) => m.getFlag?.(MODULE_ID, "openMacro") || (m.name === name && m.command === OPEN_COMMAND),
  );
  if (existing) {
    ui.notifications.info(game.i18n.localize("GLOBEMAP.MacroExists"));
    return existing;
  }
  const macro = await Macro.create({
    name,
    type: "script",
    scope: "global",
    img: "icons/tools/navigation/map-marked-red.webp",
    command: OPEN_COMMAND,
    flags: { [MODULE_ID]: { openMacro: true } },
  });
  ui.notifications.info(game.i18n.localize("GLOBEMAP.MacroCreated"));
  return macro;
}
