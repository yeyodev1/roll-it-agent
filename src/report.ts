import path from "path";
import * as XLSX from "xlsx";

const NAME = /VENTAS[_ -]?DETALLADO/i;
const HEADER = "REPORTE DE VENTAS DETALLADO";
const EXTENSIONS = [".xls", ".xlsx"];

export function isSpreadsheet(file: string): boolean {
  return EXTENSIONS.includes(path.extname(file).toLowerCase());
}

export function hasReportName(file: string): boolean {
  return NAME.test(path.basename(file));
}

const clean = (value: unknown) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * true si el archivo trae el encabezado del reporte de SmartMenu (fila 4) o su
 * hoja `VENTAS_DETALLADO`. Solo se leen las primeras filas: es para descartar
 * cualquier otro Excel que caiga en Descargas.
 */
export function hasReportHeader(file: string): boolean {
  try {
    const workbook = XLSX.readFile(file, { sheetRows: 12, cellFormula: false, cellHTML: false });
    if (workbook.SheetNames.some((name) => NAME.test(name))) return true;
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return false;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    return rows.some((row) => row.some((cell) => clean(cell).includes(HEADER)));
  } catch {
    return false;
  }
}

export function isSalesReport(file: string): boolean {
  return isSpreadsheet(file) && (hasReportName(file) || hasReportHeader(file));
}
