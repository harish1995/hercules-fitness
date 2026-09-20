/**
 * Member ID rules (US-2.2, architecture §2.3). The transaction that allocates the ID lives in the
 * service layer; the pure parts are here so they are unit-testable.
 */

/** `GYM-2026-0007`; grows past 4 digits naturally (`GYM-2026-10000`). */
export function formatMemberId(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new RangeError('Invalid member ID year');
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError('Member ID sequence must be a positive integer');
  return `GYM-${year}-${String(seq).padStart(4, '0')}`;
}

export const MEMBER_ID_PATTERN = /^GYM-\d{4}-\d{4,}$/;

/** The counter document id for a year: `counters/memberId-2026`. */
export function counterDocId(year: number): string {
  return `memberId-${year}`;
}

/** Next sequence number given the counter's current `lastSeq` (undefined when the counter does not exist yet). */
export function nextSeq(lastSeq: unknown): number {
  if (lastSeq === undefined || lastSeq === null) return 1;
  if (typeof lastSeq !== 'number' || !Number.isInteger(lastSeq) || lastSeq < 0) {
    throw new RangeError('Corrupt member ID counter');
  }
  return lastSeq + 1;
}
