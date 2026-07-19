import "../styles/globe-map.css";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { MODULE_ID, type PingPayload } from "./types";
import { registerSettings, registerReopenHandlers, resolveControlConfig } from "./settings";
import { GlobeApp } from "./globe-app";
import { dispatchPing } from "./pings";
import {
  initSocketlib,
  hasSocketlib,
  attachLegacyListener,
  wireDispatch,
  type RefreshType,
} from "./socket";
import { GlobeMapAPI, createOpenMacro } from "./macro";

Hooks.once("init", () => {
  registerSettings();
  registerReopenHandlers(
    () => GlobeApp.reopen(),
    () => GlobeApp.refreshHex(),
  );

  // Register pmtiles protocol once, before any map is created.
  maplibregl.addProtocol("pmtiles", new Protocol().tile);

  // Keybinding (unbound by default; users set it in Configure Controls).
  game.keybindings?.register(MODULE_ID, "openMap", {
    name: "GLOBEMAP.Keybind.Open",
    hint: "GLOBEMAP.Keybind.OpenHint",
    editable: [],
    onDown: () => {
      GlobeApp.show();
      return true;
    },
    restricted: false,
  });

  // One-click "create macro" button inside the module settings UI.
  game.settings.registerMenu(MODULE_ID, "createMacroMenu", {
    name: "GLOBEMAP.SettingCreateMacro",
    label: "GLOBEMAP.SettingCreateMacroLabel",
    hint: "GLOBEMAP.SettingCreateMacroHint",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: CreateMacroMenu,
    restricted: false,
  });
});

// socketlib registers its modules during this hook; safe if socketlib absent.
Hooks.once("socketlib.ready", () => initSocketlib());

Hooks.once("ready", () => {
  const refresh = (type: RefreshType) => {
    if (type === "pins-updated") GlobeApp.refresh();
    else if (type === "party-updated") GlobeApp.refreshParty();
    else if (type === "waypoints-updated") GlobeApp.refreshJourney();
  };
  const ping = (p: PingPayload) => dispatchPing(p);
  wireDispatch(refresh, ping);

  // Fallback wire-up when socketlib is not installed.
  if (!hasSocketlib()) attachLegacyListener();

  window.GlobeMap = GlobeMapAPI;
  const mod = game.modules.get(MODULE_ID) as any;
  if (mod) mod.api = GlobeMapAPI;
});

Hooks.on("getSceneControlButtons", (controls: any) => {
  const cfg = resolveControlConfig();
  if (!cfg.enabled) return;

  const open = () => GlobeApp.show();
  const tool = {
    name: "open-globe",
    title: game.i18n.localize("GLOBEMAP.OpenButton"),
    icon: cfg.icon,
    button: true,
    visible: true,
    order: 1,
    onChange: open,
    onClick: open,
  };

  if (cfg.groupEnabled) {
    attachTool(controls, {
      key: "campaign-tools",
      title: cfg.groupName,
      icon: cfg.groupIcon,
      tool,
    });
  } else {
    attachTool(controls, {
      key: "globe-map",
      title: game.i18n.localize("GLOBEMAP.ModuleTitle"),
      icon: cfg.icon,
      tool,
    });
  }
});

/** Add a button tool under a control group, handling both the v12 array shape
 * and the v13+ record shape of the scene controls structure. */
function attachTool(
  controls: any,
  spec: { key: string; title: string; icon: string; tool: any },
): void {
  const groupSpec = { name: spec.key, title: spec.title, icon: spec.icon, layer: "tokens", visible: true };

  if (Array.isArray(controls)) {
    let group = controls.find((c: any) => c?.name === spec.key);
    if (!group) {
      group = { ...groupSpec, tools: [] };
      controls.push(group);
    }
    group.title = spec.title;
    group.icon = spec.icon;
    if (!Array.isArray(group.tools)) group.tools = [];
    if (!group.tools.find((t: any) => t?.name === spec.tool.name)) group.tools.push(spec.tool);
    return;
  }

  if (controls && typeof controls === "object") {
    let group = controls[spec.key];
    if (!group) {
      group = { ...groupSpec, tools: {} };
      controls[spec.key] = group;
    }
    group.title = spec.title;
    group.icon = spec.icon;
    if (typeof group.tools !== "object" || group.tools === null) group.tools = {};
    group.tools[spec.tool.name] = spec.tool;
  }
}

/** Minimal settings-menu shim: performs the macro creation, never shows a window. */
class CreateMacroMenu extends foundry.applications.api.ApplicationV2 {
  async render(): Promise<this> {
    await createOpenMacro();
    return this;
  }
}
