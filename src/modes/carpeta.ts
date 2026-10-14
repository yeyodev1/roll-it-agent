import fs from "fs";
import path from "path";
import { Config } from "../config";
import { log } from "../logger";
import { hasReportHeader, hasReportName, isSpreadsheet } from "../report";
import { registry } from "../registry";
import { uploadUntilDone } from "../uploader";

// Solo se miran los reportes de la última semana antes de instalar: Descargas
// puede tener exportes viejos de meses que no hace falta reenviar.
const BACKLOG_MS = 7 * 24 * 60 * 60 * 1000;
// Un archivo recién bajado puede estar a medio escribir: se espera que deje de cambiar.
const SETTLE_MS = 3_000;

const lastSeen = new Map<string, string>();
const headerCache = new Map<string, boolean>();
// Versiones de archivo ya resueltas (subidas, repetidas o rechazadas): no se vuelven a leer.
const done = new Set<string>();

function looksLikeReport(file: string, signature: string, startedAt: Date, mtime: number): boolean {
  if (mtime < startedAt.getTime() - BACKLOG_MS) return false;
  if (hasReportName(file)) return true;
  // Cualquier otro Excel nuevo solo si trae el encabezado del reporte.
  if (mtime < startedAt.getTime()) return false;
  const cacheKey = `${file}|${signature}`;
  if (!headerCache.has(cacheKey)) headerCache.set(cacheKey, hasReportHeader(file));
  return headerCache.get(cacheKey)!;
}

/**
 * Revisa la carpeta de descargas una vez y sube los reportes nuevos. Devuelve
 * el último error para el latido (vacío si todo salió bien).
 */
export async function scanFolder(config: Config): Promise<string> {
  const dir = config.downloadsDir;
  if (!fs.existsSync(dir)) return `No existe la carpeta ${dir}`;
  const startedAt = registry.startedAt();
  let lastError = "";

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isSpreadsheet(e.name) && !e.name.startsWith("~$"))
    .map((e) => path.join(dir, e.name));

  for (const file of entries) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    const signature = `${stat.size}:${stat.mtimeMs}`;
    const previous = lastSeen.get(file);
    lastSeen.set(file, signature);
    if (done.has(`${file}|${signature}`)) continue;
    if (previous !== signature || Date.now() - stat.mtimeMs < SETTLE_MS) continue;
    if (!looksLikeReport(file, signature, startedAt, stat.mtimeMs)) continue;

    try {
      const outcome = await uploadUntilDone(config, file);
      done.add(`${file}|${signature}`);
      if (outcome === "subido") log.info(`Subí ${path.basename(file)}`);
      if (outcome === "rechazado") lastError = `El panel rechazó ${path.basename(file)}`;
    } catch (error) {
      lastError = `No pude subir ${path.basename(file)}: ${(error as Error).message}`;
      log.error(lastError);
      // Se olvida la firma para que el próximo escaneo lo reintente.
      lastSeen.delete(file);
    }
  }
  return lastError;
}
