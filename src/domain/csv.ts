/**
 * CSV encoding for report exports (architecture §5.7, FR-10, US-6.2). Pure and Firebase-free: it is the ONE place a cell
 * becomes text, so escaping and formula-injection defence cannot be forgotten by a report.
 *
 *   - RFC 4180: fields are separated by `,`, records end with CRLF, a field containing `,` `"` CR or LF is wrapped in `"`
 *     and its `"` are doubled.
 *   - UTF-8 with a BOM (`CSV_BOM`, prepended once by the caller) so Excel opens `₹` and Indian-script names correctly.
 *   - CSV / formula injection: a TEXT cell whose first significant character is `=` `+` `-` `@`, or that starts with a
 *     tab / CR / LF, is prefixed with `'` so a spreadsheet shows it as text instead of running it. Numbers (`number`) are
 *     produced by the app itself and are never neutralized; every string is, including names, references and headers.
 */

export const CSV_BOM = '\uFEFF';
export const CSV_EOL = '\r\n';

/** Excel refuses cells above 32,767 characters and mangles the rest of the row; nothing the app stores comes close. */
export const CSV_MAX_CELL_CHARS = 32_000;

export type CsvCell = string | number | null | undefined;

// C0 controls except TAB / LF / CR (which the RFC allows inside a quoted field), and DEL: they are never meaningful in a report.
// eslint-disable-next-line no-control-regex
const STRIP_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Leading invisible / space characters are skipped when looking for the trigger: ` =1+1` is still a formula in some tools.
const FORMULA_START = /^(?:[\t\r\n]|[\s\u00A0\u200B\uFEFF]*[=+\-@])/;
const NEEDS_QUOTES = /[",\r\n]/;

/** `'`-prefix a text that a spreadsheet could interpret as a formula. Everything else is returned unchanged. */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** One cell as CSV text (neutralized, truncated to Excel's limit, quoted when needed). null / undefined / NaN = empty. */
export function csvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  let text = neutralizeFormula(cell.replace(STRIP_CONTROL, ''));
  if (text.length > CSV_MAX_CELL_CHARS) text = `${text.slice(0, CSV_MAX_CELL_CHARS - 1)}…`;
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(',');
}

/** Records joined and terminated by CRLF (no BOM): one chunk of a file that is assembled page by page. */
export function encodeCsvRows(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((r) => `${csvRow(r)}${CSV_EOL}`).join('');
}

/** A whole CSV document including the BOM. */
export function buildCsv(header: readonly CsvCell[], rows: readonly (readonly CsvCell[])[]): string {
  return CSV_BOM + encodeCsvRows([header, ...rows]);
}
