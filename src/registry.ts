import fs from "fs";
import path from "path";
import { dataDir, ensureDir } from "./paths";

/**
 * Registro local de lo que ya se subió, por hash del contenido: el mismo
 * reporte con otro nombre no se vuelve a mandar, y uno que se re-exportó con
 * más ventas (otro contenido) sí.
 */
interface Entry {
  file: string;
  at: string;
  detail: string;
}

interface Registry {
  startedAt: string;
  lastSuccessAt: string | null;
  uploaded: Record<string, Entry>;
  rejected: Record<string, Entry>;
}

const MAX_ENTRIES = 2000;
const file = () => path.join(dataDir, "registro.json");
let cache: Registry | null = null;

function load(): Registry {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    cache = null;
  }
  if (!cache || typeof cache !== "object") {
    cache = { startedAt: new Date().toISOString(), lastSuccessAt: null, uploaded: {}, rejected: {} };
    save();
  }
  cache.uploaded ??= {};
  cache.rejected ??= {};
  return cache;
}

function trim(map: Record<string, Entry>) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return;
  keys
    .sort((a, b) => map[a].at.localeCompare(map[b].at))
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((k) => delete map[k]);
}

function save() {
  ensureDir(dataDir);
  // Se escribe a un temporal y se renombra: un apagón a mitad no deja el registro corrupto.
  const tmp = `${file()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, file());
}

export const registry = {
  /** Cuándo empezó a correr el agente en esta PC por primera vez. */
  startedAt: () => new Date(load().startedAt),
  lastSuccessAt: () => {
    const value = load().lastSuccessAt;
    return value ? new Date(value) : null;
  },
  isKnown: (hash: string) => Boolean(load().uploaded[hash] || load().rejected[hash]),
  wasUploaded: (hash: string) => Boolean(load().uploaded[hash]),
  markUploaded(hash: string, name: string, detail: string) {
    const r = load();
    const at = new Date().toISOString();
    r.uploaded[hash] = { file: name, at, detail };
    r.lastSuccessAt = at;
    trim(r.uploaded);
    save();
  },
  markRejected(hash: string, name: string, detail: string) {
    const r = load();
    r.rejected[hash] = { file: name, at: new Date().toISOString(), detail };
    trim(r.rejected);
    save();
  },
};
