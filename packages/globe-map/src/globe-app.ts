import maplibregl, {
  type LngLat,
  type Map as MlMap,
  type MapGeoJSONFeature,
  type GeoJSONSource,
  Marker,
  Popup,
} from "maplibre-gl";
import DOMPurify from "dompurify";
import {
  MODULE_ID,
  type Pin,
  type Waypoint,
  type Projection,
  type PingPayload,
  DEFAULT_PIN_COLOR,
  DEFAULT_PIN_ICON,
  TRAVEL_MODE_ICONS,
} from "./types";
import {
  getTileStyle,
  getTileDataBase,
  getInitialCenter,
  getInitialZoom,
  getDefaultProjection,
  getLastProjection,
  rememberProjection,
  getLastHex,
  rememberHex,
  getPartyIcon,
  getDefaultPinIcon,
  getDefaultPinColor,
  getHexConfig,
  setHexConfig,
  getAnimationsEnabled,
} from "./settings";
import { getPins, addPin, updatePin, deletePin, getParty, setParty } from "./pins";
import { sendPing } from "./socket";
import { onPing } from "./pings";
import { resolveStyle, DEM_SOURCE_ID } from "./styles";
import {
  getWaypoints,
  addWaypoint,
  updateWaypoint,
  deleteWaypoint,
  reorderWaypoint,
  moveWaypointToIndex,
  haversineMiles,
} from "./waypoints";
import { waypointDialog, confirmDeleteWaypoint } from "./journey-dialog";
import { pinDialog } from "./dialogs";
import { hexDialog } from "./hex-dialog";
import { buildHexGeoJSON } from "./hexgrid";
import { escapeHtml, linkifyIfUrl } from "./util";

let appInstance: GlobeApp | null = null;

const BUILT_IN_FEATURE_LAYERS = [
  "locations-dot",
  "locations-label",
  "labels-misc",
  "subregion-labels",
  "province-labels",
  "region-labels",
  "nation-labels",
  "line-labels",
];

const HEX_SOURCE = "gm-hex";
const HEX_FILL = "gm-hex-fill";
const HEX_CASING = "gm-hex-casing";
const HEX_LINE = "gm-hex-line";
const HEX_LABEL = "gm-hex-label";
const HEX_LAYERS = [HEX_FILL, HEX_CASING, HEX_LINE];
// Zoom-scaled line width so 12-mile hexes read at any zoom instead of vanishing.
const HEX_WIDTH_EXPR = ["interpolate", ["linear"], ["zoom"], 3, 0.5, 6, 1.4, 9, 3, 12, 5] as any;

function moduleBaseUrl(): string {
  return `${window.location.origin}/modules/${MODULE_ID}`;
}

function userColor(): string {
  const c: any = game.user.color;
  if (typeof c === "string") return c;
  if (c && typeof c.css === "string") return c.css;
  return "#ff6b6b";
}

