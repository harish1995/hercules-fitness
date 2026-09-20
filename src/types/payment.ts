import { type PaymentMethod } from '../constants/enums';

/**
 * Payment types (architecture §2.2). Firebase-free: Timestamps are converted to `Date` in the services. `paymentDate` is a
 * calendar day (00:00 IST). Money is integer paise. A payment is immutable except for the one-way void (NEW-9).
 */

/** payments/{paymentId} as the UI sees it. */
export interface Payment {
  id: string;
  memberDocId: string;
  /** readable `GYM-2026-0001` (snapshot) */
  memberId: string;
  /** snapshot */
  memberDisplayName: string;
  membershipId: string;
  /** Integer paise, > 0. */
  amountPaise: number;
  /** 00:00 IST of the day the money was received. */
  paymentDate: Date;
  method: PaymentMethod;
  transactionReference: string | null;
  notes: string | null;
  voided: boolean;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedBy: string | null;
  createdAt: Date;
  createdBy: string;
  createdByName: string;
}

/** What the Admin enters for one payment (the validated, typed form of the payment fields). */
export interface PaymentDetails {
  /** Integer paise, > 0. */
  amountPaise: number;
  /** 00:00 IST of the chosen day; never in the future (NEW-5). */
  paymentDate: Date;
  method: PaymentMethod;
  transactionReference: string | null;
  notes: string | null;
}

export interface RecordedPayment {
  paymentId: string;
  membershipId: string;
  amountPaise: number;
  /** what the membership still owes after this payment */
  outstandingPaise: number;
  /** what the member still owes across all memberships after this payment */
  memberPendingPaise: number;
  /** true when this payment id had already been recorded (double submit / retry after an unknown commit). */
  alreadyExisted: boolean;
}

export interface VoidedPayment {
  paymentId: string;
  amountPaise: number;
  /** false when a retry / another admin had already voided it */
  changed: boolean;
}

/** Payments list filters (architecture §5.6): an inclusive IST day range, a method, and active vs voided rows. */
export interface PaymentListFilter {
  from: Date | null;
  to: Date | null;
  method: PaymentMethod | null;
  /** false = normal payments (default); true = only voided ones */
  voided: boolean;
}

export interface MonthlyRevenue {
  year: number;
  month: number;
  label: string;
  /** Sum of non-voided payments dated in that IST month, integer paise. */
  totalPaise: number;
}

/** Dashboard money figures (US-4.5c, US-4.6): pending totals and revenue, all from aggregation queries. */
export interface PaymentDashboardStats {
  pending: { totalPaise: number; memberCount: number };
  /** the last 12 IST months, oldest first; the LAST entry is the current month (cash basis) */
  revenueByMonth: MonthlyRevenue[];
  currentMonthPaise: number;
}
