import type { HexGridConfig } from "./types";
import { escapeHtml } from "./util";

export async function hexDialog(cfg: HexGridConfig): Promise<Partial<HexGridConfig> | null> {
  const num = (name: string, label: string, value: number, step = 1, min?: number) =>
    `<div class="form-group">
       <label>${escapeHtml(game.i18n.localize(label))}</label>
       <input type="number" name="${name}" step="${step}"${min != null ? ` min="${min}"` : ""} value="${value}" />
     </div>`;

  const result = await foundry.applications.api.DialogV2.prompt({
    position: { width: 480 },
    window: { title: game.i18n.localize("GLOBEMAP.Hex.ConfigTitle"), icon: "fa-solid fa-border-all" },
    content: `
      <p class="notes">${escapeHtml(game.i18n.localize("GLOBEMAP.Hex.ConfigHint"))}</p>
      <div class="gm-jt-row">
        ${num("centerLng", "GLOBEMAP.Hex.CenterLng", cfg.centerLng, 0.001)}
        ${num("centerLat", "GLOBEMAP.Hex.CenterLat", cfg.centerLat, 0.001)}
      </div>
      <div class="gm-jt-row">
        ${num("hexMiles", "GLOBEMAP.Hex.HexMiles", cfg.hexMiles, 0.5, 0.5)}
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.Hex.Orientation"))}</label>
          <select name="orientation">
            <option value="flat"${cfg.orientation === "flat" ? " selected" : ""}>${escapeHtml(game.i18n.localize("GLOBEMAP.Hex.Flat"))}</option>
            <option value="pointy"${cfg.orientation === "pointy" ? " selected" : ""}>${escapeHtml(game.i18n.localize("GLOBEMAP.Hex.Pointy"))}</option>
          </select>
        </div>
      </div>
      <div class="gm-jt-row">
        ${num("cols", "GLOBEMAP.Hex.Cols", cfg.cols, 1, 1)}
        ${num("rows", "GLOBEMAP.Hex.Rows", cfg.rows, 1, 1)}
      </div>
      <div class="gm-jt-row">
        <div class="form-group">
          <label>${escapeHtml(game.i18n.localize("GLOBEMAP.Hex.Color"))}</label>
          <input type="color" name="color" value="${escapeHtml(cfg.color)}" />
        </div>
        ${num("opacity", "GLOBEMAP.Hex.LineOpacity", cfg.opacity, 0.05, 0)}
        ${num("fillOpacity", "GLOBEMAP.Hex.FillOpacity", cfg.fillOpacity, 0.01, 0)}
      </div>
      <div class="form-group">
        <label class="checkbox">
          <input type="checkbox" name="followParty"${cfg.followParty ? " checked" : ""} />
          ${escapeHtml(game.i18n.localize("GLOBEMAP.Hex.FollowParty"))}
        </label>
      </div>
      <div class="form-group">
        <label class="checkbox">
          <input type="checkbox" name="showLabels"${cfg.showLabels ? " checked" : ""} />
          ${escapeHtml(game.i18n.localize("GLOBEMAP.Hex.ShowLabels"))}
        </label>
      </div>
    `,
    ok: {
      label: game.i18n.localize("GLOBEMAP.JT.Save"),
      callback: (_e: unknown, btn: HTMLButtonElement) => {
        const f = btn.form!;
        const n = (name: string) => Number((f.elements.namedItem(name) as HTMLInputElement).value);
        return {
          centerLng: n("centerLng"),
          centerLat: n("centerLat"),
          hexMiles: Math.max(0.5, n("hexMiles")),
          cols: Math.max(1, Math.round(n("cols"))),
          rows: Math.max(1, Math.round(n("rows"))),
          orientation: (f.elements.namedItem("orientation") as HTMLSelectElement).value as "flat" | "pointy",
          color: (f.elements.namedItem("color") as HTMLInputElement).value,
          opacity: Math.max(0, n("opacity")),
          fillOpacity: Math.max(0, n("fillOpacity")),
          showLabels: (f.elements.namedItem("showLabels") as HTMLInputElement).checked,
          followParty: (f.elements.namedItem("followParty") as HTMLInputElement).checked,
        } as Partial<HexGridConfig>;
      },
    },
    rejectClose: false,
  });
  return result ?? null;
}
