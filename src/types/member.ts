import { type Gender } from '../constants/enums';
import { type MembershipChoice, type MembershipSummary } from './membership';

/**
 * Domain member types. Firebase-free (enforced by ESLint): Firestore Timestamps are converted to
 * `Date` in the service layer. Calendar days (dateOfBirth, joiningDate) are Dates at 00:00 IST.
 */

export interface EmergencyContact {
  name: string;
  mobile: string;
}

export interface ConsentRecord {
  given: true;
  at: Date;
  byUid: string;
  byName: string;
  version: string;
  guardianConsent: boolean;
}

/** members/{memberDocId} as the UI sees it. There is deliberately no `status` field (FR-4) and no medical notes (§2.4). */
export interface Member {
  /** Firestore document id (opaque; used in URLs). */
  id: string;
  /** Human-readable `GYM-2026-0001`. */
  memberId: string;
  memberIdYear: number;
  firstName: string;
  lastName: string;
  displayName: string;
  gender: Gender;
  dateOfBirth: Date;
  mobile: string;
  email: string | null;
  address: string | null;
  emergencyContact: EmergencyContact | null;
  trainerId: string | null;
  trainerName: string | null;
  joiningDate: Date;
  generalNotes: string | null;
  hasPhoto: boolean;
  suspended: boolean;
  suspendedAt: Date | null;
  /** Free text, optional. Visible to Staff: it must not carry health details (the UI says so). Never copied to the audit log. */
  suspendedReason: string | null;
  deleted: boolean;
  hasMembership: boolean;
  /** The LATEST membership (D-5). Status is derived from `membership.endDate` + `suspended`, never stored (FR-4). */
  membership: MembershipSummary;
  /** Integer paise: the sum of outstanding amounts across the member's memberships (D-7). */
  pendingPaise: number;
  consent: ConsentRecord;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
  /**
   * Optimistic-concurrency token: the exact Firestore `updatedAt` (seconds.nanoseconds) the record was
   * loaded with. An edit is refused when the stored value no longer matches (US-2.10d).
   */
  version: string;
}

/** The validated, normalized profile data of a member (create and edit share it). */
export interface MemberProfileInput {
  firstName: string;
  lastName: string;
  gender: Gender;
  dateOfBirth: Date;
  /** normalized: 10 digits starting 6-9 */
  mobile: string;
  email: string | null;
  address: string | null;
  emergencyContact: EmergencyContact | null;
  trainerId: string | null;
  joiningDate: Date;
  generalNotes: string | null;
}

export interface RegisterMemberInput {
  profile: MemberProfileInput;
  /** Admin only. null/'' = none. */
  medicalNotes: string | null;
  /** true when the (guardian) consent box was ticked; the guardian flag is computed from the DOB. */
  consentGiven: boolean;
  guardianConsent: boolean;
  /** Admin only: create the first membership atomically with the member (US-3.5b). Absent = no membership yet. */
  membership?: MembershipChoice;
}

export interface UpdateMemberInput {
  profile: MemberProfileInput;
  /** undefined = not editable by this user (leave untouched); null = clear. */
  medicalNotes?: string | null;
}

export interface Actor {
  uid: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
}

export interface DuplicateMemberInfo {
  memberDocId: string;
  memberId: string;
  displayName: string;
  /** true for a soft-deleted member: named in the warning but never a reason to stop (US-2.3c). */
  deleted: boolean;
}

export interface MemberPhoto {
  dataUrl: string;
  contentType: 'image/webp' | 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
}

export interface MemberMedical {
  notes: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Trainer {
  id: string;
  name: string;
  mobile: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TrainerInput {
  name: string;
  mobile: string | null;
  active: boolean;
}

// ---- list / paging -------------------------------------------------------------------------

/** Opaque cursor returned by the service. Callers only hand it back. */
export interface PageCursor {
  readonly __opaque: 'PageCursor';
}

export interface Page<T> {
  items: T[];
  /** Cursor to fetch the following page, or null when this is the last one. */
  next: PageCursor | null;
}

/**
 * Status filter of the members list (architecture §5.1). ACTIVE / EXPIRING_SOON / EXPIRED are date ranges on the latest
 * end date (never suspended); SUSPENDED and NO_MEMBERSHIP are flag predicates.
 */
export type MemberListStatus = 'ALL' | 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED' | 'SUSPENDED' | 'NO_MEMBERSHIP';

/** REGISTERED = createdAt desc (default). The expiry sorts exist only together with a date filter (architecture §5.3). */
export type MemberListSort = 'REGISTERED' | 'EXPIRY_ASC' | 'EXPIRY_DESC';

export type MemberListQuery =
  | {
      mode: 'browse';
      status: MemberListStatus;
      /** members whose LATEST membership is on this plan */
      planId: string | null;
      /** inclusive IST days (00:00 IST), intersected with the status range */
      expiryFrom: Date | null;
      expiryTo: Date | null;
      sort: MemberListSort;
      /** 00:00 IST today: the anchor of the status ranges (part of the key, so a page left open past midnight refreshes). */
      today: Date;
    }
  | { mode: 'search'; kind: 'name' | 'mobile' | 'memberId'; term: string };

export interface StatusCounts {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  suspended: number;
  noMembership: number;
}

export interface PlanDistributionEntry {
  planId: string;
  planName: string;
  count: number;
}

export interface DashboardStats {
  totalMembers: number;
  newMembersByMonth: { year: number; month: number; label: string; count: number }[];
  statusCounts: StatusCounts;
  planDistribution: PlanDistributionEntry[];
  /** the next (up to) 10 non-suspended members whose membership ends within 0-7 days, soonest first */
  nextExpiring: Member[];
}
