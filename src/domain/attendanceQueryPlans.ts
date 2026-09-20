import { type TodayAttendanceFilter } from '../types/attendance';
import { type QueryPlan } from './queryPredicates';

/**
 * Every attendance query the app issues, as backend-neutral plans (architecture §5.4, §5.6). The services turn a plan into
 * Firestore constraints (services/queryBuilder.ts) and `tests/unit/indexes.test.ts` checks the SAME plans against
 * `firestore.indexes.json`, so a query cannot ship without its composite index (US-8.3b). `date` is the attendance day (a
 * Date at 00:00 IST, converted to a Timestamp by the builder).
 */

export const ATTENDANCE = 'attendance';
export const ATTENDANCE_PAGE_SIZE = 25;

/**
 * Today's list. ALL = every record of the day, newest check-in first (marked-absent rows, which have no check-in time, sort
 * last). CHECKED_IN = the members still in (`status == PRESENT`, `checkedOut == false`), the SAME predicate as the
 * dashboard's "Currently checked in" card. ABSENT = the explicit absent marks (equality only, so no composite index).
 * Indexes: (date, checkInAt desc) and (date, status, checkedOut, checkInAt desc).
 */
export function todayListPlan(filter: TodayAttendanceFilter, today: Date): QueryPlan {
  switch (filter) {
    case 'ALL':
      return { collection: ATTENDANCE, equals: [{ field: 'date', value: today }], orderBy: [{ field: 'checkInAt', direction: 'desc' }] };
    case 'CHECKED_IN':
      return {
        collection: ATTENDANCE,
        equals: [{ field: 'date', value: today }, { field: 'status', value: 'PRESENT' }, { field: 'checkedOut', value: false }],
        orderBy: [{ field: 'checkInAt', direction: 'desc' }],
      };
    case 'ABSENT':
      return { collection: ATTENDANCE, equals: [{ field: 'date', value: today }, { field: 'status', value: 'ABSENT' }], orderBy: [] };
  }
}

/** One member's history, newest day first. Index: (memberDocId, date desc). */
export function memberHistoryPlan(memberDocId: string): QueryPlan {
  return { collection: ATTENDANCE, equals: [{ field: 'memberDocId', value: memberDocId }], orderBy: [{ field: 'date', direction: 'desc' }] };
}

/** PRESENT records of one IST day: the dashboard's "Today's attendance" and one row of the monthly report (a count). */
export function dayPresentPlan(day: Date): QueryPlan {
  return { collection: ATTENDANCE, equals: [{ field: 'date', value: day }, { field: 'status', value: 'PRESENT' }], orderBy: [] };
}

/** Today's PRESENT records with no check-out: the dashboard's "Currently checked in" (a count of members, one record each). */
export function currentlyCheckedInPlan(today: Date): QueryPlan {
  return {
    collection: ATTENDANCE,
    equals: [{ field: 'date', value: today }, { field: 'status', value: 'PRESENT' }, { field: 'checkedOut', value: false }],
    orderBy: [],
  };
}

/** PRESENT records dated in [start, endInclusive] (one IST month): a chart bar. Index: (status, date). */
export function presentRangePlan(start: Date, endInclusive: Date): QueryPlan {
  return {
    collection: ATTENDANCE,
    equals: [{ field: 'status', value: 'PRESENT' }],
    range: { field: 'date', lo: start, hi: endInclusive },
    orderBy: [],
  };
}

/** One member's PRESENT days in [start, endInclusive]: the monthly report's per-member figure. Index: (memberDocId, status, date). */
export function memberPresentRangePlan(memberDocId: string, start: Date, endInclusive: Date): QueryPlan {
  return {
    collection: ATTENDANCE,
    equals: [{ field: 'memberDocId', value: memberDocId }, { field: 'status', value: 'PRESENT' }],
    range: { field: 'date', lo: start, hi: endInclusive },
    orderBy: [],
  };
}
