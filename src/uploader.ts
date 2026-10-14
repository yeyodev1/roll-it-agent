import fs from "fs";
import path from "path";
import { ApiError, uploadReport } from "./api";
import { Config } from "./config";
import { log } from "./logger";
import { registry } from "./registry";
import { sha256 } from "./util";

// Con el límite de 60 s de Vercel un reporte grande puede necesitar varias vueltas.
const MAX_ROUNDS = 15;

export type UploadOutcome = "subido" | "repetido" | "rechazado";

/**
 * Sube el reporte y lo repite mientras el panel diga `pending > 0`. Los errores
 * de red o del servidor se lanzan (el ciclo lo reintenta luego); un 4xx deja el
 * archivo como rechazado para no insistir con un archivo que nunca va a entrar.
 */
export async function uploadUntilDone(config: Config, file: string): Promise<UploadOutcome> {
  const name = path.basename(file);
  const hash = sha256(fs.readFileSync(file));
  if (registry.isKnown(hash)) return "repetido";

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    let result;
    try {
      result = await uploadReport(config, file);
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        registry.markRejected(hash, name, error.message);
        log.error(`El panel rechazó ${name}: ${error.message}`);
        return "rechazado";
      }
      throw error;
    }
    log.info(
      `${name} → ${result.branch?.slug}: ${result.tickets} tickets, ${result.created} nuevos, ` +
        `${result.updated} actualizados, ${result.unchanged} sin cambios, ${result.pending} pendientes`,
    );
    if (!result.pending) {
      registry.markUploaded(
        hash,
        name,
        `${result.tickets} tickets (${result.from ?? "?"} → ${result.to ?? "?"})`,
      );
      return "subido";
    }
  }
  throw new Error(`${name} sigue con tickets pendientes después de ${MAX_ROUNDS} vueltas`);
}
