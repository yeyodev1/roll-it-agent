import fs from "fs";
import path from "path";
import { chromium, Browser, BrowserContext, Download, Frame, Locator, Page } from "playwright";
import { ensureDir, failuresDir } from "./paths";
import { log } from "./logger";
import { sleep, stamp } from "./util";

export type Root = Page | Frame;
export type Finder = (root: Root) => Locator;

export async function launch(visible: boolean): Promise<Browser> {
  // Sin esto Chromium frena el dibujo de una ventana tapada y las capturas se quedan esperando.
  const args = [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ];
  // Solo para pruebas: deja que otro proceso maneje el navegador por CDP.
  if (process.env.ROLLIT_DEBUG_PORT) args.push(`--remote-debugging-port=${process.env.ROLLIT_DEBUG_PORT}`);
  return chromium.launch({ headless: !visible, args });
}

/**
 * Busca el primer elemento visible probando cada forma en todos los frames de
 * la página. SmartMenu es una web vieja: puede usar iframes o framesets.
 */
export async function findVisible(page: Page, finders: Finder[], timeoutMs: number): Promise<Locator | null> {
  const until = Date.now() + timeoutMs;
  do {
    for (const finder of finders) {
      for (const frame of page.frames()) {
        try {
          const all = finder(frame);
          const count = Math.min(await all.count(), 25);
          for (let i = 0; i < count; i++) {
            if (await all.nth(i).isVisible()) return all.nth(i);
          }
        } catch {
          // Frame que se fue mientras se buscaba, o selector inválido en ese frame.
        }
      }
    }
    if (Date.now() >= until) break;
    await sleep(300);
  } while (true);
  return null;
}

/** Junta las descargas de todas las pestañas del contexto, incluidas las que se abren después. */
export function collectDownloads(context: BrowserContext): Download[] {
  const downloads: Download[] = [];
  const watch = (page: Page) => page.on("download", (d) => downloads.push(d));
  context.pages().forEach(watch);
  context.on("page", watch);
  return downloads;
}

/**
 * Alertas y confirmaciones: sin un manejador Playwright las rechaza, y un
 * "¿Desea exportar?" respondido con No cortaría el flujo. Se aceptan y se anotan.
 */
export function acceptDialogs(context: BrowserContext, onDialog?: (text: string) => void) {
  const watch = (page: Page) =>
    page.on("dialog", (dialog) => {
      const text = `${dialog.type()}: ${dialog.message()}`;
      log.info(`Ventana de SmartMenu (${text}) → Aceptar`);
      onDialog?.(text);
      dialog.accept().catch(() => undefined);
    });
  context.pages().forEach(watch);
  context.on("page", watch);
}

const MAX_FAILURE_FILES = 60;

/** Captura y HTML de cada pestaña y frame para ver en qué pantalla se trabó la receta. */
export async function saveFailure(context: BrowserContext | null, reason: string): Promise<string> {
  const dir = ensureDir(failuresDir);
  const base = `${stamp()}`;
  const notes = [`Motivo: ${reason}`];
  const pages = context?.pages() ?? [];
  for (const [i, page] of pages.entries()) {
    const name = `${base}-pestana${i + 1}`;
    notes.push(`Pestaña ${i + 1}: ${page.url()}`);
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true }).catch(() => undefined);
    for (const [j, frame] of page.frames().entries()) {
      const html = await frame.content().catch(() => "");
      if (html) fs.writeFileSync(path.join(dir, `${name}-frame${j}.html`), `<!-- ${frame.url()} -->\n${html}`);
    }
  }
  fs.writeFileSync(path.join(dir, `${base}-motivo.txt`), notes.join("\n") + "\n");

  const files = fs
    .readdirSync(dir)
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of files.slice(MAX_FAILURE_FILES)) fs.rmSync(path.join(dir, f), { force: true });
  return path.join(dir, base);
}
