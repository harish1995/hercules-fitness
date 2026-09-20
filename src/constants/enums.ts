export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

export function isGender(value: unknown): value is Gender {
  return typeof value === 'string' && (GENDERS as readonly string[]).includes(value);
}

export const GENDER_LABELS: Record<Gender, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };

export const AUDIT_ACTIONS = [
  'MEMBER_CREATED',
  'MEMBER_UPDATED',
  'MEMBER_DELETED',
  'MEMBER_SUSPENDED',
  'MEMBER_REACTIVATED',
  'MEMBERSHIP_CREATED',
  'MEMBERSHIP_RENEWED',
  'PAYMENT_CREATED',
  'PAYMENT_VOIDED',
  'PLAN_CREATED',
  'PLAN_UPDATED',
  'PLAN_DELETED',
  'REPORT_EXPORTED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITIES = ['member', 'membership', 'payment', 'plan', 'report'] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];

export const DURATION_UNITS = ['DAYS', 'MONTHS'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

export function isDurationUnit(value: unknown): value is DurationUnit {
  return typeof value === 'string' && (DURATION_UNITS as readonly string[]).includes(value);
}

export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = { DAYS: 'Days', MONTHS: 'Months' };

/** Sanity caps (mirrored in the Firestore rules): 10 years in days, 10 years in months. */
export const MAX_DURATION_DAYS = 3650;
export const MAX_DURATION_MONTHS = 120;

/** Payment methods (FR-6). No card data is ever stored: only the method and an optional transaction reference. */
export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  CARD: 'Card',
  BANK_TRANSFER: 'Bank Transfer',
  OTHER: 'Other',
};

/** Attendance (FR-7): one record per member per IST day. ABSENT exists only when marked explicitly. */
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = { PRESENT: 'Present', ABSENT: 'Absent' };

/**
 * Notifications (FR-11, Phase 7). Abstraction only: no provider is wired and nothing is delivered (NEW-21, Q1c).
 * Channels are the ones a future provider could implement; each needs a paid account or a server, none is built.
 */
export const NOTIFICATION_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  WHATSAPP: 'WhatsApp',
  SMS: 'SMS',
  EMAIL: 'Email',
  PUSH: 'Push notification',
};

/** Template / trigger types. Each maps to one message template in `domain/notificationTemplates.ts`. */
export const NOTIFICATION_TYPES = ['MEMBERSHIP_EXPIRING', 'MEMBERSHIP_EXPIRED', 'PAYMENT_DUE'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * QUEUED: accepted for later processing. SENT: a real provider confirmed hand-off. FAILED: a real provider was tried and
 * refused. NOT_DELIVERED: nothing was sent (the stub, or no provider configured). The stub only ever reports NOT_DELIVERED.
 */
export const NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'NOT_DELIVERED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
