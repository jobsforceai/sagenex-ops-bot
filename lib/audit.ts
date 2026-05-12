/**
 * Audit-log every chat request to MongoDB so we can investigate abuse later.
 * Lightweight, fire-and-forget.
 */
import { getMongoDb } from './mongo-client';

export interface ChatAuditEntry {
  at: Date;
  ip: string;
  userAgent: string;
  messagePreview: string;     // first 200 chars only
  historyLength: number;
  outcome: 'ok' | 'rate_limited' | 'unauthorized' | 'bot_detected';
}

export async function logChat(entry: ChatAuditEntry) {
  try {
    const db = await getMongoDb();
    await db.collection('opsbot_audit').insertOne(entry);
  } catch (e) {
    console.error('[audit] log failed:', (e as any)?.message);
  }
}
