import { GYM_NAME } from '../constants/app';
import { type NotificationPayload, type NotificationRequest } from '../types/notification';
import { formatIstDate } from './dates';

/**
 * Message templates (FR-11). Pure and provider-agnostic: a future WhatsApp / SMS / email / push provider only delivers the
 * text this returns. The text holds the member's FIRST NAME and dates as `DD/MM/YYYY` (IST) and nothing else: no full name,
 * mobile, amount, plan, medical or other personal data (US-7.2a).
 */

const FIRST_NAME_MAX_LENGTH = 30;
const FALLBACK_NAME = 'Member';

/** First word of the name, control characters (e.g. line breaks) turned into spaces, capped in length; blank input becomes "Member". */
export function firstNameOf(name: string): string {
  let cleaned = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    cleaned += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  const first = cleaned.trim().split(/\s+/)[0] ?? '';
  return first === '' ? FALLBACK_NAME : first.slice(0, FIRST_NAME_MAX_LENGTH);
}

export function notificationPayload(request: NotificationRequest): NotificationPayload {
  return {
    firstName: firstNameOf(request.firstName),
    endDate: 'endDate' in request ? formatIstDate(request.endDate) : null,
  };
}

/** Renders the message for a request. The type system requires `endDate` for the two membership templates. */
export function renderNotificationMessage(request: NotificationRequest): string {
  const { firstName, endDate } = notificationPayload(request);
  switch (request.type) {
    case 'MEMBERSHIP_EXPIRING':
      return `Hi ${firstName}, your ${GYM_NAME} membership expires on ${endDate}. Please renew to keep training without a break.`;
    case 'MEMBERSHIP_EXPIRED':
      return `Hi ${firstName}, your ${GYM_NAME} membership expired on ${endDate}. Please renew to continue.`;
    case 'PAYMENT_DUE':
      return `Hi ${firstName}, you have a pending payment at ${GYM_NAME}. Please contact the front desk.`;
  }
}
