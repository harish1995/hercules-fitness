import { describe, expect, it } from 'vitest';
import { buildCsv, CSV_BOM, CSV_EOL, CSV_MAX_CELL_CHARS, csvCell, csvRow, encodeCsvRows, neutralizeFormula } from './csv';

/**
 * US-8.1a / FR-10 / US-6.2: CSV formula-injection neutralization, RFC 4180 quoting, UTF-8 BOM. The encoder is the ONE place a cell becomes
 * text, so every report is covered by these cases.
 */
describe('formula neutralization (CSV / formula injection)', () => {
  it.each([
    ['=1+1', "'=1+1"],
    ['+91 98765 43210', "'+91 98765 43210"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A9)', "'@SUM(A1:A9)"],
    ['=HYPERLINK("http://evil.example","x")', "'=HYPERLINK(\"http://evil.example\",\"x\")"],
    ['=cmd|\' /C calc\'!A0', "'=cmd|' /C calc'!A0"],
    ['  =1+1', "'  =1+1"], // leading spaces are skipped when looking for the trigger
    [' =1+1', "' =1+1"], // non-breaking space
    ['​@x', "'​@x"], // zero-width space
    ['\t=1', "'\t=1"], // a leading tab
    ['\r=1', "'\r=1"],
    ['\n=1', "'\n=1"],
  ])('neutralizes %j', (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it.each(['Rahul Sharma', 'a=b', 'a+b', 'x-y', 'me@example.com', '', '12/09/2026', "'already", '1500.00', 'GYM-2026-0001', '9876543210'])(
    'leaves %j alone (the trigger must be the FIRST significant character)',
    (input) => {
      expect(neutralizeFormula(input)).toBe(input);
    },
  );

  it('csvCell neutralizes text cells but never numbers the app produced (a negative number stays a number)', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(1500)).toBe('1500');
  });

  it('a neutralized cell that also needs quoting is quoted AFTER the apostrophe is added', () => {
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
    expect(csvCell('=say "hi"')).toBe('"\'=say ""hi"""');
  });

  it('a hostile member name, reference or header cannot become a formula anywhere in a document', () => {
    const csv = buildCsv(['=HEADER'], [['+hostile', '@name', '-1+1', 'ok']]);
    for (const cell of ["'=HEADER", "'+hostile", "'@name", "'-1+1"]) expect(csv).toContain(cell);
    expect(csv.split(CSV_EOL).join('\n')).not.toMatch(/(^|,)[=+@-]/m);
  });
});

describe('RFC 4180 quoting', () => {
  it.each([
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line1\nline2', '"line1\nline2"'],
    ['line1\r\nline2', '"line1\r\nline2"'],
    ['', ''],
  ])('%j -> %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it('null, undefined and non-finite numbers are empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('control characters (except tab, LF, CR) are stripped: they are never meaningful in a report', () => {
    expect(csvCell('a\u0000b\u0007c\u007Fd\u001Fe')).toBe('abcde');
    expect(csvCell('a\tb')).toBe('a\tb');
  });

  it('a cell above Excel\'s limit is truncated with an ellipsis instead of corrupting the row', () => {
    const long = csvCell('x'.repeat(CSV_MAX_CELL_CHARS + 500));
    expect(long).toHaveLength(CSV_MAX_CELL_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });

  it('non-Latin text and the rupee sign pass through unchanged', () => {
    expect(csvCell('राहुल शर्मा')).toBe('राहुल शर्मा');
    expect(csvCell('Amount (₹)')).toBe('Amount (₹)');
  });
});

describe('document layout', () => {
  it('rows are joined with commas and terminated with CRLF', () => {
    expect(csvRow(['a', 1, null, 'b,c'])).toBe('a,1,,"b,c"');
    expect(encodeCsvRows([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d\r\n');
    expect(encodeCsvRows([])).toBe('');
  });

  it('a whole CSV starts with exactly one UTF-8 BOM (so Excel shows non-Latin names correctly)', () => {
    const csv = buildCsv(['Name'], [['राहुल']]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.indexOf(CSV_BOM, 1)).toBe(-1);
    expect(csv).toBe(`${CSV_BOM}Name\r\nराहुल\r\n`);
    expect(Array.from(new TextEncoder().encode(csv).slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('the BOM-prefixed header cell itself is not mistaken for a formula trigger', () => {
    expect(buildCsv(['Name'], []).startsWith(`${CSV_BOM}Name`)).toBe(true);
  });
});
