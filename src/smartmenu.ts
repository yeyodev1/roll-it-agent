import fs from "fs";
import path from "path";
import { Locator, Page } from "playwright";
import { findVisible, Finder } from "./browser";
import { Config } from "./config";
import { log } from "./logger";
import { downloadsCacheDir, ensureDir } from "./paths";
import { formatDate, sleep, stamp } from "./util";

/**
 * Baja el "Reporte de ventas detallado" con los mismos endpoints PHP que usa la
 * pantalla de Ventas de SmartMenu: login con la clave y luego el Excel con la
 * cookie de sesión. Sin navegador, así corre en cualquier servidor de la red.
 * Las fechas van en la hora local de la máquina (TZ=America/Guayaquil en servidores).
 */
export async function downloadReport(config: Config, desde: Date, hasta: Date): Promise<string> {
  const base = config.smartmenuUrl.replace(/\/[^/]*$/, "");
  const login = await fetch(`${base}/data/manejoUsuarios.php`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `clave=${encodeURIComponent(config.smartmenuKey)}`,
    signal: AbortSignal.timeout(20_000),
  });
  const answer = (await login.text()).trim();
  if (!answer.startsWith("correcto")) {
    throw new Error(`SmartMenu no aceptó la clave (respondió «${answer.slice(0, 60)}»)`);
  }
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const format = "yyyy-MM-dd HH:mm:ss";
  // shortcut: sucursal 1 / caja 1 fijas (cada local tiene una sola caja hoy); si abren otra, leer data/listaCajas.php.
  const query = new URLSearchParams({
    fechaInicial: formatDate(desde, format),
    fechaFinal: formatDate(hasta, format),
    tipo: "0",
    campo: "",
    valor: "",
    sucursal: "1",
    caja: "1",
    empleado: "0",
    tipodoc: "-1",
    tipoaut: "T",
    tipopago: "-1",
  });
  const res = await fetch(`${base}/data/excelVentasDetallado.php?${query}`, {
    headers: { cookie },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`SmartMenu respondió ${res.status} al exportar el reporte`);
  const file = path.join(ensureDir(downloadsCacheDir), `REPORTE_VENTAS_DETALLADO_${stamp()}.xls`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  log.info(`Reporte bajado de SmartMenu: ${formatDate(desde, format)} → ${formatDate(hasta, format)}`);
  return file;
}

const SUBMIT = /^\s*(entrar|ingresar|aceptar|acceder|iniciar|iniciar sesi[oó]n|login|ok|continuar|enviar|validar)\s*$/i;

const keyInputs: Finder[] = [
  (r) => r.locator('input[type="password"]'),
  (r) => r.locator('input[inputmode="numeric"], input[type="number"], input[type="tel"]'),
  (r) =>
    r.locator(
      'input[name*="clave" i], input[id*="clave" i], input[name*="pass" i], input[id*="pass" i], input[name*="pin" i], input[id*="pin" i]',
    ),
  (r) => r.locator('input[type="text"], input:not([type])'),
];

function digitFinders(digit: string): Finder[] {
  const exact = new RegExp(`^\\s*${digit}\\s*$`);
  return [
    (r) => r.getByRole("button", { name: digit, exact: true }),
    (r) => r.locator(`input[type="button"][value="${digit}"], input[type="submit"][value="${digit}"]`),
    (r) => r.locator(`[data-value="${digit}"], [data-key="${digit}"], [data-num="${digit}"], img[alt="${digit}"]`),
    (r) => r.locator("button, a, td, th, div, span, li, label, p").filter({ hasText: exact }),
  ];
}

const submitFinders: Finder[] = [
  (r) => r.getByRole("button", { name: SUBMIT }),
  (r) => r.getByRole("link", { name: SUBMIT }),
  (r) => r.locator("button, a, td, div, span, li, label, p").filter({ hasText: SUBMIT }),
  (r) => r.locator('input[type="image"], [title*="ingresar" i], [title*="entrar" i], [title*="aceptar" i]'),
];

async function typeWithInput(page: Page, key: string): Promise<Locator | null> {
  const input = await findVisible(page, keyInputs, 6_000);
  if (!input || !(await input.isEditable().catch(() => false))) return null;
  await input.fill(key);
  // Algunos teclados en pantalla ignoran lo escrito en el campo: se verifica.
  if ((await input.inputValue().catch(() => "")) !== key) return null;
  return input;
}

async function typeWithKeypad(page: Page, key: string): Promise<boolean> {
  for (const digit of key) {
    const button = await findVisible(page, digitFinders(digit), 6_000);
    if (!button) return false;
    await button.click();
    await sleep(150);
  }
  return true;
}

async function stillOnLogin(page: Page, loginUrl: string): Promise<boolean> {
  if (page.isClosed()) return false;
  const sameUrl = page.url().split("#")[0] === loginUrl.split("#")[0];
  if (!sameUrl) return false;
  const keyBox = await findVisible(page, keyInputs.slice(0, 1), 0);
  const keypad = await findVisible(page, digitFinders("7"), 0);
  return Boolean(keyBox || keypad);
}

/**
 * Entra a SmartMenu solo con la clave numérica. No conocemos la pantalla, así
 * que se prueba primero un campo de clave y, si no hay o no acepta texto, el
 * teclado numérico en pantalla. Si SmartMenu abre la app en otra ventana se
 * devuelve esa.
 */
export async function login(page: Page, url: string, key: string): Promise<Page> {
  const context = page.context();
  let opened: Page | null = null;
  const onPage = (p: Page) => (opened = p);
  context.on("page", onPage);
  try {
    for (const strategy of ["campo", "teclado"] as const) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      const loginUrl = page.url();

      let input: Locator | null = null;
      if (strategy === "campo") {
        input = await typeWithInput(page, key);
        if (!input) continue;
      } else if (!(await typeWithKeypad(page, key))) {
        continue;
      }

      const submit = await findVisible(page, submitFinders, 2_000);
      if (submit) await submit.click().catch(() => undefined);
      else if (input) await input.press("Enter");
      else await page.keyboard.press("Enter");

      const until = Date.now() + 15_000;
      while (Date.now() < until) {
        await sleep(500);
        if (opened) {
          await (opened as Page).waitForLoadState("domcontentloaded").catch(() => undefined);
          log.info(`Entré a SmartMenu (${strategy}); abrió otra ventana: ${(opened as Page).url()}`);
          return opened;
        }
        if (!(await stillOnLogin(page, loginUrl))) {
          await page.waitForLoadState("domcontentloaded").catch(() => undefined);
          log.info(`Entré a SmartMenu (${strategy}): ${page.url()}`);
          return page;
        }
      }
      log.warn(`La clave con ${strategy} no pasó del login, pruebo otra forma`);
    }
  } finally {
    context.off("page", onPage);
  }
  throw new Error("No pude entrar a SmartMenu con la clave: no encontré el campo ni el teclado, o la clave no pasó");
}
