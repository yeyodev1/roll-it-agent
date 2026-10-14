import path from "path";
import { acceptDialogs, launch, saveFailure } from "../browser";
import { Config } from "../config";
import { log } from "../logger";
import { loadRecipe, pruneDownloads, runRecipe } from "../recipe";
import { registry } from "../registry";
import { isSalesReport } from "../report";
import { uploadUntilDone } from "../uploader";
import { startOfDay } from "../util";

export interface AutoOptions {
  visible?: boolean;
  upload?: boolean;
}

// Si se cayó internet varios días, al volver se pide desde el último envío, pero nunca más de una semana.
const MAX_BACKFILL_DAYS = 7;

/**
 * Desde las 00:00 del día del último envío exitoso: si internet se cayó antes
 * de medianoche, las ventas de esa noche entran en el siguiente reporte.
 */
function reportRange(now = new Date()) {
  const last = registry.lastSuccessAt();
  const floor = startOfDay(new Date(now.getTime() - MAX_BACKFILL_DAYS * 24 * 60 * 60 * 1000));
  let desde = startOfDay(last && last < now ? last : now);
  if (desde < floor) desde = floor;
  return { desde, hasta: now };
}

/** Un ciclo: entra a SmartMenu, baja el reporte y lo sube. Lanza si algo falla. */
export async function autoCycle(config: Config, options: AutoOptions = {}): Promise<string> {
  const recipe = loadRecipe(config);
  const dates = reportRange();
  const browser = await launch(Boolean(options.visible));
  let file: string;
  try {
    const context = await browser.newContext({ acceptDownloads: true, ignoreHTTPSErrors: true });
    acceptDialogs(context);
    const page = await context.newPage();
    try {
      file = await runRecipe(context, page, recipe, config, dates);
    } catch (error) {
      const where = await saveFailure(context, (error as Error).message);
      throw new Error(`${(error as Error).message} (captura en ${path.relative(process.cwd(), where) || where})`);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  pruneDownloads();

  if (!isSalesReport(file)) {
    throw new Error(`Lo que bajó (${path.basename(file)}) no parece el reporte de ventas detallado`);
  }
  if (options.upload === false) {
    log.info(`Prueba de receta OK: ${file}`);
    return file;
  }
  const outcome = await uploadUntilDone(config, file);
  if (outcome === "repetido") log.info("Sin ventas nuevas desde el último envío");
  if (outcome === "rechazado") throw new Error(`El panel rechazó ${path.basename(file)}`);
  return file;
}
