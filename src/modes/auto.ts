import path from "path";
import { Config } from "../config";
import { log } from "../logger";
import { pruneDownloads } from "../recipe";
import { registry } from "../registry";
import { isSalesReport } from "../report";
import { downloadReport } from "../smartmenu";
import { uploadUntilDone } from "../uploader";
import { startOfDay } from "../util";

export interface AutoOptions {
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

/** Un ciclo: baja el reporte de SmartMenu por HTTP y lo sube. Lanza si algo falla. */
export async function autoCycle(config: Config, options: AutoOptions = {}): Promise<string> {
  const { desde, hasta } = reportRange();
  const file = await downloadReport(config, desde, hasta);
  pruneDownloads();

  if (!isSalesReport(file)) {
    throw new Error(`Lo que bajó (${path.basename(file)}) no parece el reporte de ventas detallado`);
  }
  if (options.upload === false) {
    log.info(`Prueba OK: ${file}`);
    return file;
  }
  const outcome = await uploadUntilDone(config, file);
  if (outcome === "repetido") log.info("Sin ventas nuevas desde el último envío");
  if (outcome === "rechazado") throw new Error(`El panel rechazó ${path.basename(file)}`);
  return file;
}
