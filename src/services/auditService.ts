import { serverTimestamp } from 'firebase/firestore';
import { type AuditAction, type AuditEntity } from '../constants/enums';
import { type Actor } from '../types/member';

export type AuditMetadata = Record<string, string | number | boolean>;

export interface AuditEntry {
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  /** e.g. `GYM-2026-0001 Rahul Sharma`: readable without a join. */
  entityLabel: string;
  /** Field NAMES and non-sensitive facts only. Never medical-note content or other sensitive values (FR-13). */
  metadata: AuditMetadata;
}

/**
 * The document body of an auditLogs/{id} record (§2.6). Internal to services: it is written inside the same
 * transaction as the action it records (US-2.14b), so there is no generic standalone `writeAudit`. The one exception is
 * REPORT_EXPORTED (services/reportExport.ts): an export only reads data, so there is no transaction to join, and its record is
 * written on its own before the file is released. `at` is the server time, which the rules require to equal `request.time`.
 */
export function auditDocData(actor: Actor, entry: AuditEntry): Record<string, unknown> {
  return {
    actorUid: actor.uid,
    actorName: actor.name,
    actorRole: actor.role,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    at: serverTimestamp(),
    metadata: entry.metadata,
  };
}
