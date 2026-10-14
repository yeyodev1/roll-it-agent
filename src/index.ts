import { AGENT_VERSION, heartbeat } from "./api";
import { Config, ConfigError, configPath, DEFAULT_RECIPE_URL, loadConfig, Mode, MODES } from "./config";
import { acquireLock } from "./lock";
import { log } from "./logger";
import { autoCycle } from "./modes/auto";
import { loadRecipe, refreshRecipe } from "./recipe";
import { scanFolder } from "./modes/carpeta";
import { runDiscovery } from "./modes/descubrir";
import { errorMessage, sleep } from "./util";

// La carpeta se revisa seguido para que el reporte suba apenas se descarga; el resto va cada intervalMinutes.
const FOLDER_SCAN_MS = 20_000;
const CONFIG_RETRY_MS = 60_000;
const ALREADY_RUNNING_EXIT = 3;

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.find((a) => !a.startsWith("--"));
const testRecipe = positional === "probar-receta";
const modeArg = testRecipe ? "auto" : positional;

process.on("uncaughtException", (error) => log.error(`Error inesperado: ${errorMessage(error)}`));
process.on("unhandledRejection", (error) => log.error(`Error inesperado: ${errorMessage(error)}`));

async function sendHeartbeat(config: Config, mode: Mode, lastError: string) {
  try {
    await heartbeat(config, mode, lastError);
  } catch (error) {
    log.warn(`No pude avisar al panel que sigo vivo: ${errorMessage(error)}`);
  }
}

/** Lee config.json en cada vuelta: si alguien lo corrige, no hace falta reiniciar el agente. */
async function readConfig(mode?: Mode): Promise<Config> {
  for (;;) {
    try {
      return loadConfig(mode);
    } catch (error) {
      log.error(errorMessage(error));
      if (!(error instanceof ConfigError)) throw error;
      await sleep(CONFIG_RETRY_MS);
    }
  }
}

/**
 * Bucle de carpeta y auto. La carpeta de descargas se vigila siempre (si
 * alguien exporta a mano, sube igual); cada intervalMinutes se manda el latido
 * y, en modo auto o con la receta marcada como activa, se baja el reporte de
 * SmartMenu. Nada de lo que falle en una vuelta corta el bucle.
 */
async function agentLoop(mode: "carpeta" | "auto") {
  let nextCycle = 0;
  let lastError = "";
  let announced = "";
  for (;;) {
    const config = await readConfig(mode);
    if (announced !== config.downloadsDir) {
      log.info(`Vigilando ${config.downloadsDir} cada ${FOLDER_SCAN_MS / 1000} s`);
      announced = config.downloadsDir;
    }
    try {
      const error = await scanFolder(config);
      if (error) lastError = error;
    } catch (error) {
      lastError = errorMessage(error);
      log.error(`Falló la revisión de la carpeta: ${lastError}`);
    }

    if (Date.now() >= nextCycle) {
      nextCycle = Date.now() + config.intervalMinutes * 60_000;
      let ranAuto = false;
      try {
        await refreshRecipe(config);
        let active = mode === "auto";
        if (!active) {
          // En carpeta la receta es opcional: si no está o está mala, solo se vigila la carpeta.
          try {
            active = loadRecipe(config).activa && Boolean(config.smartmenuUrl && config.smartmenuKey);
          } catch {
            active = false;
          }
        }
        if (active) {
          ranAuto = true;
          await autoCycle(config);
        }
      } catch (error) {
        lastError = errorMessage(error);
        log.error(`Ciclo fallido, reintento en el próximo: ${lastError}`);
      }
      await sendHeartbeat(config, ranAuto ? "auto" : "carpeta", lastError);
      lastError = "";
    }
    await sleep(FOLDER_SCAN_MS);
  }
}

async function main() {
  if (modeArg && !MODES.includes(modeArg as Mode)) {
    console.log(`Uso: node dist/index.js [${MODES.join("|")}|probar-receta]`);
    process.exit(1);
  }
  log.info(`Roll It agente ${AGENT_VERSION} (${configPath})`);

  if (testRecipe) {
    // Se prueba la receta local: es la que se está ajustando en el local.
    const config = { ...(await readConfig("auto")), recipeUrl: flags.has("--remota") ? DEFAULT_RECIPE_URL : "" };
    if (config.recipeUrl) await refreshRecipe(config);
    try {
      await autoCycle(config, { visible: !flags.has("--oculto"), upload: flags.has("--subir") });
    } catch (error) {
      log.error(errorMessage(error));
      process.exitCode = 1;
    }
    return;
  }

  if (modeArg === "descubrir") {
    const config = await readConfig("descubrir");
    if (config.apiUrl && config.syncKey && config.branch) await sendHeartbeat(config, "descubrir", "");
    await runDiscovery(config);
    return;
  }

  if (!acquireLock()) {
    log.warn("El agente ya está corriendo en esta PC. Cierro esta copia.");
    // Código propio para que iniciar.bat/.sh no la vuelva a arrancar en bucle.
    process.exitCode = ALREADY_RUNNING_EXIT;
    return;
  }
  const config = await readConfig(modeArg as Mode | undefined);
  log.info(`Modo ${config.mode}, sucursal ${config.branch}, cada ${config.intervalMinutes} min`);
  if (config.mode === "descubrir") await runDiscovery(config);
  else await agentLoop(config.mode);
}

main().catch((error) => {
  log.error(`El agente se detuvo: ${errorMessage(error)}`);
  process.exitCode = 1;
});
