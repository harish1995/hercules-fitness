import { AppError, getErrorCode, mapFirebaseError } from './errors';

/**
 * Shared helpers for the write transactions (architecture §8 `services/txHelpers.ts`). Firebase-free on purpose: they
 * only look at error CODES, so they are usable from every transaction module.
 */

/** Firestore retries a contended transaction on its own; this is the budget for the rules-level contention below. */
export const MAX_ATTEMPTS = 20;

/**
 * Some transactions contend on a document that a security rule ALSO reads (the member-ID counter, or a member's
 * membership summary / suspended flag). The rules evaluate a commit against the CURRENT database state, so when
 * another commit lands between this transaction's reads and its own commit, the stale write is refused as
 * `permission-denied` (not `aborted`). That is contention, not authorization: re-run the whole transaction (it
 * re-reads everything and then either succeeds or reports the real, now-visible reason). A genuine denial fails
 * identically every time, so the retry is bounded and then surfaces the real error.
 *
 * Used by: registerMemberTx (counter), assign / renew (member summary), suspend / reactivate (suspended flag).
 * NOT used by updateMemberTx: since the mobile lock was removed, a profile edit contends only on the member's own
 * document, guarded by its optimistic-concurrency version, and no rule reads another document that it can race on.
 */
const CONTENTION_RETRIES = 12;

export async function withContentionRetry<T>(op: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (e) {
      if (getErrorCode(e) !== 'permission-denied' || attempt >= CONTENTION_RETRIES) throw e;
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 40 * attempt));
    }
  }
}

/** Map a thrown transaction error to a user-safe AppError (contention that Firestore gave up on is not "changed by someone"). */
export function serializeTxError(error: unknown): AppError {
  const code = getErrorCode(error);
  if (code === 'aborted') {
    return new AppError('UNAVAILABLE', {
      cause: error,
      userMessage: 'The system is busy. Your entries are kept. Please try again.',
    });
  }
  return mapFirebaseError(error);
}
