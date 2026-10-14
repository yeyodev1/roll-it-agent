import fs from "fs";
import path from "path";
import { baseDir } from "./paths";
import { defaultDownloadsDir } from "./util";

export type Mode = "descubrir" | "carpeta" | "auto";
export const MODES: Mode[] = ["descubrir", "carpeta", "auto"];

export interface Config {
  apiUrl: string;
  syncKey: string;
  branch: string;
  smartmenuUrl: string;
  smartmenuKey: string;
  intervalMinutes: number;
  downloadsDir: string;
  mode: Mode;
  // De dónde se baja la receta actualizada; vacío = solo la local.
  recipeUrl: string;
}

export const DEFAULT_RECIPE_URL =
  "https://raw.githubusercontent.com/yeyodev1/roll-it-agent/main/smartmenu-steps.json";

export class ConfigError extends Error {}

export const configPath = process.env.ROLLIT_AGENT_CONFIG
  ? path.resolve(process.env.ROLLIT_AGENT_CONFIG)
  : path.join(baseDir, "config.json");

/** Lee y valida config.json. Los mensajes son para la persona del local, no para un programador. */
export function loadConfig(modeOverride?: Mode): Config {
  if (!fs.existsSync(configPath)) {
    throw new ConfigError(
      `No encuentro ${configPath}. Copia config.example.json como config.json y llénalo.`,
    );
  }
  let raw: any;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^﻿/, ""));
  } catch (error) {
    throw new ConfigError(
      `config.json tiene un error de formato (revisa comas y comillas): ${(error as Error).message}`,
    );
  }

  const text = (key: string) => (typeof raw[key] === "string" ? raw[key].trim() : "");
  const mode = modeOverride ?? (text("mode") || "carpeta");
  if (!MODES.includes(mode as Mode)) {
    throw new ConfigError(`"mode" debe ser uno de: ${MODES.join(", ")}`);
  }

  const config: Config = {
    apiUrl: text("apiUrl").replace(/\/+$/, ""),
    syncKey: text("syncKey"),
    branch: text("branch").toLowerCase(),
    smartmenuUrl: text("smartmenuUrl"),
    smartmenuKey: raw.smartmenuKey === undefined ? "" : String(raw.smartmenuKey).trim(),
    intervalMinutes: Number(raw.intervalMinutes) > 0 ? Number(raw.intervalMinutes) : 5,
    downloadsDir: text("downloadsDir") || defaultDownloadsDir(),
    mode: mode as Mode,
    recipeUrl: raw.recipeUrl === undefined ? DEFAULT_RECIPE_URL : text("recipeUrl"),
  };

  // Los textos de ejemplo de config.example.json cuentan como vacíos.
  if (config.syncKey === "PEGA_AQUI_LA_LLAVE") config.syncKey = "";
  if (config.smartmenuUrl.includes("IP-DEL-SERVIDOR")) config.smartmenuUrl = "";
  if (config.smartmenuKey === "CLAVE_DE_SMARTMENU") config.smartmenuKey = "";

  const missing: string[] = [];
  // En descubrir el panel es opcional: se puede grabar sin internet y mandar el zip después.
  if (config.mode !== "descubrir") {
    if (!config.apiUrl) missing.push("apiUrl");
    if (!config.syncKey) missing.push("syncKey");
    if (!config.branch) missing.push("branch");
  }
  if (config.mode !== "carpeta") {
    if (!config.smartmenuUrl) missing.push("smartmenuUrl");
    if (!config.smartmenuKey) missing.push("smartmenuKey");
  }
  if (missing.length) throw new ConfigError(`Faltan datos en config.json: ${missing.join(", ")}`);
  return config;
}
