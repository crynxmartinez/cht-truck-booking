/**
 * A spreadsheet-ready CSV for Excel. Renters type their own names, and a cell
 * that starts with = + - or @ is run as a formula by Excel, so a name like
 * =HYPERLINK(...) could do something when the file is opened. Such cells are
 * made plain text. A leading BOM makes Excel read accents correctly.
 */

const BOM = '﻿';
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: readonly string[], rows: ReadonlyArray<readonly unknown[]>): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}
