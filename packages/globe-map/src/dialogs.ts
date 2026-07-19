import { DEFAULT_PIN_COLOR } from "./types";
import { escapeHtml, iconPickerHtml, wireIconPicker } from "./util";

export interface PinFormResult {
  name: string;
  description: string;
  color: string;
  icon: string;
}

export async function pinDialog(opts: {
  title: string;
  okLabel: string;
  defaults: { name: string; description: string; color: string; icon: string };
}): Promise<PinFormResult | null> {
  const { title, okLabel, defaults } = opts;
  // Wire the icon swatches once the dialog element is in the DOM. The
  // renderDialogV2 hook is stable across Foundry versions; wireIconPicker
  // no-ops on any other dialog.
  Hooks.once("renderDialogV2", (_app: unknown, el: HTMLElement) => wireIconPicker(el));
  const result = await foundry.applications.api.DialogV2.prompt({
    position: { width: 460 },
    window: { title: game.i18n.localize(title), icon: "fa-solid fa-map-pin" },
    content: `
      <div class="form-group">
        <label>${escapeHtml(game.i18n.localize("GLOBEMAP.PinPromptName"))}</label>
        <input type="text" name="name" autofocus required value="${escapeHtml(defaults.name)}" />
      </div>
      <div class="form-group">
        <label>${escapeHtml(game.i18n.localize("GLOBEMAP.PinPromptDescription"))}</label>
        <textarea name="description" rows="4">${escapeHtml(defaults.description)}</textarea>
      </div>
      <div class="form-group">
        <label>${escapeHtml(game.i18n.localize("GLOBEMAP.PinPromptIcon"))}</label>
        ${iconPickerHtml(defaults.icon)}
      </div>
      <div class="form-group">
        <label>${escapeHtml(game.i18n.localize("GLOBEMAP.PinPromptColor"))}</label>
        <input type="color" name="color" value="${escapeHtml(defaults.color)}" />
      </div>
    `,
    ok: {
      label: game.i18n.localize(okLabel),
      callback: (_event: unknown, button: HTMLButtonElement) => {
        const form = button.form!;
        return {
          name: (form.elements.namedItem("name") as HTMLInputElement).value.trim(),
          description: (form.elements.namedItem("description") as HTMLTextAreaElement).value.trim(),
          color: (form.elements.namedItem("color") as HTMLInputElement).value || DEFAULT_PIN_COLOR,
          icon: (form.elements.namedItem("icon") as HTMLInputElement).value.trim(),
        } as PinFormResult;
      },
    },
    rejectClose: false,
  });
  if (!result || !result.name) return null;
  return result;
}
