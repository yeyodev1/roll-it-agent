import { createHash } from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

const pad = (n: number, size = 2) => String(n).padStart(size, "0");

/**
 * Formatea con fichas tipo `dd/MM/yyyy HH:mm`. `hh` es la hora de 12 y `tt` el
 * AM/PM, porque SmartMenu escribe sus fechas como "01-01-2025 12:00:00AM".
 */
export function formatDate(date: Date, format: string): string {
  const h12 = date.getHours() % 12 || 12;
  const tokens: Record<string, string> = {
    yyyy: String(date.getFullYear()),
    MM: pad(date.getMonth() + 1),
    dd: pad(date.getDate()),
    HH: pad(date.getHours()),
    hh: pad(h12),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    tt: date.getHours() < 12 ? "AM" : "PM",
  };
  return format.replace(/yyyy|MM|dd|HH|hh|mm|ss|tt/g, (t) => tokens[t]);
}

/** Marca de tiempo segura para nombres de archivo: 2026-10-14_15-30-05. */
export function stamp(date = new Date()): string {
  return formatDate(date, "yyyy-MM-dd_HH-mm-ss");
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/** Carpeta especial de Windows leída del registro (OneDrive suele mover el Escritorio). */
function windowsShellFolder(name: string): string | null {
  if (process.platform !== "win32") return null;
  try {
    const out = execSync(
      `reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders" /v "${name}"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const match = out.match(/REG_(?:EXPAND_)?SZ\s+(.+)\s*$/m);
    if (!match) return null;
    const value = match[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? "");
    return fs.existsSync(value) ? value : null;
  } catch {
    return null;
  }
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((dir) => fs.existsSync(dir)) ?? null;
}

export function desktopDir(): string {
  const home = os.homedir();
  return (
    windowsShellFolder("Desktop") ??
    firstExisting([
      path.join(home, "Desktop"),
      path.join(home, "Escritorio"),
      path.join(home, "OneDrive", "Desktop"),
      path.join(home, "OneDrive", "Escritorio"),
    ]) ??
    home
  );
}

export function defaultDownloadsDir(): string {
  const home = os.homedir();
  return (
    windowsShellFolder("{374DE290-123F-4565-9164-39C4925E467B}") ??
    firstExisting([path.join(home, "Downloads"), path.join(home, "Descargas")]) ??
    path.join(home, "Downloads")
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.split("\n")[0];
  return String(error);
}
