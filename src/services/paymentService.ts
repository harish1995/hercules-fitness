import { db } from '../firebase/app';
import { type Clock } from '../domain/dates';
import { type Actor, type Member, type Page, type PageCursor } from '../types/member';
import { type Membership } from '../types/membership';
import { type Payment, type PaymentDashboardStats, type PaymentDetails, type PaymentListFilter, type RecordedPayment, type VoidedPayment } from '../types/payment';
import {
  getPaymentDashboardStatsFor,
  getPendingTotals,
  listMemberPaymentsPageFor,
  listPaymentsPageFor,
  listPendingMembersPageFor,
  listUnpaidMembershipsFor,
} from './paymentQueries';
import { newPaymentDocId, recordPaymentTx, voidPaymentTx } from './paymentTransactions';

/** App-facing payment API (record / void / lists / dashboard figures), bound to the app's Firestore instance. */

export const generatePaymentDocId = (): string => newPaymentDocId(db);

export const recordPayment = (params: {
  paymentDocId: string;
  memberDocId: string;
  membershipId: string;
  details: PaymentDetails;
  actor: Actor;
  clock?: Clock;
}): Promise<RecordedPayment> => recordPaymentTx({ db, ...params });

export const voidPayment = (params: { paymentId: string; reason: string; actor: Actor }): Promise<VoidedPayment> =>
  voidPaymentTx({ db, ...params });

export const listPayments = (filter: PaymentListFilter, cursor: PageCursor | null = null): Promise<Page<Payment>> =>
  listPaymentsPageFor(db, filter, cursor);

export const listMemberPayments = (memberDocId: string, cursor: PageCursor | null = null): Promise<Page<Payment>> =>
  listMemberPaymentsPageFor(db, memberDocId, cursor);

export const listUnpaidMemberships = (memberDocId: string): Promise<Membership[]> => listUnpaidMembershipsFor(db, memberDocId);

export const listPendingMembers = (cursor: PageCursor | null = null): Promise<Page<Member>> => listPendingMembersPageFor(db, cursor);

export const getPaymentDashboardStats = (clock?: Clock): Promise<PaymentDashboardStats> => getPaymentDashboardStatsFor(db, clock);

export const getPendingPaymentTotals = (): Promise<PaymentDashboardStats['pending']> => getPendingTotals(db);
