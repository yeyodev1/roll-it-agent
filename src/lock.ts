import fs from "fs";
import path from "path";
import { dataDir, ensureDir } from "./paths";

const lockFile = () => path.join(dataDir, "agente.lock");

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

/**
 * Una sola copia del agente por PC: si la tarea programada ya lo arrancó y
 * alguien abre iniciar.bat, el segundo se va en vez de duplicar el trabajo.
 */
export function acquireLock(): boolean {
  ensureDir(dataDir);
  try {
    const pid = Number(fs.readFileSync(lockFile(), "utf8").trim());
    if (pid && pid !== process.pid && alive(pid)) return false;
  } catch {
    // Sin candado previo.
  }
  fs.writeFileSync(lockFile(), String(process.pid));
  const release = () => {
    try {
      if (fs.readFileSync(lockFile(), "utf8").trim() === String(process.pid)) fs.unlinkSync(lockFile());
    } catch {
      // Ya no estaba.
    }
  };
  process.on("exit", release);
  return true;
}
