/** Утилиты для привязки входящих сообщений и бейджей к правильной сессии / dialogId. */

export function normalizeDialogId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === 'assigned') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function consensusDialogIdFromMessages(messages?: any[]): number | null {
  if (!messages?.length) return null;
  const ids = new Set<number>();
  for (const m of messages) {
    const id = normalizeDialogId(m?.dialog?.id ?? m?.dialogId);
    if (id != null) ids.add(id);
  }
  if (ids.size === 1) return Array.from(ids)[0]!;
  return null;
}

/**
 * Сначала однозначный dialogId из ленты сообщений, иначе метаданные сессии.
 * Нужно, когда selectedDialog/assignedDialogId временно указывают на «чужой» диалог.
 */
export function resolveSessionDialogIdForUnread(session: {
  selectedDialog?: { id?: unknown };
  assignedDialogId?: unknown;
  messages?: any[];
  dialogs?: { id?: unknown }[];
}): number | null {
  const fromMsgs = consensusDialogIdFromMessages(session.messages);
  if (fromMsgs != null) return fromMsgs;
  const fromMeta = normalizeDialogId(session.selectedDialog?.id ?? session.assignedDialogId);
  if (fromMeta != null) return fromMeta;
  if (Array.isArray(session.dialogs) && session.dialogs.length > 0) {
    return normalizeDialogId(session.dialogs[0].id);
  }
  return null;
}

export function pickSessionMatchingDialogId<
  T extends {
    selectedDialog?: { id?: unknown };
    assignedDialogId?: unknown;
    selectedUsers?: number[];
    isMinimized?: boolean;
  },
>(sessions: T[], dialogIdStr: string, preferredUserId: number | undefined): T | undefined {
  const matches = sessions.filter(
    (s) =>
      (s.selectedDialog?.id != null && String(s.selectedDialog.id) === dialogIdStr) ||
      (s.assignedDialogId != null && String(s.assignedDialogId) === dialogIdStr),
  );
  if (matches.length === 0) return undefined;
  if (matches.length === 1) return matches[0];
  if (preferredUserId != null && !Number.isNaN(preferredUserId) && preferredUserId > 0) {
    const byUser = matches.find((s) => s.selectedUsers?.includes(preferredUserId));
    if (byUser) return byUser;
  }
  const expanded = matches.find((s) => !s.isMinimized);
  if (expanded) return expanded;
  return matches[0];
}
