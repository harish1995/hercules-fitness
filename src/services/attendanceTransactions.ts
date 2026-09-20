import { doc, runTransaction, serverTimestamp, Timestamp, type Firestore } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { attendanceDocId, describeCheckIn, evaluateCheckIn } from '../domain/attendance';
import { formatIstTime, istDayKey, istDayStart, systemClock, type Clock } from '../domain/dates';
import { type CheckInResult, type MarkAbsentResult } from '../types/attendance';
import { type Actor } from '../types/member';
import { AppError, AttendanceRefusalError, getErrorCode } from './errors';
import { attendanceFromDoc, memberFromDoc } from './firestoreConverters';
import { MAX_ATTEMPTS, serializeTxError } from './txHelpers';

/**
 * Attendance write transactions (architecture §2.7 TX-9):
 *
 *   checkInTx     a PRESENT record for today (or ABSENT -> PRESENT when the member arrives after being marked absent, US-5.3b)
 *   checkOutTx    the check-out of today's open PRESENT record
 *   markAbsentTx  an explicit ABSENT record for today
 *
 * One record per member per IST day is STRUCTURAL: the document id is `{memberDocId}_{YYYYMMDD}`, so two staff clicking at
 * once address the same document; the loser re-reads it inside the transaction and is refused ("already checked in at HH:MM")
 * and the security rules refuse a second `create` / an illegal update in any case. The IST day is taken from the injected clock
 * for the id, and the rules recompute it from the SERVER time (`request.time`), so a check-in at 00:10 IST belongs to the new
 * IST day and a device in another time zone cannot change that. Check-in and check-out times are `serverTimestamp()` values the
 * rules compare with `request.time` (no device-clock times are ever stored).
 *
 * NEW-12 is enforced here from the member document read INSIDE the transaction (never from what a dialog showed): SUSPENDED is
 * refused (and by the rules), EXPIRED / NO_MEMBERSHIP need `confirmed`. No audit record is written: the requirements' audit list
 * (FR-13) does not include attendance. Nothing here logs; errors carry no member data.
 */

const notFound = () => new AttendanceRefusalError('MEMBER_NOT_FOUND', 'Member not found.');

/**
 * A denied attendance commit is almost always one of: the day changed between the click and the commit (the rules take the day
 * from the server clock), the member was suspended / deleted meanwhile, or this device's clock is far off. Say so.
 */
function explainDenied(error: unknown, dayKeyAtStart: string, clock: Clock, what: string): unknown {
  if (getErrorCode(error) !== 'permission-denied') return error;
  const dayChanged = istDayKey(clock()) !== dayKeyAtStart;
  return new AppError('PERMISSION_DENIED', {
    cause: error,
    userMessage: dayChanged
      ? `The date changed while ${what}. Reload the page and try again.`
      : `The ${what === 'checking in' ? 'check-in' : what === 'checking out' ? 'check-out' : 'absent mark'} was refused. The member may have been suspended or deleted, or this device's clock is wrong. Reload and try again.`,
  });
}

export interface CheckInParams {
  db: Firestore;
  memberDocId: string;
  actor: Actor;
  /** true when the user explicitly confirmed a warning (an EXPIRED / no-membership member, NEW-12) */
  confirmed?: boolean;
  clock?: Clock;
}

