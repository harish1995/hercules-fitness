/**
 * Search normalization and field inference (architecture §5.2). Firestore has no full-text search,
 * so members carry lowercase normalized fields and the list runs PREFIX range queries on them.
 */

/** trim + lowercase + NFKD, internal whitespace collapsed to single spaces. */
export function normalizeText(input: string): string {
  return input.normalize('NFKD').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Collapse whitespace and trim, keeping case (used for display names). */
export function collapseSpaces(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Normalize an Indian mobile number: digits only, +91 / 91 / leading 0 prefix stripped, must be 10
 * digits starting 6-9. Returns null when it is not a valid Indian mobile (NEW-14).
 */
export function normalizeMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export interface MemberSearchFields {
  displayName: string;
  searchFullName: string;
  searchReverseName: string;
  searchMobile: string;
}

/** Derived fields stored on the member (recomputed on every create/update, §2.7). */
export function buildMemberSearchFields(input: {
  firstName: string;
  lastName: string;
  mobile: string;
}): MemberSearchFields {
  const first = collapseSpaces(input.firstName);
  const last = collapseSpaces(input.lastName);
  return {
    displayName: `${first} ${last}`.trim(),
    searchFullName: normalizeText(`${first} ${last}`),
    searchReverseName: normalizeText(`${last} ${first}`),
    searchMobile: input.mobile,
  };
}

export type SearchQuery =
  | { kind: 'none' }
  | { kind: 'mobile'; term: string }
  | { kind: 'memberId'; term: string }
  | { kind: 'name'; term: string };

/**
 * Infer which field to search from what was typed (UI hint states the rule):
 * all digits => mobile prefix; starts with "gym" => Member ID prefix (upper-cased); otherwise a name prefix.
 */
export function inferSearch(input: string): SearchQuery {
  const raw = input.trim();
  if (raw === '') return { kind: 'none' };
  if (/^gym/i.test(raw)) return { kind: 'memberId', term: raw.replace(/\s+/g, '').toUpperCase() };
  if (/^\+?[\d\s-]+$/.test(raw)) {
    let digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+91')) digits = digits.slice(2);
    return digits === '' ? { kind: 'none' } : { kind: 'mobile', term: digits };
  }
  const term = normalizeText(raw);
  return term === '' ? { kind: 'none' } : { kind: 'name', term };
}

/** Highest code point in the BMP private-use range: the standard Firestore prefix-range upper bound. */
export const PREFIX_END = '';

/** `[term, term + PREFIX_END]`: `where(f, '>=', lo)` and `where(f, '<=', hi)` match every value starting with `term`. */
export function prefixRange(term: string): { lo: string; hi: string } {
  return { lo: term, hi: term + PREFIX_END };
}

/** True when a stored `searchFullName` starts with the (already normalized) term. */
export function fullNameHasPrefix(searchFullName: string, term: string): boolean {
  return searchFullName.startsWith(term);
}
