import { notificationPayload, renderNotificationMessage } from '../domain/notificationTemplates';
import { type NotificationRecord, type NotificationRequest, type NotificationService } from '../types/notification';

/**
 * The notification seam (FR-11, US-7.1). Screens and other services obtain a `NotificationService` from
 * `getNotificationService()` and depend on the interface only. No external provider SDK or secret exists in this project.
 *
 * NEW-21: nothing in the UI creates notification records in the MVP, and the Firestore rules deny the `notifications`
 * collection to every client. The stub therefore keeps records in memory only and delivers nothing.
 */

export const STUB_PROVIDER_NAME = 'stub';
export const STUB_STATUS_DETAIL = 'Not delivered (stub): no notification provider is configured, so nothing was sent.';

function stubRecord(request: NotificationRequest, now: Date): NotificationRecord {
  return {
    id: null, // never persisted
    memberDocId: request.memberDocId,
    type: request.type,
    channel: request.channel,
    status: 'NOT_DELIVERED', // never SENT and never QUEUED: nothing is sent and nothing is stored (US-7.1b)
    message: renderNotificationMessage(request),
    payload: notificationPayload(request),
    createdAt: now,
    sentAt: null,
    statusDetail: STUB_STATUS_DETAIL,
    provider: STUB_PROVIDER_NAME,
  };
}

/** The MVP provider. `now` is injectable so the record's timestamp is deterministic in tests. */
export function createStubNotificationService(now: () => Date = () => new Date()): NotificationService {
  return {
    providerName: STUB_PROVIDER_NAME,
    send: (request) => Promise.resolve(stubRecord(request, now())),
    // Nothing can be queued without a writer (NEW-21) and a processor (no Cloud Functions), so this is honest about it too.
    queue: (request) => Promise.resolve(stubRecord(request, now())),
  };
}

let current: NotificationService = createStubNotificationService();

/** The one place future code obtains the notification service. */
export function getNotificationService(): NotificationService {
  return current;
}

/**
 * The one place a real provider is registered (call it once at start-up when a provider exists). Passing nothing restores the
 * stub. Not called anywhere in the MVP.
 */
export function setNotificationService(service?: NotificationService): void {
  current = service ?? createStubNotificationService();
}
