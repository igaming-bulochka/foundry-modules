import { type Waypoint, type TravelMode, TRAVEL_MODE_ICONS } from "./types";
import { ALL_TRAVEL_MODES } from "./waypoints";
import { escapeHtml } from "./util";

export async function waypointDialog(opts: {
  title: string;
  okLabel: string;
  defaults?: Partial<Waypoint>;
  presetCoords?: { lng: number; lat: number };
}): Promise<Omit<Waypoint, "id" | "order"> | null> {
  const d = opts.defaults ?? {};
  const lng = d.lng ?? opts.presetCoords?.lng ?? 0;
  const lat = d.lat ?? opts.presetCoords?.lat ?? 0;
  const calendarDate = (globalThis as any).CampaignCalendar?.currentDate?.() as string | undefined;
  const selMode = (d.travelMode ?? "foot") as TravelMode;
  const modeOpts = ALL_TRAVEL_MODES.map(
    (m) =>
      `<option value="${m}"${selMode === m ? " selected" : ""}>${escapeHtml(game.i18n.localize(`GLOBEMAP.JT.Mode.${m}`))}</option>`,
  ).join("");

  // Keep the mode icon preview in sync with the select, once rendered.
  Hooks.once("renderDialogV2", (_app: unknown, el: HTMLElement) => {
    const select = el?.querySelector<HTMLSelectElement>('select[name="travelMode"]');
    const preview = el?.querySelector<HTMLElement>(".globe-map-mode-preview");
    select?.addEventListener("change", () => {
      if (preview) preview.className = `globe-map-mode-preview ${TRAVEL_MODE_ICONS[select.value as TravelMode] ?? ""}`;
    });
  });
  const result = await foundry.applications.api.DialogV2.prompt({
    position: { width: 540 },
    window: { title: opts.title, icon: "fa-solid fa-route" },
    content: `
      <div class="form-group">
        <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.Name"))}</label>
        <input type="text" name="name" autofocus required value="${escapeHtml(d.name ?? "")}" />
      </div>
      <div class="gm-jt-row">
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.Longitude"))}</label>
          <input type="number" name="lng" step="0.001" value="${lng}" />
        </div>
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.Latitude"))}</label>
          <input type="number" name="lat" step="0.001" value="${lat}" />
        </div>
      </div>
      <div class="gm-jt-row">
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.ArrivalDate"))}</label>
          <input type="text" name="arrivalDate" value="${escapeHtml(d.arrivalDate ?? calendarDate ?? "")}" />
        </div>
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.DepartureDate"))}</label>
          <input type="text" name="departureDate" value="${escapeHtml(d.departureDate ?? "")}" />
        </div>
      </div>
      <div class="gm-jt-row">
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.TravelDays"))}</label>
          <input type="number" name="travelDays" min="0" step="0.5" value="${d.travelDays ?? 0}" />
        </div>
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.Mode"))}</label>
          <div class="globe-map-mode-field">
            <i class="globe-map-mode-preview ${escapeHtml(TRAVEL_MODE_ICONS[selMode])}"></i>
            <select name="travelMode">${modeOpts}</select>
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>${escapeHtml(game.i18n.localize("GLOBEMAP.JT.Field.Notes"))}</label>
        <textarea name="notes" rows="3">${escapeHtml(d.notes ?? "")}</textarea>
      </div>
    `,
    ok: {
      label: opts.okLabel,
      callback: (_e: unknown, btn: HTMLButtonElement) => {
        const f = btn.form!;
        const name = (f.elements.namedItem("name") as HTMLInputElement).value.trim();
        if (!name) return null;
        const lngVal = Number((f.elements.namedItem("lng") as HTMLInputElement).value);
        const latVal = Number((f.elements.namedItem("lat") as HTMLInputElement).value);
        if (!Number.isFinite(lngVal) || !Number.isFinite(latVal)) return null;
        const travelDays = parseFloat((f.elements.namedItem("travelDays") as HTMLInputElement).value);
        return {
          name,
          lng: lngVal,
          lat: latVal,
          arrivalDate: (f.elements.namedItem("arrivalDate") as HTMLInputElement).value.trim() || undefined,
          departureDate: (f.elements.namedItem("departureDate") as HTMLInputElement).value.trim() || undefined,
          travelDays: Number.isFinite(travelDays) && travelDays > 0 ? travelDays : undefined,
          travelMode: (f.elements.namedItem("travelMode") as HTMLSelectElement).value as TravelMode,
          notes: (f.elements.namedItem("notes") as HTMLTextAreaElement).value.trim() || undefined,
        };
      },
    },
    rejectClose: false,
  });
  return result ?? null;
}

export async function confirmDeleteWaypoint(name: string): Promise<boolean> {
  const result = await foundry.applications.api.DialogV2.confirm({
    position: { width: 420 },
    window: { title: game.i18n.localize("GLOBEMAP.JT.DeleteTitle") },
    content: `<p>${escapeHtml(game.i18n.format("GLOBEMAP.JT.ConfirmDelete", { name }))}</p>`,
    rejectClose: false,
  });
  return !!result;
}
