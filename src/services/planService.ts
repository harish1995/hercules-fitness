import { db } from '../firebase/app';
import { type Actor } from '../types/member';
import { type Plan, type PlanInput } from '../types/membership';
import { listPlansFor } from './planQueries';
import { createPlanTx, deletePlanTx, newPlanDocId, updatePlanTx } from './planTransactions';

/** App-facing plan API (binds the db-parameterised modules to the app's Firestore instance). */

export const listPlans = (): Promise<Plan[]> => listPlansFor(db);
export const generatePlanDocId = (): string => newPlanDocId(db);
export const createPlan = (params: { planDocId: string; input: PlanInput; actor: Actor }): Promise<void> =>
  createPlanTx({ db, ...params });
export const updatePlan = (params: { planId: string; input: PlanInput; actor: Actor }): Promise<string[]> =>
  updatePlanTx({ db, ...params });
export const deletePlan = (params: { planId: string; actor: Actor }): Promise<void> => deletePlanTx({ db, ...params });
