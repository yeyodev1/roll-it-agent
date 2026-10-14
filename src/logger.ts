import fs from "fs";
import path from "path";
import { ensureDir, logsDir } from "./paths";
import { formatDate } from "./util";

// Un archivo por día; se borran los de más de dos semanas para no llenar el disco de la PC del local.
const KEEP_DAYS = 14;
let lastCleanup = "";

function cleanup(today: string) {
  if (lastCleanup === today) return;
  lastCleanup = today;
  const limit = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(logsDir)) {
    if (!/^agente-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
    const file = path.join(logsDir, name);
    try {
      if (fs.statSync(file).mtimeMs < limit) fs.unlinkSync(file);
    } catch {
      // Si Windows tiene el archivo abierto se intenta mañana.
    }
  }
}

function write(level: string, message: string) {
  const now = new Date();
  const line = `${formatDate(now, "yyyy-MM-dd HH:mm:ss")} [${level}] ${message}`;
  console.log(line);
  try {
    ensureDir(logsDir);
    const today = formatDate(now, "yyyy-MM-dd");
    fs.appendFileSync(path.join(logsDir, `agente-${today}.log`), line + "\n");
    cleanup(today);
  } catch {
    // Un log que no se puede escribir nunca debe tumbar al agente.
  }
}

export const log = {
  info: (message: string) => write("INFO", message),
  warn: (message: string) => write("AVISO", message),
  error: (message: string) => write("ERROR", message),
};
