import fs from "fs";
import path from "path";
import { BrowserContext, Locator, Page } from "playwright";
import { collectDownloads, findVisible, Finder } from "./browser";
import { Config } from "./config";
import { log } from "./logger";
import { baseDir, dataDir, downloadsCacheDir, ensureDir } from "./paths";
import { login } from "./smartmenu";
import { formatDate, sleep, stamp } from "./util";

/**
 * Receta de navegación de SmartMenu (smartmenu-steps.json). No conocemos sus
 * pantallas: cuando llegue el zip de descubrimiento solo se ajusta este JSON,
 * sin tocar código.
 */
export type Action =
  | "goto"
  | "login"
  | "click"
  | "hover"
  | "fill"
  | "select"
  | "press"
  | "wait"
  | "waitFor"
  | "waitForDownload";

export interface Step {
  action: Action;
  note?: string;
  url?: string;
  text?: string | string[];
  selector?: string | string[];
  label?: string | string[];
  value?: string;
  format?: string;
  key?: string;
  seconds?: number;
  timeoutSeconds?: number;
  optional?: boolean;
}

export interface Recipe {
  // En modo carpeta la receta corre sola solo si está activa: una receta sin
  // probar no debe andar haciendo clics en el sistema de facturación.
  activa: boolean;
  dateFormat: string;
  steps: Step[];
}

export interface RecipeDates {
  desde: Date;
  hasta: Date;
}

export const recipePath = path.join(baseDir, "smartmenu-steps.json");
const remoteRecipePath = path.join(dataDir, "receta-remota.json");

function parseRecipe(text: string, source: string): Recipe {
  let raw: any;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`${source} no es un JSON válido: ${(error as Error).message}`);
  }
  if (!Array.isArray(raw?.steps) || !raw.steps.length) throw new Error(`${source} no tiene pasos (steps)`);
  return { activa: raw.activa === true, dateFormat: raw.dateFormat || "dd/MM/yyyy", steps: raw.steps };
}

/** La receta bajada del repo manda sobre la local: así se corrige en los tres locales sin ir a ninguno. */
export function loadRecipe(config: Config): Recipe {
  if (config.recipeUrl && fs.existsSync(remoteRecipePath)) {
    try {
      return parseRecipe(fs.readFileSync(remoteRecipePath, "utf8"), "La receta remota");
    } catch {
      // Se usa la local.
    }
  }
  if (!fs.existsSync(recipePath)) throw new Error("No encuentro smartmenu-steps.json");
  return parseRecipe(fs.readFileSync(recipePath, "utf8"), "smartmenu-steps.json");
}

/** Baja la receta publicada. Si no hay internet o viene mala se queda la que había. */
export async function refreshRecipe(config: Config): Promise<void> {
  if (!config.recipeUrl) return;
  try {
    const res = await fetch(config.recipeUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`respondió ${res.status}`);
    const text = await res.text();
    parseRecipe(text, "La receta remota");
    const previous = fs.existsSync(remoteRecipePath) ? fs.readFileSync(remoteRecipePath, "utf8") : "";
    if (previous !== text) {
      ensureDir(dataDir);
      fs.writeFileSync(remoteRecipePath, text);
      log.info("Receta de SmartMenu actualizada desde el repo");
    }
  } catch (error) {
    log.warn(`No pude bajar la receta actualizada: ${(error as Error).message}`);
  }
}

const list = (value?: string | string[]) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lower = "translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚ', 'abcdefghijklmnopqrstuvwxyzáéíóú')";

function targetFinders(step: Step): Finder[] {
  const finders: Finder[] = list(step.selector).map((s) => (r) => r.locator(s));
  for (const text of list(step.text)) {
    const re = new RegExp(escapeRegex(text), "i");
    finders.push(
      (r) => r.getByRole("link", { name: re }),
      (r) => r.getByRole("button", { name: re }),
      (r) => r.getByRole("menuitem", { name: re }),
      (r) => r.getByRole("tab", { name: re }),
      (r) => r.getByRole("option", { name: re }),
      (r) => r.getByText(re),
      (r) => r.locator(`[title*="${text.replace(/"/g, "")}" i], [value*="${text.replace(/"/g, "")}" i]`),
    );
  }
  return finders;
}