/** Check a member in for today. Throws AttendanceRefusalError for a business refusal, AppError for anything else. */
export async function checkInTx(params: CheckInParams): Promise<CheckInResult> {
  const { db, memberDocId, actor, confirmed = false, clock = systemClock } = params;
  const now = clock();
  const dayKey = istDayKey(now);
  const ref = doc(db, COLLECTIONS.attendance, attendanceDocId(memberDocId, now));
  const memberRef = doc(db, COLLECTIONS.members, memberDocId);

  try {
    return await runTransaction(
      db,
      async (tx): Promise<CheckInResult> => {
        // ---- READS (all before any write) ----
        const attendanceSnap = await tx.get(ref);
        let memberData: Record<string, unknown> | undefined;
        try {
          const memberSnap = await tx.get(memberRef);
          memberData = memberSnap.exists() ? memberSnap.data() : undefined;
        } catch (e) {
          // Staff cannot read a soft-deleted member (rules): to them it does not exist (US-5.1d)
          if (getErrorCode(e) === 'permission-denied') throw notFound();
          throw e;
        }
        if (!memberData || memberData.deleted === true) throw notFound();
        const member = memberFromDoc(memberDocId, memberData);

        // ---- NEW-12, evaluated on the FRESH member data ----
        const evaluation = evaluateCheckIn(member, clock);
        if (evaluation.action === 'BLOCK') throw new AttendanceRefusalError('SUSPENDED', evaluation.message ?? 'This member cannot be checked in.');
        if (evaluation.action === 'CONFIRM' && !confirmed) {
          throw new AttendanceRefusalError('NEEDS_CONFIRMATION', `${evaluation.message ?? 'This membership is not valid.'} Confirm to check in anyway.`);
        }

        const result = (fromAbsent: boolean): CheckInResult => ({
          attendanceId: ref.id,
          memberName: member.displayName,
          membershipStatus: evaluation.status,
          daysRemaining: evaluation.daysRemaining,
          fromAbsent,
        });

        if (attendanceSnap.exists()) {
          const existing = attendanceFromDoc(attendanceSnap.id, attendanceSnap.data() ?? {});
          if (existing.status === 'PRESENT') {
            throw new AttendanceRefusalError('ALREADY_CHECKED_IN', `${member.displayName} is already checked in today ${describeCheckIn(existing)}.`);
          }
          // ABSENT -> PRESENT: still one record for the day (US-5.3b)
          tx.update(ref, { status: 'PRESENT', checkInAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: actor.uid });
          return result(true);
        }

        // ---- WRITE (a new record: the rules also verify the id, the day, the snapshot and the server times) ----
        tx.set(ref, {
          memberDocId,
          memberId: member.memberId,
          memberName: member.displayName,
          date: Timestamp.fromDate(istDayStart(now)),
          dateKey: dayKey,
          status: 'PRESENT',
          checkInAt: serverTimestamp(),
          checkOutAt: null,
          checkedOut: false,
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
        return result(false);
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw serializeTxError(explainDenied(e, dayKey, clock, 'checking in'));
  }
}

export interface CheckOutParams {
  db: Firestore;
  memberDocId: string;
  actor: Actor;
  clock?: Clock;
}

/**
 * Check a member out. Only TODAY's record is addressed (the id carries the day), so a member who forgot to check out yesterday
 * has no check-out button today and that record keeps a blank check-out (NEW-13, US-5.2c); the rules refuse it as well.
 */
export async function checkOutTx(params: CheckOutParams): Promise<{ attendanceId: string; memberName: string }> {
  const { db, memberDocId, actor, clock = systemClock } = params;
  const now = clock();
  const dayKey = istDayKey(now);
  const ref = doc(db, COLLECTIONS.attendance, attendanceDocId(memberDocId, now));
  try {
    return await runTransaction(
      db,
      async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new AttendanceRefusalError('NO_CHECK_IN', 'This member has no check-in today.');
        const record = attendanceFromDoc(snap.id, snap.data() ?? {});
        if (record.status !== 'PRESENT' || record.checkInAt === null) {
          throw new AttendanceRefusalError('NO_CHECK_IN', `${record.memberName} was marked absent today and has not been checked in.`);
        }
        if (record.checkedOut) {
          throw new AttendanceRefusalError(
            'ALREADY_CHECKED_OUT',
            `${record.memberName} was already checked out${record.checkOutAt ? ` at ${formatIstTime(record.checkOutAt)}` : ''}.`,
          );
        }
        // the rules require the server time to be AFTER the check-in time (US-5.2a)
        tx.update(ref, { checkOutAt: serverTimestamp(), checkedOut: true, updatedAt: serverTimestamp(), updatedBy: actor.uid });
        return { attendanceId: ref.id, memberName: record.memberName };
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw serializeTxError(explainDenied(e, dayKey, clock, 'checking out'));
  }
}

export interface MarkAbsentParams {
  db: Firestore;
  memberDocId: string;
  actor: Actor;
  clock?: Clock;
}

/** Mark a member ABSENT for today (Admin and Staff, matrix). Refused when the member already has a record today. */
export async function markAbsentTx(params: MarkAbsentParams): Promise<MarkAbsentResult> {
  const { db, memberDocId, actor, clock = systemClock } = params;
  const now = clock();
  const dayKey = istDayKey(now);
  const ref = doc(db, COLLECTIONS.attendance, attendanceDocId(memberDocId, now));
  const memberRef = doc(db, COLLECTIONS.members, memberDocId);
  try {
    return await runTransaction(
      db,
      async (tx): Promise<MarkAbsentResult> => {
        const attendanceSnap = await tx.get(ref);
        let memberData: Record<string, unknown> | undefined;
        try {
          const memberSnap = await tx.get(memberRef);
          memberData = memberSnap.exists() ? memberSnap.data() : undefined;
        } catch (e) {
          if (getErrorCode(e) === 'permission-denied') throw notFound();
          throw e;
        }
        if (!memberData || memberData.deleted === true) throw notFound();
        const member = memberFromDoc(memberDocId, memberData);
        if (attendanceSnap.exists()) {
          const existing = attendanceFromDoc(attendanceSnap.id, attendanceSnap.data() ?? {});
          throw new AttendanceRefusalError(
            'ALREADY_RECORDED',
            existing.status === 'PRESENT'
              ? `${member.displayName} is already checked in today ${describeCheckIn(existing)}, so they cannot be marked absent.`
              : `${member.displayName} is already marked absent today.`,
          );
        }
        tx.set(ref, {
          memberDocId,
          memberId: member.memberId,
          memberName: member.displayName,
          date: Timestamp.fromDate(istDayStart(now)),
          dateKey: dayKey,
          status: 'ABSENT',
          checkInAt: null,
          checkOutAt: null,
          checkedOut: false,
          createdAt: serverTimestamp(),
          createdBy: actor.uid,
          updatedAt: serverTimestamp(),
          updatedBy: actor.uid,
        });
        return { attendanceId: ref.id, memberName: member.displayName };
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw serializeTxError(explainDenied(e, dayKey, clock, 'marking absent'));
  }
}