export class GlobeApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "globe-map-app",
    classes: ["globe-map"],
    tag: "div",
    window: {
      title: "GLOBEMAP.WindowTitle",
      icon: "fa-solid fa-earth-americas",
      resizable: true,
      contentClasses: ["globe-map-window"],
    },
    position: { width: 980, height: 660 },
  };

  private map: MlMap | null = null;
  private projection: Projection = "globe";
  private hexOn = false;
  private terrain3D = false;
  private journeyOpen = false;
  private pinMarkers = new Map<string, Marker>();
  private waypointMarkers = new Map<string, Marker>();
  private partyMarker: Marker | null = null;
  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private offPing: (() => void) | null = null;
  private featurePopup: Popup | null = null;
  private dragSrcId: string | null = null;

  static show(): GlobeApp {
    if (!appInstance) appInstance = new GlobeApp();
    appInstance.render({ force: true });
    return appInstance;
  }

  static get current(): GlobeApp | null {
    return appInstance;
  }

  static refresh(): void {
    appInstance?.redrawPins();
  }
  static refreshParty(): void {
    appInstance?.redrawParty();
  }
  static refreshJourney(): void {
    appInstance?.refreshJourneySource();
    appInstance?.redrawWaypointMarkers();
    appInstance?.renderJourneyPanel();
  }
  static refreshHex(): void {
    appInstance?.refreshHexSource();
  }

  /** Re-open cleanly (used when a world-scoped style setting changes). */
  static reopen(): void {
    if (!appInstance) return;
    void appInstance.close().then(() => GlobeApp.show());
  }

  async _renderHTML(_context: unknown, _options: unknown): Promise<string> {
    const t = (k: string) => escapeHtml(game.i18n.localize(k));
    const isGM = game.user.isGM;
    const gmDivider = isGM ? `<div class="globe-map-tool-sep"></div>` : "";
    const gmTools = isGM
      ? `
        <button class="globe-map-tool" data-tool="addpin" type="button" title="${t("GLOBEMAP.Tool.AddPin")}"><i class="fa-solid fa-map-pin"></i></button>
        <button class="globe-map-tool" data-tool="hexconfig" type="button" title="${t("GLOBEMAP.Tool.HexConfig")}"><i class="fa-solid fa-sliders"></i></button>`
      : "";
    return `
      <div class="globe-map-container">
        <div class="globe-map-canvas"></div>

        <div class="globe-map-toolbar">
          <button class="globe-map-tool" data-tool="journey" type="button" title="${t("GLOBEMAP.JT.OpenPanel")}"><i class="fa-solid fa-route"></i></button>
          <button class="globe-map-tool" data-tool="projection" type="button" title="${t("GLOBEMAP.Tool.Projection")}"><i class="fa-solid fa-globe"></i></button>
          <button class="globe-map-tool" data-tool="hex" type="button" title="${t("GLOBEMAP.Tool.Hex")}"><i class="fa-solid fa-border-all"></i></button>
          <button class="globe-map-tool" data-tool="terrain" type="button" title="${t("GLOBEMAP.Terrain.Enable")}"><i class="fa-solid fa-mountain"></i></button>
          <button class="globe-map-tool" data-tool="home" type="button" title="${t("GLOBEMAP.Tool.Home")}"><i class="fa-solid fa-house"></i></button>
          ${gmDivider}
          ${gmTools}
        </div>

        <div class="globe-map-readout" data-empty="true"></div>

        <aside class="globe-map-journey-panel" data-open="${this.journeyOpen ? "true" : "false"}">
          <header class="globe-map-journey-head">
            <h3><i class="fa-solid fa-route"></i> ${t("GLOBEMAP.JT.Title")}</h3>
            <button type="button" class="globe-map-journey-close" title="${t("GLOBEMAP.JT.ClosePanel")}"><i class="fa-solid fa-xmark"></i></button>
          </header>
          <div class="globe-map-journey-body"></div>
        </aside>
      </div>
    `;
  }

  _replaceHTML(result: string, content: HTMLElement, _options: unknown): void {
    content.innerHTML = result;
  }

  _onRender(_context: unknown, _options: unknown): void {
    const root = this.element as HTMLElement;
    const container = root.querySelector<HTMLDivElement>(".globe-map-canvas");
    if (!container) return;
    this.container = container;

    document.body.classList.toggle("globe-map-reduce-motion", !getAnimationsEnabled());

    this.projection = getLastProjection() ?? getDefaultProjection();
    this.hexOn = this.projection === "flat" && getLastHex();

    this.map = new maplibregl.Map({
      container,
      style: resolveStyle(getTileStyle(), getTileDataBase() || moduleBaseUrl()),
      center: getInitialCenter(),
      zoom: getInitialZoom(),
      attributionControl: { compact: true },
      // MapLibre reads projection from the style; we set it explicitly after
      // load so the persisted per-user choice wins over the style default.
    });

    this.map.on("load", () => {
      if (!this.map) return;
      this.applyProjection(this.projection, false);
      this.ensureHexLayers();
      this.refreshHexSource();
      this.setHexVisible(this.hexOn);
      if (this.hexOn) this.flyToHexGrid();
      this.redrawPins();
      this.redrawParty();
      this.attachFeatureInteractions();
      this.ensureJourneyLayers();
      this.refreshJourneySource();
      this.redrawWaypointMarkers();
      this.updateToolbarState();
    });

    this.map.on("contextmenu", (e) => this.showContextMenu(e.point.x, e.point.y, e.lngLat));
    this.map.on("click", (e) => this.onMapClick(e));
    this.map.on("mousemove", (e) => this.updateReadout(e.lngLat, e.point));
    this.map.on("mouseout", () => this.clearReadout());

    this.offPing = onPing((p) => this.showPingAt(p));

    this.resizeObserver = new ResizeObserver(() => this.map?.resize());
    this.resizeObserver.observe(container);

    // Toolbar wiring
    root.querySelectorAll<HTMLButtonElement>(".globe-map-tool").forEach((btn) =>
      btn.addEventListener("click", () => this.onToolClick(btn.dataset.tool!)),
    );
    root
      .querySelector<HTMLButtonElement>(".globe-map-journey-close")
      ?.addEventListener("click", () => this.setJourneyOpen(false));

    this.renderJourneyPanel();
  }

  // ---- Toolbar --------------------------------------------------------------

  private onToolClick(tool: string): void {
    switch (tool) {
      case "journey":
        this.setJourneyOpen(!this.journeyOpen);
        break;
      case "projection":
        this.applyProjection(this.projection === "globe" ? "flat" : "globe", true);
        break;
      case "hex":
        this.toggleHex();
        break;
      case "terrain":
        this.setTerrain3D(!this.terrain3D);
        break;
      case "home":
        this.map?.easeTo({ center: getInitialCenter(), zoom: getInitialZoom(), pitch: 0, duration: 700 });
        break;
      case "addpin":
        this.beginAddPinAtCenter();
        break;
      case "hexconfig":
        void this.openHexConfig();
        break;
    }
  }

  private updateToolbarState(): void {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;
    const btn = (tool: string) =>
      root.querySelector<HTMLButtonElement>(`.globe-map-tool[data-tool="${tool}"]`);

    const proj = btn("projection");
    if (proj) {
      const flat = this.projection === "flat";
      proj.querySelector("i")!.className = flat ? "fa-solid fa-map" : "fa-solid fa-globe";
      proj.title = game.i18n.localize(flat ? "GLOBEMAP.Tool.ProjectionToGlobe" : "GLOBEMAP.Tool.ProjectionToFlat");
      proj.setAttribute("aria-pressed", flat ? "true" : "false");
    }

    const hex = btn("hex");
    if (hex) {
      // Always clickable: enabling it switches to flat view automatically.
      hex.setAttribute("aria-pressed", this.hexOn ? "true" : "false");
      hex.title = game.i18n.localize(this.hexOn ? "GLOBEMAP.Tool.HexHide" : "GLOBEMAP.Tool.HexShow");
    }

    const hexcfg = btn("hexconfig");
    if (hexcfg) hexcfg.style.display = "";

    const terrain = btn("terrain");
    if (terrain) {
      terrain.setAttribute("aria-pressed", this.terrain3D ? "true" : "false");
      terrain.title = game.i18n.localize(this.terrain3D ? "GLOBEMAP.Terrain.Disable" : "GLOBEMAP.Terrain.Enable");
    }
  }

  // ---- Projection -----------------------------------------------------------

  private applyProjection(p: Projection, animate: boolean): void {
    if (!this.map) return;
    this.projection = p;
    const setProj = (type: string) =>
      (this.map as unknown as { setProjection: (x: { type: string }) => void }).setProjection({ type });

    if (p === "globe") {
      // Leaving flat: terrain (which requires mercator) can't ride along.
      if (this.terrain3D) {
        this.map.setTerrain(null);
        this.terrain3D = false;
      }
      setProj("globe");
      this.map.easeTo({ pitch: 0, duration: animate ? 500 : 0 });
      this.setHexVisible(false);
    } else {
      setProj("mercator");
      this.setHexVisible(this.hexOn);
    }
    rememberProjection(p);
    this.updateToolbarState();
  }

  private setTerrain3D(enable: boolean): void {
    if (!this.map) return;
    const map = this.map;
    this.terrain3D = enable;
    const setProj = (type: string) =>
      (map as unknown as { setProjection: (x: { type: string }) => void }).setProjection({ type });

    if (enable) {
      // Terrain relief only reads on mercator at this world scale.
      setProj("mercator");
      this.projection = "flat";
      rememberProjection("flat");
      if (map.getSource(DEM_SOURCE_ID)) {
        map.setTerrain({ source: DEM_SOURCE_ID, exaggeration: 45 });
      } else {
        console.warn(`[${MODULE_ID}] no dem source in style; terrain inert`);
      }
      this.setHexVisible(this.hexOn);
    } else {
      map.setTerrain(null);
    }
    map.easeTo({ pitch: enable ? 60 : 0, duration: 600 });
    this.updateToolbarState();
  }

  // ---- Hex grid -------------------------------------------------------------

  private ensureHexLayers(): void {
    if (!this.map || this.map.getSource(HEX_SOURCE)) return;
    const cfg = getHexConfig();
    this.map.addSource(HEX_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    this.map.addLayer({
      id: HEX_FILL,
      type: "fill",
      source: HEX_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: { visibility: "none" },
      paint: { "fill-color": cfg.color, "fill-opacity": cfg.fillOpacity },
    });
    // Dark casing under the coloured line so the grid reads on land or water.
    this.map.addLayer({
      id: HEX_CASING,
      type: "line",
      source: HEX_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: { visibility: "none", "line-join": "round" },
      paint: {
        "line-color": "rgba(20, 14, 4, 0.55)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.5, 6, 2.8, 9, 5, 12, 7.5] as any,
      },
    });
    this.map.addLayer({
      id: HEX_LINE,
      type: "line",
      source: HEX_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: { visibility: "none", "line-join": "round" },
      paint: { "line-color": cfg.color, "line-width": HEX_WIDTH_EXPR, "line-opacity": cfg.opacity },
    });
    this.map.addLayer({
      id: HEX_LABEL,
      type: "symbol",
      source: HEX_SOURCE,
      filter: ["==", ["get", "isLabel"], true],
      layout: {
        visibility: "none",
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Semibold"],
        "text-size": 10,
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": cfg.color,
        "text-halo-color": "rgba(20,14,4,0.7)",
        "text-halo-width": 1,
      },
    });
  }

  private refreshHexSource(): void {
    if (!this.map) return;
    const cfg = getHexConfig();
    const src = this.map.getSource(HEX_SOURCE) as GeoJSONSource | undefined;
    src?.setData(buildHexGeoJSON(cfg) as any);
    // Re-apply data-driven paint from config each refresh.
    if (this.map.getLayer(HEX_FILL)) {
      this.map.setPaintProperty(HEX_FILL, "fill-color", cfg.color);
      this.map.setPaintProperty(HEX_FILL, "fill-opacity", cfg.fillOpacity);
    }
    if (this.map.getLayer(HEX_LINE)) {
      this.map.setPaintProperty(HEX_LINE, "line-color", cfg.color);
      this.map.setPaintProperty(HEX_LINE, "line-opacity", cfg.opacity);
      this.map.setPaintProperty(HEX_LINE, "line-width", HEX_WIDTH_EXPR);
    }
    if (this.map.getLayer(HEX_LABEL)) {
      this.map.setPaintProperty(HEX_LABEL, "text-color", cfg.color);
      this.map.setLayoutProperty(
        HEX_LABEL,
        "visibility",
        this.hexOn && cfg.showLabels ? "visible" : "none",
      );
    }
  }

  private setHexVisible(on: boolean): void {
    if (!this.map) return;
    const vis = on ? "visible" : "none";
    for (const id of HEX_LAYERS) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", vis);
    }
    if (this.map.getLayer(HEX_LABEL)) {
      const cfg = getHexConfig();
      this.map.setLayoutProperty(HEX_LABEL, "visibility", on && cfg.showLabels ? "visible" : "none");
    }
  }

  private toggleHex(): void {
    const turningOn = !this.hexOn;
    // The hex grid only exists in flat view; enabling it flips there for you.
    if (turningOn && this.projection !== "flat") this.applyProjection("flat", true);
    this.hexOn = turningOn;
    this.setHexVisible(this.hexOn);
    rememberHex(this.hexOn);
    if (this.hexOn) this.flyToHexGrid();
    this.updateToolbarState();
  }

  /** Frame the current hex grid so the user actually sees it when enabled. */
  private flyToHexGrid(): void {
    if (!this.map) return;
    const fc = buildHexGeoJSON(getHexConfig());
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of fc.features) {
      if (f.geometry.type !== "Polygon") continue;
      for (const ring of f.geometry.coordinates) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
    if (!Number.isFinite(minLng)) return;
    this.map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 60, maxZoom: 9, duration: 800 },
    );
  }

  private async openHexConfig(): Promise<void> {
    if (!game.user.isGM) return;
    const patch = await hexDialog(getHexConfig());
    if (!patch) return;
    await setHexConfig(patch);
    this.refreshHexSource();
    if (!this.hexOn) this.toggleHex();
    else this.flyToHexGrid();
  }

  // ---- Journey panel & layers ----------------------------------------------

  private setJourneyOpen(open: boolean): void {
    this.journeyOpen = open;
    const panel = (this.element as HTMLElement).querySelector<HTMLElement>(".globe-map-journey-panel");
    if (panel) panel.dataset.open = open ? "true" : "false";
    if (open) this.renderJourneyPanel();
  }

  private ensureJourneyLayers(): void {
    if (!this.map || this.map.getSource("kp-journey")) return;
    this.map.addSource("kp-journey", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    this.map.addLayer({
      id: "kp-journey-line",
      type: "line",
      source: "kp-journey",
      filter: ["==", ["geometry-type"], "LineString"],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#d4a017",
        "line-width": 3,
        "line-opacity": 0.9,
        "line-dasharray": [3, 1.5],
      },
    });
  }

  private refreshJourneySource(): void {
    if (!this.map) return;
    const wps = getWaypoints();
    const features: Array<Record<string, unknown>> = [];
    if (wps.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: wps.map((w) => [w.lng, w.lat]) },
        properties: {},
      });
    }
    const source = this.map.getSource("kp-journey") as GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features } as any);
  }

  private redrawWaypointMarkers(): void {
    if (!this.map) return;
    const seen = new Set<string>();
    const wps = getWaypoints();
    wps.forEach((w, i) => {
      seen.add(w.id);
      const existing = this.waypointMarkers.get(w.id);
      if (existing) {
        existing.setLngLat([w.lng, w.lat]);
        this.decorateWaypointEl(existing.getElement(), w, i);
        return;
      }
      this.waypointMarkers.set(w.id, this.createWaypointMarker(w, i));
    });
    for (const [id, marker] of this.waypointMarkers) {
      if (!seen.has(id)) {
        marker.remove();
        this.waypointMarkers.delete(id);
      }
    }
  }

  private decorateWaypointEl(el: HTMLElement, w: Waypoint, idx: number): void {
    el.innerHTML = `<span class="globe-map-wp-num">${idx + 1}</span><i class="${escapeHtml(TRAVEL_MODE_ICONS[w.travelMode] ?? "fa-solid fa-location-dot")}"></i>`;
    el.title = w.name;
  }

  private createWaypointMarker(w: Waypoint, idx: number): Marker {
    const el = document.createElement("div");
    el.className = "globe-map-wp-marker globe-map-drop-in";
    this.decorateWaypointEl(el, w, idx);
    setTimeout(() => el.classList.remove("globe-map-drop-in"), 500);

    const marker = new maplibregl.Marker({ element: el, anchor: "center", draggable: game.user.isGM })
      .setLngLat([w.lng, w.lat])
      .addTo(this.map!);

    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.map?.flyTo({ center: [w.lng, w.lat], zoom: Math.max(this.map.getZoom(), 5) });
    });
    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (game.user.isGM) void this.handleJourneyAction("edit", w.id);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (game.user.isGM) this.showWaypointContextMenu(w, ev.clientX, ev.clientY);
    });
    marker.on("dragend", async () => {
      if (!game.user.isGM) return;
      const ll = marker.getLngLat();
      await updateWaypoint(w.id, { lng: ll.lng, lat: ll.lat });
    });
    return marker;
  }

  private renderJourneyPanel(): void {
    const root = this.element as HTMLElement | undefined;
    const body = root?.querySelector<HTMLElement>(".globe-map-journey-body");
    if (!body) return;
    const isGM = game.user.isGM;
    const wps = getWaypoints();
    let totalMiles = 0;
    let totalDays = 0;
    for (let i = 1; i < wps.length; i++) {
      totalMiles += haversineMiles(wps[i - 1], wps[i]);
      totalDays += wps[i].travelDays ?? 0;
    }
    const totals = game.i18n.format("GLOBEMAP.JT.Totals", {
      count: wps.length,
      distance: totalMiles.toFixed(0),
      days: totalDays.toFixed(1),
    });
    const addBtn = isGM
      ? `<button class="globe-map-journey-add" type="button"><i class="fa-solid fa-plus"></i> ${escapeHtml(game.i18n.localize("GLOBEMAP.JT.AddManual"))}</button>`
      : "";
    if (wps.length === 0) {
      body.innerHTML = `
        <div class="globe-map-journey-totals">${escapeHtml(totals)}</div>
        ${addBtn}
        <p class="globe-map-journey-empty">${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Empty"))}</p>`;
    } else {
      const items = wps.map((w, i) => this.waypointCardHtml(w, i, wps[i - 1])).join("");
      body.innerHTML = `
        <div class="globe-map-journey-totals">${escapeHtml(totals)}</div>
        ${addBtn}
        <ol class="globe-map-journey-list">${items}</ol>`;
    }
    this.wireJourneyPanelActions();
  }

  private waypointCardHtml(w: Waypoint, idx: number, prev?: Waypoint): string {
    const isGM = game.user.isGM;
    const dist = prev ? haversineMiles(prev, w) : 0;
    const distText = prev ? game.i18n.format("GLOBEMAP.JT.LegDistance", { distance: dist.toFixed(0) }) : "";
    const daysText = w.travelDays ? game.i18n.format("GLOBEMAP.JT.LegDays", { days: w.travelDays }) : "";
    const fromText = prev
      ? `<div class="globe-map-jt-leg"><i class="fa-solid fa-arrow-right-long"></i> ${escapeHtml(game.i18n.format("GLOBEMAP.JT.LegFrom", { from: prev.name }))} · ${escapeHtml(distText)}${daysText ? " · " + escapeHtml(daysText) : ""}</div>`
      : "";
    const arrival = w.arrivalDate ? `<span class="globe-map-jt-date"><i class="fa-solid fa-calendar-day"></i> ${escapeHtml(w.arrivalDate)}</span>` : "";
    const departure = w.departureDate ? `<span class="globe-map-jt-date">&rarr; ${escapeHtml(w.departureDate)}</span>` : "";
    const modeIcon = TRAVEL_MODE_ICONS[w.travelMode] ?? "fa-solid fa-route";
    const modeLabel = game.i18n.localize(`GLOBEMAP.JT.Mode.${w.travelMode}`);
    const notes = w.notes ? `<div class="globe-map-jt-notes">${escapeHtml(w.notes)}</div>` : "";
    const controls = isGM
      ? `<div class="globe-map-jt-controls">
          <button data-jt="up" data-id="${w.id}" ${idx === 0 ? "disabled" : ""} title="${escapeHtml(game.i18n.localize("GLOBEMAP.JT.MoveUp"))}"><i class="fa-solid fa-arrow-up"></i></button>
          <button data-jt="down" data-id="${w.id}" title="${escapeHtml(game.i18n.localize("GLOBEMAP.JT.MoveDown"))}"><i class="fa-solid fa-arrow-down"></i></button>
          <button data-jt="fly" data-id="${w.id}" title="${escapeHtml(game.i18n.localize("GLOBEMAP.JT.FlyTo"))}"><i class="fa-solid fa-location-crosshairs"></i></button>
          <button data-jt="edit" data-id="${w.id}" title="${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Edit"))}"><i class="fa-solid fa-pen"></i></button>
          <button data-jt="delete" data-id="${w.id}" class="globe-map-jt-danger" title="${escapeHtml(game.i18n.localize("GLOBEMAP.PinDelete"))}"><i class="fa-solid fa-trash"></i></button>
        </div>`
      : `<div class="globe-map-jt-controls">
          <button data-jt="fly" data-id="${w.id}" title="${escapeHtml(game.i18n.localize("GLOBEMAP.JT.FlyTo"))}"><i class="fa-solid fa-location-crosshairs"></i></button>
        </div>`;
    return `
      <li class="globe-map-jt-card" data-id="${w.id}"${isGM ? " draggable=\"true\"" : ""}>
        <div class="globe-map-jt-num"><i class="${escapeHtml(modeIcon)}"></i></div>
        <div class="globe-map-jt-content">
          ${fromText}
          <div class="globe-map-jt-head">
            <span class="globe-map-jt-name">${idx + 1}. ${escapeHtml(w.name)}</span>
            <span class="globe-map-jt-mode">${escapeHtml(modeLabel)}</span>
          </div>
          <div class="globe-map-jt-dates">${arrival}${departure}</div>
          ${notes}
          ${controls}
        </div>
      </li>`;
  }

  private wireJourneyPanelActions(): void {
    const root = this.element as HTMLElement;
    root
      .querySelectorAll<HTMLButtonElement>(".globe-map-journey-add")
      .forEach((btn) => btn.addEventListener("click", () => this.openAddWaypoint()));
    root.querySelectorAll<HTMLButtonElement>("[data-jt]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        void this.handleJourneyAction(btn.dataset.jt!, btn.dataset.id!);
      }),
    );
    if (game.user.isGM) this.wireDragReorder(root);
  }

  private wireDragReorder(root: HTMLElement): void {
    const cards = root.querySelectorAll<HTMLElement>(".globe-map-jt-card[draggable='true']");
    cards.forEach((card) => {
      card.addEventListener("dragstart", () => {
        this.dragSrcId = card.dataset.id ?? null;
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        root.querySelectorAll(".drop-target").forEach((c) => c.classList.remove("drop-target"));
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        card.classList.add("drop-target");
      });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drop-target");
        const targetId = card.dataset.id;
        if (!this.dragSrcId || !targetId || this.dragSrcId === targetId) return;
        const list = getWaypoints();
        const targetIdx = list.findIndex((w) => w.id === targetId);
        void moveWaypointToIndex(this.dragSrcId, targetIdx);
        this.dragSrcId = null;
      });
    });
  }

  private async handleJourneyAction(act: string, id: string): Promise<void> {
    const wp = () => getWaypoints().find((x) => x.id === id);
    switch (act) {
      case "fly": {
        const w = wp();
        if (w && this.map) this.map.flyTo({ center: [w.lng, w.lat], zoom: Math.max(this.map.getZoom(), 5) });
        return;
      }
      case "edit": {
        if (!game.user.isGM) return;
        const w = wp();
        if (!w) return;
        const data = await waypointDialog({
          title: game.i18n.localize("GLOBEMAP.JT.EditTitle"),
          okLabel: game.i18n.localize("GLOBEMAP.JT.Save"),
          defaults: w,
        });
        if (!data) return;
        await updateWaypoint(id, data);
        return;
      }
      case "delete": {
        if (!game.user.isGM) return;
        const w = wp();
        if (!w || !(await confirmDeleteWaypoint(w.name))) return;
        await deleteWaypoint(id);
        return;
      }
      case "up":
        if (game.user.isGM) await reorderWaypoint(id, -1);
        return;
      case "down":
        if (game.user.isGM) await reorderWaypoint(id, 1);
        return;
    }
  }

  private async openAddWaypoint(coords?: { lng: number; lat: number }): Promise<void> {
    if (!game.user.isGM) return;
    const data = await waypointDialog({
      title: game.i18n.localize("GLOBEMAP.JT.NewTitle"),
      okLabel: game.i18n.localize("GLOBEMAP.JT.Create"),
      presetCoords: coords,
    });
    if (!data) return;
    await addWaypoint(data);
    this.setJourneyOpen(true);
  }

  // ---- Map interactions -----------------------------------------------------

  private onMapClick(e: maplibregl.MapMouseEvent): void {
    if (!this.map) return;
    if (e.originalEvent.shiftKey) {
      sendPing(e.lngLat.lng, e.lngLat.lat, userColor());
      return;
    }
    const features = this.map.queryRenderedFeatures(e.point, {
      layers: this.layersThatExist(BUILT_IN_FEATURE_LAYERS),
    });
    const named = features.find((f) => f.properties && (f.properties.name || f.properties.label));
    if (named) this.showFeaturePopup(e.lngLat, named);
  }

  private updateReadout(lngLat: LngLat, point: maplibregl.Point): void {
    const el = (this.element as HTMLElement | undefined)?.querySelector<HTMLElement>(".globe-map-readout");
    if (!el) return;
    let hexLabel = "";
    if (this.hexOn && this.map && this.map.getLayer(HEX_FILL)) {
      const hit = this.map.queryRenderedFeatures(point, { layers: [HEX_FILL] });
      if (hit[0]?.properties?.label) hexLabel = ` · <b>${escapeHtml(String(hit[0].properties.label))}</b>`;
    }
    el.dataset.empty = "false";
    el.innerHTML = `${lngLat.lng.toFixed(2)}, ${lngLat.lat.toFixed(2)}${hexLabel}`;
  }

  private clearReadout(): void {
    const el = (this.element as HTMLElement | undefined)?.querySelector<HTMLElement>(".globe-map-readout");
    if (el) {
      el.dataset.empty = "true";
      el.innerHTML = "";
    }
  }

  private layersThatExist(ids: string[]): string[] {
    if (!this.map) return [];
    return ids.filter((id) => !!this.map!.getLayer(id));
  }

  private attachFeatureInteractions(): void {
    if (!this.map) return;
    for (const layer of this.layersThatExist(BUILT_IN_FEATURE_LAYERS)) {
      this.map.on("mouseenter", layer, () => {
        if (this.map) this.map.getCanvas().style.cursor = "pointer";
      });
      this.map.on("mouseleave", layer, () => {
        if (this.map) this.map.getCanvas().style.cursor = "";
      });
    }
  }

  private showFeaturePopup(lngLat: LngLat, feature: MapGeoJSONFeature): void {
    if (!this.map) return;
    const layer = feature.layer?.id || "";
    const props = feature.properties || {};
    const name = String(props.label || props.name || game.i18n.localize("GLOBEMAP.LocationPopupTitle"));
    const isLocation = layer.startsWith("locations");
    let bodyHtml = "";

    if (isLocation && typeof props.text === "string" && props.text.length > 0) {
      const safe = DOMPurify.sanitize(String(props.text), {
        ALLOWED_TAGS: ["p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "blockquote", "h4", "h5", "h6"],
        ALLOWED_ATTR: ["href", "title", "target", "rel"],
      });
      bodyHtml = `<div class="globe-map-feature-text">${safe}</div>`;
    } else {
      const skip = new Set([
        "name", "label", "text", "icon", "link", "filterMinzoom", "filterMaxzoom",
        "angle", "color", "halo", "modificationDate",
      ]);
      const rows = Object.entries(props)
        .filter(([k, v]) => !skip.has(k) && v !== null && v !== undefined && String(v).length > 0)
        .map(([k, v]) => [k, String(v)] as [string, string]);
      bodyHtml = rows.length
        ? `<dl class="globe-map-feature-details">${rows
            .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${linkifyIfUrl(escapeHtml(v))}</dd>`)
            .join("")}</dl>`
        : `<p class="globe-map-feature-empty">${escapeHtml(game.i18n.localize("GLOBEMAP.LocationNoDetails"))}</p>`;
    }

    const wikiLink =
      typeof props.link === "string" && props.link.startsWith("http")
        ? `<p class="globe-map-feature-source"><a href="${escapeHtml(String(props.link))}" target="_blank" rel="noopener noreferrer">${escapeHtml(game.i18n.localize("GLOBEMAP.ReadOnWiki"))} &rarr;</a></p>`
        : "";

    const html = `<div class="globe-map-popup globe-map-feature-popup"><h3>${escapeHtml(name)}</h3>${bodyHtml}${wikiLink}</div>`;
    this.featurePopup?.remove();
    this.featurePopup = new maplibregl.Popup({ offset: 14, closeButton: true, maxWidth: "440px", className: "globe-map-rich-popup" })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(this.map);
  }

  // ---- Pins -----------------------------------------------------------------

  private redrawPins(): void {
    if (!this.map) return;
    const seen = new Set<string>();
    for (const pin of getPins()) {
      seen.add(pin.id);
      const existing = this.pinMarkers.get(pin.id);
      if (existing) {
        existing.setLngLat([pin.lng, pin.lat]);
        this.decoratePinEl(existing.getElement(), pin);
        existing.setPopup(this.buildPinPopup(pin));
        continue;
      }
      this.pinMarkers.set(pin.id, this.createPinMarker(pin));
    }
    for (const [id, marker] of this.pinMarkers) {
      if (!seen.has(id)) {
        marker.remove();
        this.pinMarkers.delete(id);
      }
    }
  }

  private decoratePinEl(el: HTMLElement, pin: Pin): void {
    el.style.color = pin.color || DEFAULT_PIN_COLOR;
    el.innerHTML = `<i class="${escapeHtml(pin.icon || DEFAULT_PIN_ICON)}"></i>`;
  }

  private createPinMarker(pin: Pin): Marker {
    const el = document.createElement("div");
    el.className = "globe-map-pin-marker globe-map-drop-in";
    this.decoratePinEl(el, pin);
    setTimeout(() => el.classList.remove("globe-map-drop-in"), 500);

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom", draggable: game.user.isGM })
      .setLngLat([pin.lng, pin.lat])
      .setPopup(this.buildPinPopup(pin))
      .addTo(this.map!);

    el.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      if (game.user.isGM) void this.promptEditPin(pin);
    });
    el.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.showPinContextMenu(pin, ev.clientX, ev.clientY);
    });
    marker.on("dragend", async () => {
      if (!game.user.isGM) return;
      const ll = marker.getLngLat();
      await updatePin(pin.id, { lng: ll.lng, lat: ll.lat });
    });
    return marker;
  }

  private buildPinPopup(pin: Pin): Popup {
    const desc = pin.description ? `<div class="globe-map-pin-desc">${pin.description}</div>` : "";
    const editHint = game.user.isGM
      ? `<div class="globe-map-pin-hint">${escapeHtml(game.i18n.localize("GLOBEMAP.PinEditHint"))}</div>`
      : "";
    return new maplibregl.Popup({ offset: 24, closeButton: true, maxWidth: "300px" }).setHTML(
      `<div class="globe-map-popup"><h3><i class="${escapeHtml(pin.icon || DEFAULT_PIN_ICON)}"></i> ${escapeHtml(pin.name)}</h3>${desc}${editHint}</div>`,
    );
  }

  private redrawParty(): void {
    if (!this.map) return;
    const party = getParty();
    if (!party) {
      this.partyMarker?.remove();
      this.partyMarker = null;
      return;
    }
    if (!this.partyMarker) {
      const el = document.createElement("div");
      el.className = "globe-map-party-marker";
      el.innerHTML = `<span class="globe-map-party-pulse"></span><i class="${escapeHtml(getPartyIcon())}"></i>`;
      el.title = game.i18n.localize("GLOBEMAP.PartyPin");
      this.partyMarker = new maplibregl.Marker({ element: el, anchor: "center", draggable: game.user.isGM })
        .setLngLat([party.lng, party.lat])
        .addTo(this.map);
      this.partyMarker.on("dragend", async () => {
        if (!game.user.isGM || !this.partyMarker) return;
        const ll = this.partyMarker.getLngLat();
        await setParty({ lng: ll.lng, lat: ll.lat });
      });
    } else {
      this.partyMarker.setLngLat([party.lng, party.lat]);
      const el = this.partyMarker.getElement();
      const i = el.querySelector("i");
      if (i) i.className = getPartyIcon();
    }
  }

  // ---- Context menus --------------------------------------------------------

  private showContextMenu(x: number, y: number, lngLat: LngLat): void {
    if (!this.container) return;
    closeAllContextMenus();
    const isGM = game.user.isGM;
    const items: Array<{ label: string; icon: string; handler: () => void; gmOnly?: boolean }> = [
      { label: game.i18n.localize("GLOBEMAP.AddPinHere"), icon: "fa-solid fa-map-pin", handler: () => this.promptAddPin(lngLat), gmOnly: true },
      { label: game.i18n.localize("GLOBEMAP.JT.AddHere"), icon: "fa-solid fa-route", handler: () => this.openAddWaypoint({ lng: lngLat.lng, lat: lngLat.lat }), gmOnly: true },
      { label: game.i18n.localize("GLOBEMAP.SetPartyHere"), icon: "fa-solid fa-people-group", handler: () => setParty({ lng: lngLat.lng, lat: lngLat.lat }), gmOnly: true },
    ];
    if (isGM && this.projection === "flat") {
      items.push({
        label: game.i18n.localize("GLOBEMAP.Hex.CenterHere"),
        icon: "fa-solid fa-border-all",
        handler: async () => {
          await setHexConfig({ centerLng: lngLat.lng, centerLat: lngLat.lat });
          this.refreshHexSource();
          if (!this.hexOn) this.toggleHex();
        },
        gmOnly: true,
      });
    }
    items.push({ label: game.i18n.localize("GLOBEMAP.PingHere"), icon: "fa-solid fa-bullseye", handler: () => sendPing(lngLat.lng, lngLat.lat, userColor()) });

    this.buildMenu(items, x, y);
  }

  private showPinContextMenu(pin: Pin, clientX: number, clientY: number): void {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    this.buildMenu(
      [
        { label: game.i18n.localize("GLOBEMAP.PinEdit"), icon: "fa-solid fa-pen", gmOnly: true, handler: () => this.promptEditPin(pin) },
        { label: game.i18n.localize("GLOBEMAP.PinDelete"), icon: "fa-solid fa-trash", gmOnly: true, handler: () => deletePin(pin.id) },
      ],
      clientX - rect.left,
      clientY - rect.top,
    );
  }

  private showWaypointContextMenu(w: Waypoint, clientX: number, clientY: number): void {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    this.buildMenu(
      [
        { label: game.i18n.localize("GLOBEMAP.JT.Edit"), icon: "fa-solid fa-pen", gmOnly: true, handler: () => void this.handleJourneyAction("edit", w.id) },
        { label: game.i18n.localize("GLOBEMAP.PinDelete"), icon: "fa-solid fa-trash", gmOnly: true, handler: () => void this.handleJourneyAction("delete", w.id) },
      ],
      clientX - rect.left,
      clientY - rect.top,
    );
  }

  private buildMenu(
    items: Array<{ label: string; icon: string; handler: () => void; gmOnly?: boolean }>,
    x: number,
    y: number,
  ): void {
    if (!this.container) return;
    closeAllContextMenus();
    const menu = document.createElement("div");
    menu.className = "globe-map-context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    for (const item of items) {
      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `<i class="${escapeHtml(item.icon)}"></i><span>${escapeHtml(item.label)}</span>`;
      if (item.gmOnly && !game.user.isGM) {
        el.classList.add("disabled");
      } else {
        el.addEventListener("click", () => {
          item.handler();
          menu.remove();
        });
      }
      menu.appendChild(el);
    }
    this.container.appendChild(menu);
    deferOutsideClick(menu);
  }

  private async promptAddPin(lngLat: LngLat): Promise<void> {
    const data = await pinDialog({
      title: "GLOBEMAP.PinPromptTitle",
      okLabel: "GLOBEMAP.CreateButton",
      defaults: { name: "", description: "", color: getDefaultPinColor(), icon: getDefaultPinIcon() },
    });
    if (!data) return;
    await addPin({
      name: data.name,
      description: data.description || undefined,
      color: data.color,
      icon: data.icon || getDefaultPinIcon(),
      lng: lngLat.lng,
      lat: lngLat.lat,
    });
  }

  private async promptEditPin(pin: Pin): Promise<void> {
    const data = await pinDialog({
      title: "GLOBEMAP.PinEditTitle",
      okLabel: "GLOBEMAP.SaveButton",
      defaults: {
        name: pin.name,
        description: pin.description || "",
        color: pin.color || getDefaultPinColor(),
        icon: pin.icon || getDefaultPinIcon(),
      },
    });
    if (!data) return;
    await updatePin(pin.id, {
      name: data.name,
      description: data.description || undefined,
      color: data.color,
      icon: data.icon || getDefaultPinIcon(),
    });
  }

  private beginAddPinAtCenter(): void {
    if (!this.map) return;
    const c = this.map.getCenter();
    void this.promptAddPin(c as unknown as LngLat);
  }

  private showPingAt(p: PingPayload): void {
    if (!this.map || !this.container) return;
    const point = this.map.project([p.lng, p.lat]);
    const ping = document.createElement("div");
    ping.className = "globe-map-ping";
    ping.style.left = `${point.x}px`;
    ping.style.top = `${point.y}px`;
    ping.style.setProperty("--ping-color", p.color || "#ff6b6b");
    this.container.appendChild(ping);
    setTimeout(() => ping.remove(), 2000);
    ui.notifications.info(game.i18n.format("GLOBEMAP.PingedBy", { name: p.userName }));
  }

  async close(options?: unknown): Promise<unknown> {
    this.offPing?.();
    this.offPing = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.featurePopup?.remove();
    this.featurePopup = null;
    for (const m of this.waypointMarkers.values()) m.remove();
    this.waypointMarkers.clear();
    this.map?.remove();
    this.map = null;
    this.pinMarkers.clear();
    this.partyMarker = null;
    appInstance = null;
    return super.close(options);
  }
}

function deferOutsideClick(menu: HTMLElement): void {
  setTimeout(() => {
    const off = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener("mousedown", off);
      }
    };
    document.addEventListener("mousedown", off);
  }, 0);
}

function closeAllContextMenus(): void {
  document.querySelectorAll(".globe-map-context-menu").forEach((el) => el.remove());
}
