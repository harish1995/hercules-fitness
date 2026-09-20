import { DateTime } from 'luxon';

/**
 * Date utilities (architecture §6.2, D-1).
 *
 * Representation rule: a value that denotes a CALENDAR DAY (joining date, date of birth, ...) is a
 * `Date` pinned to 00:00:00.000 Asia/Kolkata of that IST day. A value that denotes an INSTANT
 * (createdAt, consent time, ...) is a plain `Date`. This module is Firebase-free: the service layer
 * converts these `Date`s to Firestore `Timestamp`s at the boundary (`Timestamp.fromDate`).
 *
 * Nothing here reads the device time zone, so results are identical whether the device is set to
 * IST, UTC or America/Los_Angeles. "Now" comes from an injectable clock so tests are deterministic.
 */
export const IST_ZONE = 'Asia/Kolkata';

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

export interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

function ist(d: Date): DateTime {
  return DateTime.fromJSDate(d, { zone: IST_ZONE }).setLocale('en-US');
}

/** The current instant expressed in IST. */
export function nowIst(clock: Clock = systemClock): DateTime {
  return ist(clock());
}

/** 00:00 IST of the IST day containing `d`. */
export function istDayStart(d: Date): Date {
  return ist(d).startOf('day').toJSDate();
}

/** 00:00 IST today. */
export function todayIstStart(clock: Clock = systemClock): Date {
  return istDayStart(clock());
}

/** The IST calendar date (year, month, day) of an instant. */
export function toCivilDate(d: Date): CivilDate {
  const t = ist(d);
  return { year: t.year, month: t.month, day: t.day };
}

/**
 * A calendar Y/M/D -> 00:00 IST of that day. Throws RangeError for an impossible date (e.g. 31 Feb).
 * Date pickers must be converted through this (never store a browser-local Date directly).
 */
export function fromCivilDate(year: number, month: number, day: number): Date {
  const t = DateTime.fromObject({ year, month, day }, { zone: IST_ZONE });
  if (!t.isValid) throw new RangeError(`Invalid calendar date ${year}-${month}-${day}`);
  return t.startOf('day').toJSDate();
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse an `<input type="date">` value (`YYYY-MM-DD`) into 00:00 IST of that day, or null when it is
 * not a real calendar date (or the year is before 1900). Only the Y/M/D the user saw is used.
 */
export function parseDayInput(value: string): Date | null {
  const m = ISO_DAY.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1900) return null;
  try {
    return fromCivilDate(year, month, day);
  } catch {
    return null;
  }
}

/** Inverse of parseDayInput: the `YYYY-MM-DD` string of the IST day containing `d`. */
export function toDayInputValue(d: Date): string {
  return ist(d).toFormat('yyyy-MM-dd');
}

/** `DD/MM/YYYY` (NFR-5). */
export function formatIstDate(d: Date): string {
  return ist(d).toFormat('dd/MM/yyyy');
}

/** `DD/MM/YYYY HH:mm` (24 h, IST). */
export function formatIstDateTime(d: Date): string {
  return ist(d).toFormat('dd/MM/yyyy HH:mm');
}

/** `HH:mm` (24 h, IST): a check-in / check-out time of day. */
export function formatIstTime(d: Date): string {
  return ist(d).toFormat('HH:mm');
}

/** `YYYYMMDD` of the IST day: the day part of an attendance document id (`{memberDocId}_{YYYYMMDD}`). */
export function istDayKey(d: Date): string {
  return ist(d).toFormat('yyyyMMdd');
}

/** The IST year at `clock` (member-ID year, US-2.2c). NOT the device year. */
export function istYear(clock: Clock = systemClock): number {
  return nowIst(clock).year;
}

/** Whole IST calendar days from `from` to `to` (negative when `to` is earlier). Ignores time of day. */
export function diffIstDays(from: Date, to: Date): number {
  const a = ist(from).startOf('day');
  const b = ist(to).startOf('day');
  return Math.round(b.diff(a, 'days').days);
}

/** 00:00 IST `n` calendar days after the IST day of `d` (n may be negative). */
export function addIstDays(d: Date, n: number): Date {
  return ist(d).startOf('day').plus({ days: n }).startOf('day').toJSDate();
}

/**
 * 00:00 IST `n` calendar months after the IST day of `d`. Month-end days are CLAMPED (31 Jan + 1 month = 28 Feb), which
 * is what the renewal rule needs (FR-5, NEW-6). n may be negative.
 */
export function addIstMonths(d: Date, n: number): Date {
  return ist(d).startOf('day').plus({ months: n }).startOf('day').toJSDate();
}

/** [start, endExclusive) of an IST calendar month, both at 00:00 IST. `month` is 1-12. */
export function istMonthRange(year: number, month: number): { start: Date; endExclusive: Date } {
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: IST_ZONE });
  if (!start.isValid) throw new RangeError(`Invalid month ${year}-${month}`);
  return { start: start.toJSDate(), endExclusive: start.plus({ months: 1 }).startOf('month').toJSDate() };
}

// Fixed English abbreviations: ICU/CLDR versions disagree on e.g. "Sep" vs "Sept", and a chart label must not vary by runtime.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export interface IstMonth {
  year: number;
  month: number;
  /** e.g. `Sep 2026` */
  label: string;
}

/** The last `count` IST months ending with the current one, oldest first. */
export function lastIstMonths(count: number, clock: Clock = systemClock): IstMonth[] {
  const current = nowIst(clock).startOf('month');
  const months: IstMonth[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = current.minus({ months: i });
    months.push({ year: t.year, month: t.month, label: `${MONTH_ABBR[t.month - 1]} ${t.year}` });
  }
  return months;
}

/** Completed years between `dateOfBirth` and `today`, counted on IST calendar dates. */
export function ageOnIstDate(dateOfBirth: Date, today: Date): number {
  const dob = toCivilDate(dateOfBirth);
  const now = toCivilDate(today);
  let age = now.year - dob.year;
  if (now.month < dob.month || (now.month === dob.month && now.day < dob.day)) age -= 1;
  return age;
}

/** Under 18 on the IST date of `clock` (US-2.7a/c). Computed, never stored. */
export function isUnder18(dateOfBirth: Date, clock: Clock = systemClock): boolean {
  return ageOnIstDate(dateOfBirth, clock()) < 18;
}
