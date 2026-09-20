import { collection, doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';
import { COLLECTIONS } from '../constants/collections';
import { planDurationError, planPriceError } from '../domain/plan';
import { normalizeText } from '../domain/search';
import { type Actor } from '../types/member';
import { type Plan, type PlanInput } from '../types/membership';
import { auditDocData } from './auditService';
import { AppError } from './errors';
import { planFromDoc } from './firestoreConverters';
import { countMembershipsOfPlan, planNameTaken } from './planQueries';
import { MAX_ATTEMPTS, serializeTxError } from './txHelpers';

/**
 * TX-10 plan create / update / delete. Each is ONE transaction with its audit record (US-3.14 spirit; PLAN_* actions).
 * Editing a plan never touches memberships: they snapshot the name, duration and price (US-3.1c). Plans are Admin-only
 * (rules). "Delete only when safe" is a client-side count of referencing memberships (rules cannot query); the residual
 * create-during-delete race is benign because memberships carry their own snapshot (architecture §3.3).
 */

function assertValid(input: PlanInput): void {
  const bad = planDurationError(input.durationValue, input.durationUnit) ?? planPriceError(input.pricePaise);
  if (bad) throw new AppError('INVALID_DATA', { userMessage: bad });
  if (input.name.trim() === '') throw new AppError('INVALID_DATA', { userMessage: 'Plan name is required.' });
}

const duplicateName = () => new AppError('DUPLICATE', { userMessage: 'A plan with this name already exists.' });

function planBody(input: PlanInput, actor: Actor) {
  return {
    name: input.name,
    nameLower: normalizeText(input.name),
    durationValue: input.durationValue,
    durationUnit: input.durationUnit,
    pricePaise: input.pricePaise,
    description: input.description,
    active: input.active,
    updatedAt: serverTimestamp(),
    updatedBy: actor.uid,
  };
}

/** Pre-generate the id so a retried submit targets the same document. */
export function newPlanDocId(db: Firestore): string {
  return doc(collection(db, COLLECTIONS.membershipPlans)).id;
}

export async function createPlanTx(params: { db: Firestore; planDocId: string; input: PlanInput; actor: Actor }): Promise<void> {
  const { db, planDocId, input, actor } = params;
  assertValid(input);
  if (await planNameTaken(db, input.name)) throw duplicateName();
  const planRef = doc(db, COLLECTIONS.membershipPlans, planDocId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));
  try {
    await runTransaction(
      db,
      async (tx) => {
        if ((await tx.get(planRef)).exists()) return; // a retried submit that already committed
        tx.set(planRef, { ...planBody(input, actor), createdAt: serverTimestamp(), createdBy: actor.uid });
        tx.set(
          auditRef,
          auditDocData(actor, {
            action: 'PLAN_CREATED',
            entity: 'plan',
            entityId: planDocId,
            entityLabel: input.name,
            metadata: { durationValue: input.durationValue, durationUnit: input.durationUnit, pricePaise: input.pricePaise },
          }),
        );
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}

const CHANGE_FIELDS = ['name', 'durationValue', 'durationUnit', 'pricePaise', 'description', 'active'] as const;

/** Names of the plan fields that differ (audit metadata lists NAMES only, like member edits). */
export function changedPlanFields(before: Plan, after: PlanInput): string[] {
  return CHANGE_FIELDS.filter((f) => before[f] !== after[f]);
}

/** Update fields and/or activate / deactivate (the `active` flag is just another field). Returns the changed field names. */
export async function updatePlanTx(params: { db: Firestore; planId: string; input: PlanInput; actor: Actor }): Promise<string[]> {
  const { db, planId, input, actor } = params;
  assertValid(input);
  if (await planNameTaken(db, input.name, planId)) throw duplicateName();
  const planRef = doc(db, COLLECTIONS.membershipPlans, planId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));
  try {
    return await runTransaction(
      db,
      async (tx) => {
        const snap = await tx.get(planRef);
        const data = snap.data();
        if (!snap.exists() || !data) throw new AppError('NOT_FOUND', { userMessage: 'This plan no longer exists.' });
        const before = planFromDoc(snap.id, data);
        const changed = changedPlanFields(before, input);
        if (changed.length === 0) return [];
        tx.update(planRef, planBody(input, actor));
        tx.set(
          auditRef,
          auditDocData(actor, {
            action: 'PLAN_UPDATED',
            entity: 'plan',
            entityId: planId,
            entityLabel: input.name,
            metadata: { changedFields: changed.join(',') },
          }),
        );
        return changed;
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}

/** Delete only when NO membership (of any member, incl. soft-deleted ones) references the plan (US-3.3b). */
export async function deletePlanTx(params: { db: Firestore; planId: string; actor: Actor }): Promise<void> {
  const { db, planId, actor } = params;
  if ((await countMembershipsOfPlan(db, planId)) > 0) {
    throw new AppError('INVALID_DATA', {
      userMessage: 'This plan is used by memberships and cannot be deleted. Deactivate it instead.',
    });
  }
  const planRef = doc(db, COLLECTIONS.membershipPlans, planId);
  const auditRef = doc(collection(db, COLLECTIONS.auditLogs));
  try {
    await runTransaction(
      db,
      async (tx) => {
        const snap = await tx.get(planRef);
        const data = snap.data();
        if (!snap.exists() || !data) return; // already gone
        tx.delete(planRef);
        tx.set(
          auditRef,
          auditDocData(actor, {
            action: 'PLAN_DELETED',
            entity: 'plan',
            entityId: planId,
            entityLabel: planFromDoc(snap.id, data).name,
            metadata: {},
          }),
        );
      },
      { maxAttempts: MAX_ATTEMPTS },
    );
  } catch (e) {
    throw serializeTxError(e);
  }
}
