import { Timestamp } from 'firebase/firestore';
import { isAttendanceStatus, isDurationUnit, isGender, isPaymentMethod, type Gender } from '../constants/enums';
import { type AttendanceRecord } from '../types/attendance';
import {
  type ConsentRecord,
  type EmergencyContact,
  type Member,
  type MemberMedical,
  type MemberPhoto,
  type Trainer,
} from '../types/member';
import { type Membership, type MembershipSummary, type Plan } from '../types/membership';
import { type Payment } from '../types/payment';

/** Firestore value -> Date (epoch 0 when absent or not a Timestamp: a malformed doc must not crash a list). */
export function toDate(value: unknown): Date {
  return value instanceof Timestamp ? value.toDate() : new Date(0);
}

export const toTimestamp = (d: Date): Timestamp => Timestamp.fromDate(d);

/** Exact `updatedAt` as `seconds.nanoseconds`: the optimistic-concurrency token (US-2.10d). */
export function versionOf(value: unknown): string {
  return value instanceof Timestamp ? `${value.seconds}.${value.nanoseconds}` : 'none';
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown): boolean => v === true;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dateOrNull = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null);

function summaryFrom(v: unknown): MembershipSummary {
  const s = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    membershipId: strOrNull(s.membershipId),
    planId: strOrNull(s.planId),
    planName: strOrNull(s.planName),
    startDate: dateOrNull(s.startDate),
    endDate: dateOrNull(s.endDate),
    amountPaise: numOrNull(s.amountPaise),
  };
}

function contactFrom(v: unknown): EmergencyContact | null {
  if (typeof v !== 'object' || v === null) return null;
  const c = v as Record<string, unknown>;
  return typeof c.name === 'string' && typeof c.mobile === 'string' ? { name: c.name, mobile: c.mobile } : null;
}

function consentFrom(v: unknown): ConsentRecord {
  const c = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return {
    given: true,
    at: toDate(c.at),
    byUid: str(c.byUid),
    byName: str(c.byName),
    version: str(c.version),
    guardianConsent: bool(c.guardianConsent),
  };
}

/** Lenient parse of a members/{id} document into the domain type (medical notes are never in this doc). */
export function memberFromDoc(id: string, data: Record<string, unknown>): Member {
  const gender: Gender = isGender(data.gender) ? data.gender : 'OTHER';
  return {
    id,
    memberId: str(data.memberId),
    memberIdYear: num(data.memberIdYear),
    firstName: str(data.firstName),
    lastName: str(data.lastName),
    displayName: str(data.displayName),
    gender,
    dateOfBirth: toDate(data.dateOfBirth),
    mobile: str(data.mobile),
    email: strOrNull(data.email),
    address: strOrNull(data.address),
    emergencyContact: contactFrom(data.emergencyContact),
    trainerId: strOrNull(data.trainerId),
    trainerName: strOrNull(data.trainerName),
    joiningDate: toDate(data.joiningDate),
    generalNotes: strOrNull(data.generalNotes),
    hasPhoto: bool(data.hasPhoto),
    suspended: bool(data.suspended),
    suspendedAt: dateOrNull(data.suspendedAt),
    suspendedReason: strOrNull(data.suspendedReason),
    deleted: bool(data.deleted),
    hasMembership: bool(data.hasMembership),
    membership: summaryFrom(data.membership),
    pendingPaise: num(data.pendingPaise),
    consent: consentFrom(data.consent),
    createdAt: toDate(data.createdAt),
    createdBy: str(data.createdBy),
    updatedAt: toDate(data.updatedAt),
    updatedBy: str(data.updatedBy),
    version: versionOf(data.updatedAt),
  };
}

export function trainerFromDoc(id: string, data: Record<string, unknown>): Trainer {
  return {
    id,
    name: str(data.name),
    mobile: strOrNull(data.mobile),
    active: data.active === true,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function photoFromDoc(data: Record<string, unknown>): MemberPhoto | null {
  if (typeof data.dataUrl !== 'string') return null;
  return {
    dataUrl: data.dataUrl,
    contentType: data.contentType === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
    bytes: num(data.bytes),
    width: num(data.width),
    height: num(data.height),
  };
}

export function medicalFromDoc(data: Record<string, unknown>): MemberMedical {
  return { notes: str(data.notes), updatedAt: toDate(data.updatedAt), updatedBy: str(data.updatedBy) };
}

export function planFromDoc(id: string, data: Record<string, unknown>): Plan {
  return {
    id,
    name: str(data.name),
    durationValue: num(data.durationValue),
    durationUnit: isDurationUnit(data.durationUnit) ? data.durationUnit : 'MONTHS',
    pricePaise: num(data.pricePaise),
    description: strOrNull(data.description),
    active: data.active === true,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function membershipFromDoc(id: string, data: Record<string, unknown>): Membership {
  return {
    id,
    memberDocId: str(data.memberDocId),
    memberId: str(data.memberId),
    memberDisplayName: str(data.memberDisplayName),
    planId: str(data.planId),
    planName: str(data.planName),
    planDurationValue: num(data.planDurationValue),
    planDurationUnit: isDurationUnit(data.planDurationUnit) ? data.planDurationUnit : 'MONTHS',
    startDate: toDate(data.startDate),
    endDate: toDate(data.endDate),
    amountPaise: num(data.amountPaise),
    paidPaise: num(data.paidPaise),
    outstandingPaise: num(data.outstandingPaise),
    unpaid: data.unpaid === true,
    createdAt: toDate(data.createdAt),
    createdBy: str(data.createdBy),
  };
}

export function paymentFromDoc(id: string, data: Record<string, unknown>): Payment {
  return {
    id,
    memberDocId: str(data.memberDocId),
    memberId: str(data.memberId),
    memberDisplayName: str(data.memberDisplayName),
    membershipId: str(data.membershipId),
    amountPaise: num(data.amountPaise),
    paymentDate: toDate(data.paymentDate),
    method: isPaymentMethod(data.method) ? data.method : 'OTHER',
    transactionReference: strOrNull(data.transactionReference),
    notes: strOrNull(data.notes),
    voided: data.voided === true,
    voidReason: strOrNull(data.voidReason),
    voidedAt: dateOrNull(data.voidedAt),
    voidedBy: strOrNull(data.voidedBy),
    createdAt: toDate(data.createdAt),
    createdBy: str(data.createdBy),
    createdByName: str(data.createdByName),
  };
}

export function attendanceFromDoc(id: string, data: Record<string, unknown>): AttendanceRecord {
  return {
    id,
    memberDocId: str(data.memberDocId),
    memberId: str(data.memberId),
    memberName: str(data.memberName),
    date: toDate(data.date),
    dateKey: str(data.dateKey),
    status: isAttendanceStatus(data.status) ? data.status : 'ABSENT',
    checkInAt: dateOrNull(data.checkInAt),
    checkOutAt: dateOrNull(data.checkOutAt),
    checkedOut: data.checkedOut === true,
    createdAt: toDate(data.createdAt),
    createdBy: str(data.createdBy),
    updatedAt: toDate(data.updatedAt),
    updatedBy: str(data.updatedBy),
  };
}
