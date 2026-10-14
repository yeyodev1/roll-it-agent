import path from "path";
import fs from "fs";

/**
 * Todo vive junto al agente (config.json, logs/, datos/), no en la carpeta del
 * usuario: así quien lo instala lo encuentra en un solo lugar. ROLLIT_AGENT_HOME
 * permite moverlo en las pruebas.
 */
export const baseDir = process.env.ROLLIT_AGENT_HOME
  ? path.resolve(process.env.ROLLIT_AGENT_HOME)
  : path.resolve(__dirname, "..");

export const logsDir = path.join(baseDir, "logs");
export const failuresDir = path.join(logsDir, "fallos");
export const dataDir = path.join(baseDir, "datos");
export const downloadsCacheDir = path.join(dataDir, "descargas");

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