function fieldFinders(step: Step): Finder[] {
  const finders: Finder[] = list(step.selector).map((s) => (r) => r.locator(s));
  for (const label of list(step.label)) {
    const safe = label.replace(/['"]/g, "");
    const needle = safe.toLowerCase();
    finders.push(
      (r) => r.getByLabel(new RegExp(escapeRegex(label), "i")),
      (r) => r.getByPlaceholder(new RegExp(escapeRegex(label), "i")),
      (r) => r.locator(`input[name*="${safe}" i], input[id*="${safe}" i], select[name*="${safe}" i], select[id*="${safe}" i]`),
      // Texto suelto "Desde:" seguido del campo, sin <label>: lo típico en webs viejas.
      (r) =>
        r.locator(
          `xpath=//*[not(self::script)][contains(${lower}, '${needle}')][not(*[contains(${lower}, '${needle}')])]/following::*[self::input or self::select][1]`,
        ),
    );
  }
  return finders;
}

/** Reemplaza {desde}, {hasta}, {hoy} y {ahora}, con formato opcional: {desde:dd-MM-yyyy}. */
function resolveValue(template: string, format: string, dates: RecipeDates, override?: string): string {
  const now = new Date();
  const values: Record<string, Date> = { desde: dates.desde, hasta: dates.hasta, hoy: now, ahora: now };
  return template.replace(/\{(desde|hasta|hoy|ahora)(?::([^}]+))?\}/g, (_, name: string, own?: string) =>
    formatDate(values[name], override ?? own ?? format),
  );
}

const NATIVE_FORMATS: Record<string, string> = {
  date: "yyyy-MM-dd",
  "datetime-local": "yyyy-MM-ddTHH:mm",
  time: "HH:mm",
};

async function fill(field: Locator, step: Step, recipe: Recipe, dates: RecipeDates) {
  const type = await field.evaluate((el) => (el as HTMLInputElement).type || el.tagName.toLowerCase());
  const value = resolveValue(step.value ?? "", step.format ?? recipe.dateFormat, dates, NATIVE_FORMATS[type]);
  if (type === "select-one" || type === "select") {
    await field.selectOption({ label: value }).catch(() => field.selectOption(value));
    return;
  }
  try {
    await field.fill(value, { timeout: 5_000 });
  } catch {
    // Selector de fecha de solo lectura: se escribe por JS y se avisa a la página.
    await field.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.removeAttribute("readonly");
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  }
}

function describe(step: Step, index: number): string {
  const what = step.note || list(step.text)[0] || list(step.label)[0] || list(step.selector)[0] || step.url || "";
  return `paso ${index + 1} (${step.action}${what ? `: ${what}` : ""})`;
}

/**
 * Corre la receta y devuelve la ruta del reporte descargado. Si la página abre
 * otra ventana se sigue en la más nueva, como haría una persona.
 */
export async function runRecipe(
  context: BrowserContext,
  firstPage: Page,
  recipe: Recipe,
  config: Config,
  dates: RecipeDates,
): Promise<string> {
  const downloads = collectDownloads(context);
  let page = firstPage;
  let saved: string | null = null;

  for (const [index, step] of recipe.steps.entries()) {
    const label = describe(step, index);
    const timeout = (step.timeoutSeconds ?? 15) * 1000;
    const pagesBefore = context.pages().length;
    try {
      switch (step.action) {
        case "goto":
          await page.goto(step.url || config.smartmenuUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
          break;
        case "login":
          page = await login(page, step.url || config.smartmenuUrl, config.smartmenuKey);
          break;
        case "click":
        case "hover": {
          const target = await findVisible(page, targetFinders(step), timeout);
          if (!target) throw new Error("no encontré el elemento");
          if (step.action === "click") await target.click({ timeout: 10_000 });
          else await target.hover({ timeout: 10_000 });
          break;
        }
        case "fill":
        case "select": {
          const field = await findVisible(page, fieldFinders(step), timeout);
          if (!field) throw new Error("no encontré el campo");
          await fill(field, step, recipe, dates);
          break;
        }
        case "press":
          await page.keyboard.press(step.key || "Enter");
          break;
        case "wait":
          await sleep((step.seconds ?? 1) * 1000);
          break;
        case "waitFor": {
          const target = await findVisible(page, targetFinders(step), timeout);
          if (!target) throw new Error("no apareció en pantalla");
          break;
        }
        case "waitForDownload": {
          const before = downloads.length;
          if (step.text || step.selector) {
            const target = await findVisible(page, targetFinders(step), 15_000);
            if (!target) throw new Error("no encontré el botón de exportar");
            await target.click({ timeout: 10_000 });
          }
          const until = Date.now() + (step.timeoutSeconds ?? 90) * 1000;
          while (downloads.length === before && Date.now() < until) await sleep(500);
          const download = downloads[downloads.length - 1];
          if (downloads.length === before || !download) throw new Error("no llegó ninguna descarga");
          const name = download.suggestedFilename() || "reporte.xls";
          saved = path.join(ensureDir(downloadsCacheDir), `${stamp()}_${name}`);
          await download.saveAs(saved);
          log.info(`Descargué ${name}`);
          break;
        }
        default:
          throw new Error(`acción desconocida «${(step as Step).action}»`);
      }
    } catch (error) {
      const message = `${label}: ${(error as Error).message.split("\n")[0]}`;
      if (step.optional) {
        log.info(`Omito ${message}`);
      } else {
        throw new Error(message);
      }
    }
    // Un clic que abre otra ventana: se sigue en ella.
    await sleep(300);
    const pages = context.pages().filter((p) => !p.isClosed());
    if (pages.length > pagesBefore) {
      page = pages[pages.length - 1];
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }
  }
  if (!saved) throw new Error("La receta terminó sin descargar el reporte (falta un paso waitForDownload)");
  return saved;
}

/** Deja solo las últimas descargas del modo auto: cada una trae el día completo. */
export function pruneDownloads(keep = 40) {
  if (!fs.existsSync(downloadsCacheDir)) return;
  const files = fs
    .readdirSync(downloadsCacheDir)
    .map((f) => ({ f, t: fs.statSync(path.join(downloadsCacheDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(keep)) fs.rmSync(path.join(downloadsCacheDir, f), { force: true });
}
