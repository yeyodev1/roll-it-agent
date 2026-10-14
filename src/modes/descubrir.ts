import AdmZip from "adm-zip";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { BrowserContext, Page, Request, Response } from "playwright";
import { acceptDialogs, launch } from "../browser";
import { Config } from "../config";
import { log } from "../logger";
import { baseDir, ensureDir } from "../paths";
import { login } from "../smartmenu";
import { desktopDir, stamp } from "../util";

const TEXT_TYPES = /json|xml|html|text|javascript|x-www-form-urlencoded/i;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const POLL_MS = 4_000;

/**
 * Graba todo lo que pasa mientras la persona del local navega SmartMenu hasta
 * exportar el reporte: HAR de red con cuerpos, una captura y el HTML de cada
 * pantalla, y lo que descargue. Con eso armamos la receta sin haber visto
 * SmartMenu nunca.
 */
export async function runDiscovery(config: Config): Promise<string> {
  const id = stamp();
  const dir = ensureDir(path.join(baseDir, `descubrimiento-${id}`));
  const screensDir = ensureDir(path.join(dir, "pantallas"));
  const downloadsDir = ensureDir(path.join(dir, "descargas"));
  const netLog = fs.createWriteStream(path.join(dir, "red.jsonl"), { flags: "a" });
  const index = fs.createWriteStream(path.join(screensDir, "indice.txt"), { flags: "a" });
  const consoleLog = fs.createWriteStream(path.join(dir, "consola.txt"), { flags: "a" });
  const note = (stream: fs.WriteStream, line: string) => stream.write(`${new Date().toISOString()} ${line}\n`);

  const browser = await launch(true);
  const context: BrowserContext = await browser.newContext({
    viewport: null,
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
    // HAR completo con cuerpos: ahí se ven los endpoints internos de SmartMenu.
    recordHar: { path: path.join(dir, "red.har"), content: "embed", mode: "full" },
  });
  acceptDialogs(context, (text) => note(consoleLog, `[ventana] ${text}`));

  // Respaldo de la red escrito sobre la marcha: si el navegador se cierra de golpe el HAR puede no guardarse.
  context.on("request", (req: Request) => {
    netLog.write(
      JSON.stringify({ t: new Date().toISOString(), tipo: "pedido", method: req.method(), url: req.url(), resource: req.resourceType(), headers: req.headers(), postData: req.postData() }) + "\n",
    );
  });
  context.on("response", async (res: Response) => {
    const headers = res.headers();
    let body: string | undefined;
    if (TEXT_TYPES.test(headers["content-type"] ?? "")) {
      const buffer = await res.body().catch(() => null);
      if (buffer && buffer.length <= MAX_BODY_BYTES) body = buffer.toString("utf8");
    }
    netLog.write(JSON.stringify({ t: new Date().toISOString(), tipo: "respuesta", status: res.status(), url: res.url(), headers, body }) + "\n");
  });

  let counter = 0;
  let queue = Promise.resolve();
  const lastHash = new Map<Page, string>();

  async function pageHtml(page: Page) {
    const parts: string[] = [];
    for (const frame of page.frames()) parts.push(await frame.content().catch(() => ""));
    return parts;
  }

  function capture(page: Page, reason: string, force = false) {
    queue = queue.then(async () => {
      if (page.isClosed()) return;
      const parts = await pageHtml(page);
      const hash = createHash("sha1").update(parts.join("\n")).digest("hex");
      if (!force && lastHash.get(page) === hash) return;
      lastHash.set(page, hash);
      const n = String(++counter).padStart(3, "0");
      // Con tope de tiempo: una captura trabada no puede frenar las siguientes.
      await page
        .screenshot({ path: path.join(screensDir, `${n}.png`), fullPage: true, timeout: 8_000 })
        .catch(() => note(index, `${n} sin captura (la pantalla no respondió)`));
      const frames = page.frames();
      parts.forEach((html, i) => {
        if (!html) return;
        const name = i === 0 ? `${n}.html` : `${n}-frame${i}.html`;
        fs.writeFileSync(path.join(screensDir, name), `<!-- ${frames[i]?.url() ?? ""} -->\n${html}`);
      });
      const title = await page.title().catch(() => "");
      note(index, `${n} ${reason} | ${page.url()} | ${title}`);
    }).catch(() => undefined);
  }

  function watch(page: Page) {
    page.on("framenavigated", (frame) =>
      capture(page, frame === page.mainFrame() ? "cambió la URL" : `frame: ${frame.url()}`, frame === page.mainFrame()),
    );
    page.on("load", () => capture(page, "cargó"));
    page.on("console", (msg) => note(consoleLog, `[${msg.type()}] ${page.url()} ${msg.text()}`));
    page.on("download", async (download) => {
      const name = download.suggestedFilename() || "descarga";
      const target = path.join(downloadsDir, `${stamp()}_${name}`);
      await download.saveAs(target).catch(() => undefined);
      log.info(`Guardé la descarga ${name}. Si es el reporte, ya puedes cerrar el navegador.`);
      note(index, `descarga ${name} desde ${download.url()}`);
      capture(page, "descargó", true);
    });
  }
  context.on("page", (page) => {
    note(index, `nueva ventana ${page.url()}`);
    watch(page);
  });

  const page = await context.newPage();
  // Cambios sin URL nueva (ventanas, menús por AJAX): se compara el HTML cada pocos segundos.
  const poller = setInterval(() => context.pages().forEach((p) => capture(p, "cambió la pantalla")), POLL_MS);

  console.log("\n================================================================");
  console.log(" MODO DESCUBRIR: se abrió SmartMenu en una ventana nueva.");
  console.log(" 1. Si no entra solo, escribe la clave como siempre.");
  console.log(" 2. Ve a Reportes → Ventas detallado.");
  console.log(" 3. Elige las fechas de HOY y exporta a Excel.");
  console.log(" 4. Cuando baje el archivo, CIERRA la ventana del navegador.");
  console.log(" Se guardará un .zip en el Escritorio para enviarlo a Bakano.");
  console.log("================================================================\n");

  try {
    await login(page, config.smartmenuUrl, config.smartmenuKey);
  } catch (error) {
    log.warn(`${(error as Error).message}. Entra a mano con la clave; igual se graba todo.`);
    capture(page, "no pude entrar solo", true);
  }

  // Termina cuando la persona cierra todas las ventanas o el navegador entero.
  await new Promise<void>((resolve) => {
    const check = () => {
      if (context.pages().every((p) => p.isClosed())) resolve();
    };
    context.on("close", () => resolve());
    browser.on("disconnected", () => resolve());
    context.on("page", (p) => p.on("close", check));
    page.on("close", check);
  });
  clearInterval(poller);
  await queue;
  // Cerrar el contexto es lo que escribe el HAR.
  await context.close().catch((error) => log.warn(`No se pudo guardar el HAR: ${error.message}`));
  await browser.close().catch(() => undefined);
  await Promise.all([netLog, index, consoleLog].map((s) => new Promise((r) => s.end(r))));

  const zipPath = path.join(desktopDir(), `descubrimiento-${id}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  zip.writeZip(zipPath);
  log.info(`Listo: ${counter} pantallas grabadas. Envía este archivo a Bakano: ${zipPath}`);
  return zipPath;
}
