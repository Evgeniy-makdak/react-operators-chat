/**
 * Старые console.trace отключены. Живые логи: lib/operatorUnreadDebugLog.ts, localStorage CHAT_UNREAD_DEBUG.
 */

export const CHAT_UNREAD_LOG_TAG = '[ChatUnread]';
export const CHAT_SESSION_LOG_TAG = '[ChatSession]';

export function chatUnreadTrace(stage: string, payload?: Record<string, unknown>): void {
  void stage;
  void payload;
}

export function chatSessionTrace(stage: string, payload?: Record<string, unknown>): void {
  void stage;
  void payload;
}

export function unreadMapToRecord(map: Map<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  map.forEach((v, k) => {
    out[String(k)] = v;
  });
  return out;
}
