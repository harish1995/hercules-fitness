import { type DurationUnit } from '../constants/enums';
import { type PaymentDetails } from './payment';

/**
 * Plan and membership types (architecture §2.2). Firebase-free: Timestamps are converted to `Date` in the services.
 * Calendar days (startDate, endDate) are Dates at 00:00 IST. Money is integer paise.
 */

/** membershipPlans/{planId} */
export interface Plan {
  id: string;
  name: string;
  durationValue: number;
  durationUnit: DurationUnit;
  /** Integer paise, > 0. */
  pricePaise: number;
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanInput {
  name: string;
  durationValue: number;
  durationUnit: DurationUnit;
  pricePaise: number;
  description: string | null;
  active: boolean;
}

/** The denormalized summary on members/{id}.membership: the member's LATEST membership (D-5). All null when none. */
export interface MembershipSummary {
  membershipId: string | null;
  planId: string | null;
  /** Snapshot: survives plan deletion or renaming. */
  planName: string | null;
  startDate: Date | null;
  /** The LATEST end date across all the member's memberships. */
  endDate: Date | null;
  amountPaise: number | null;
}

/** memberships/{membershipId}: one period per assign / renew. Never edited (history). */
export interface Membership {
  id: string;
  memberDocId: string;
  memberId: string;
  memberDisplayName: string;
  planId: string;
  planName: string;
  planDurationValue: number;
  planDurationUnit: DurationUnit;
  startDate: Date;
  endDate: Date;
  amountPaise: number;
  paidPaise: number;
  outstandingPaise: number;
  unpaid: boolean;
  createdAt: Date;
  createdBy: string;
}

/** The plan + start chosen when a membership is created together with the member (US-3.5b). */
export interface MembershipChoice {
  planId: string;
  /** 00:00 IST of the chosen start day. */
  startDate: Date;
  /** Admin only: money received with the registration (Amount Paid > 0). Absent = the membership starts unpaid. */
  firstPayment?: PaymentDetails;
}

export interface AssignedMembership {
  membershipId: string;
  startDate: Date;
  endDate: Date;
  planName: string;
  amountPaise: number;
  /** what was paid together with the membership (0 = none): amount - paid is what the member owes for it */
  paidPaise: number;
  /** true when this membership id had already been created (double submit / retry after an unknown commit). */
  alreadyExisted: boolean;
}
