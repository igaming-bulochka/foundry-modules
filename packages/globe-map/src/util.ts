import { PIN_ICONS } from "./types";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function linkifyIfUrl(escapedText: string): string {
  const urlMatch = /^https?:\/\/[^\s<>"']+$/.exec(escapedText);
  if (!urlMatch) return escapedText;
  return `<a href="${escapedText}" target="_blank" rel="noopener noreferrer">${escapedText}</a>`;
}

/**
 * A radio-style icon grid. Renders one swatch per curated pin icon plus a free
 * text field so a custom FontAwesome class can be pasted in. `selected` is the
 * currently chosen FA class string.
 */
export function iconPickerHtml(selected: string): string {
  const swatches = PIN_ICONS.map((choice) => {
    const on = choice.icon === selected;
    return `<button type="button" class="globe-map-icon-swatch${on ? " selected" : ""}" data-icon="${escapeHtml(choice.icon)}" title="${escapeHtml(game.i18n.localize(choice.labelKey))}"><i class="${escapeHtml(choice.icon)}"></i></button>`;
  }).join("");
  const isCustom = !PIN_ICONS.some((c) => c.icon === selected);
  return `
    <div class="globe-map-icon-picker" data-icon-picker>
      <div class="globe-map-icon-grid">${swatches}</div>
      <input type="text" name="icon" class="globe-map-icon-input" value="${escapeHtml(selected)}" placeholder="fa-solid fa-..." />
      <p class="globe-map-icon-hint${isCustom ? " show" : ""}">${escapeHtml(game.i18n.localize("GLOBEMAP.Icon.CustomHint"))}</p>
    </div>`;
}

/** Wire the swatch buttons inside a rendered dialog so clicks set the input. */
export function wireIconPicker(root: HTMLElement): void {
  const picker = root.querySelector<HTMLElement>("[data-icon-picker]");
  if (!picker) return;
  const input = picker.querySelector<HTMLInputElement>(".globe-map-icon-input");
  const swatches = picker.querySelectorAll<HTMLButtonElement>(".globe-map-icon-swatch");
  const sync = () => {
    const val = input?.value.trim() ?? "";
    swatches.forEach((s) => s.classList.toggle("selected", s.dataset.icon === val));
  };
  swatches.forEach((s) =>
    s.addEventListener("click", () => {
      if (input) input.value = s.dataset.icon ?? "";
      sync();
    }),
  );
  input?.addEventListener("input", sync);
}
