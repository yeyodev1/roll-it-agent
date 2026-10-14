import fs from "fs";
import path from "path";
import { Config, Mode } from "./config";
import { log } from "./logger";
import { errorMessage, sleep } from "./util";

export const AGENT_VERSION: string = require("../package.json").version;

/** Error del back con su código: los 4xx no se reintentan, el archivo o la config están mal. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
  get retryable() {
    return this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

async function request(config: Config, route: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.apiUrl}${route}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "x-sync-key": config.syncKey },
      signal: controller.signal,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body?.message || `El panel respondió ${res.status}`, res.status);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reintenta con espera creciente cuando no hay internet o el panel falla. Si se
 * agotan los intentos se rinde: el siguiente ciclo vuelve a probar y, como el
 * upload es idempotente, no se pierde ninguna venta.
 */
export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let delay = 5_000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = !(error instanceof ApiError) || error.retryable;
      if (!retryable || i >= attempts) throw error;
      log.warn(`${label}: ${errorMessage(error)}. Reintento ${i}/${attempts - 1} en ${delay / 1000} s`);
      await sleep(delay);
      delay = Math.min(delay * 3, 120_000);
    }
  }
}

export async function heartbeat(config: Config, mode: Mode, lastError: string) {
  return withRetry(
    "Latido",
    () =>
      request(
        config,
        "/sync/heartbeat",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            branch: config.branch,
            agentVersion: AGENT_VERSION,
            mode,
            lastError: lastError || undefined,
          }),
        },
        20_000,
      ),
    2,
  );
}

export interface UploadResult {
  branch: { slug: string; name: string };
  rows: number;
  tickets: number;
  received: number;
  unchanged: number;
  created: number;
  updated: number;
  pending: number;
  from: string | null;
  to: string | null;
}

export async function uploadReport(config: Config, file: string): Promise<UploadResult> {
  const buffer = fs.readFileSync(file);
  return withRetry(`Subida de ${path.basename(file)}`, () => {
    const form = new FormData();
    form.append("branch", config.branch);
    form.append("file", new Blob([buffer]), path.basename(file));
    // Vercel corta a los 60 s: se espera un poco más para leer su respuesta.
    return request(config, "/sync/upload", { method: "POST", body: form }, 90_000);
  });
}
