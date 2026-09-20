import { type NotificationChannel, type NotificationStatus, type NotificationType } from '../constants/enums';

/**
 * Notification abstraction (FR-11, US-7.1, US-7.2). Firebase-free, like the rest of `src/types`.
 *
 * Privacy (DPDP, US-7.2a): a request or a record carries the member's document id (a reference, not a name or a number),
 * the member's FIRST NAME and dates. It never carries a full name, mobile, email, address, date of birth, medical notes,
 * payment amounts or a transaction reference. A real provider resolves the recipient address itself, from the member
 * document, at delivery time: the address is never copied into a notification record.
 */

/** What the caller wants to notify about. `endDate` is required for the two membership templates. */
export type NotificationRequest = {
  /** `members/{memberDocId}` document id (never the human-readable GYM-YYYY-NNNN id, never a mobile number). */
  memberDocId: string;
  channel: NotificationChannel;
  /** The member's first name only. The template function reduces anything longer to its first word. */
  firstName: string;
} & (
  | { type: 'MEMBERSHIP_EXPIRING' | 'MEMBERSHIP_EXPIRED'; endDate: Date }
  | { type: 'PAYMENT_DUE' }
);

/** The structured, non-sensitive values a message was rendered from (stored so a provider can re-render if it must). */
export interface NotificationPayload {
  firstName: string;
  /** `DD/MM/YYYY` (IST) or null when the template has no date. */
  endDate: string | null;
}

export interface NotificationRecord {
  /** Document id once persisted; null while the record only exists in memory (the stub never persists). */
  id: string | null;
  memberDocId: string;
  type: NotificationType;
  channel: NotificationChannel;
  status: NotificationStatus;
  /** The rendered text: first name and DD/MM/YYYY dates only. */
  message: string;
  payload: NotificationPayload;
  createdAt: Date;
  /** Set only when a real provider confirmed SENT. */
  sentAt: Date | null;
  /** Human-readable reason for NOT_DELIVERED / FAILED. Never contains personal data. */
  statusDetail: string | null;
  /** Provider name, e.g. "stub". Lets a screen say honestly what handled the request. */
  provider: string;
}

/**
 * Provider-agnostic contract. Screens depend on this interface only (US-7.1a); a WhatsApp / SMS / email / push provider
 * implements it and is registered in `services/notificationService.ts`. Implementations must never report SENT unless the
 * provider really accepted the message (US-7.1b: no false success).
 */
export interface NotificationService {
  readonly providerName: string;
  /** Try to deliver now. Resolves with the record describing what happened; rejects only for programmer errors. */
  send(request: NotificationRequest): Promise<NotificationRecord>;
  /** Hand the request to a later processor (a cron worker). Resolves with the record (status QUEUED, or NOT_DELIVERED if unsupported). */
  queue(request: NotificationRequest): Promise<NotificationRecord>;
}
