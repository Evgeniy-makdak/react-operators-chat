/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useState } from 'react';

import { chatSessionTrace } from '../chatUnreadTrace';
import { ChatSession } from '../types/ChatTypes';

function feedDialogIdStr(s: ChatSession): string | null {
  if (s.selectedDialog?.id != null && String(s.selectedDialog.id) !== '0') {
    return String(s.selectedDialog.id);
  }
  const ad = s.assignedDialogId;
  if (ad != null && String(ad) !== '' && String(ad) !== '0' && String(ad) !== 'assigned') {
    return String(ad);
  }
  if (s.messages?.length) {
    const m = s.messages.find((x: any) => x.dialogId != null || x.dialog?.id != null);
    if (m) {
      const id = String(m.dialogId ?? m.dialog?.id ?? '');
      if (id !== '') return id;
    }
  }
  return null;
}

/** Входящие с SENT при раскрытом чате отображаем как DELIVERED до ответа бэка. */
function normalizeExpandedSessionInboundStatus(s: ChatSession): ChatSession {
  const expanded = { ...s, isMinimized: false };
  const fid = feedDialogIdStr(expanded);
  if (!fid || !expanded.messages?.length) return expanded;
  const messages = expanded.messages.map((msg: any) => {
    const mid = msg.dialogId?.toString() || msg.dialog?.id?.toString() || '';
    if (
      mid === fid &&
      msg.messageStatus === 'TO_OPERATOR' &&
      String(msg.confirmStatus ?? '').toUpperCase() === 'SENT' &&
      !msg.is_read
    ) {
      return { ...msg, confirmStatus: 'DELIVERED' };
    }
    return msg;
  });
  return { ...expanded, messages };
}

export const useChatSessions = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const updateSession = useCallback((sessionId: string, updates: Partial<ChatSession>) => {
    setSessions((prev) =>
      prev.map((session) => (session.id === sessionId ? { ...session, ...updates } : session)),
    );
  }, []);

  const getSession = useCallback(
    (sessionId: string): ChatSession | undefined => {
      return sessions.find((session) => session.id === sessionId);
    },
    [sessions],
  );

  const createNewSession = useCallback(
    (options?: { asMinimized?: boolean }): string => {
      const newSessionId = Date.now().toString();

      const existingSession = sessions.find((s) => s.id === newSessionId);
      if (existingSession) {
        return existingSession.id;
      }

      const asMinimized = options?.asMinimized ?? false;

      const newSession: ChatSession = {
        id: newSessionId,
        dialogs: [],
        messages: [],
        selectedDialog: null,
        isMinimized: asMinimized,
        selectedUsers: [],
        selectedUserName: '',
        messageText: '',
        usersCache: new Map(),
        isDialogEnded: false,
        isUsersTouched: false,
        hasSentMessage: false,
        clearMessageInput: false,
        uploadedAttachments: [],
        hasLoadedDialogs: false,
        pendingAttachments: [],
        isSendingMessage: false,
        lastSendError: null,
        assignedDialogId: null,
        transferRecipientFullName: null,
        unreadDialogs: [],
        isLoadingUnreadDialogs: false,
      };

      setSessions((prev) => {
        const hasDuplicate = prev.some((s) => s.id === newSessionId);
        if (hasDuplicate) {
          return prev;
        }
        return [...prev, newSession];
      });

      if (!asMinimized) {
        setActiveSessionId(newSessionId);
      }
      return newSessionId;
    },
    [sessions],
  );

  const closeSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => prev.filter((session) => session.id !== sessionId));

      if (activeSessionId === sessionId) {
        const remainingSessions = sessions.filter((s) => s.id !== sessionId);
        if (remainingSessions.length > 0) {
          setActiveSessionId(remainingSessions[0].id);
        } else {
          setActiveSessionId(null);
        }
      }
    },
    [activeSessionId, sessions],
  );

  const toggleSessionMinimize = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const sessionToToggle = prev.find((s) => s.id === sessionId);
      if (!sessionToToggle) return prev;

      const isCurrentlyMinimized = sessionToToggle.isMinimized;
      const snap = (list: ChatSession[]) =>
        list.map((s) => ({
          id: s.id,
          min: s.isMinimized,
          user: s.selectedUsers?.[0],
          dialog:
            s.selectedDialog?.id != null
              ? String(s.selectedDialog.id)
              : s.assignedDialogId != null
                ? String(s.assignedDialogId)
                : null,
        }));

      chatSessionTrace('toggleSessionMinimize.before', {
        sessionId,
        expanding: isCurrentlyMinimized,
        sessions: snap(prev),
      });

      if (isCurrentlyMinimized) {
        setActiveSessionId(sessionId);

        /* Сворачиваем все прочие развёрнутые, иначе остаётся 2+ expanded — второе окно
         * перекрывается карточкой и «пропадает» из превью. */
        const next = prev.map((session) => {
          if (session.id === sessionId) {
            return { ...session, isMinimized: false };
          }
          if (!session.isMinimized) {
            return { ...session, isMinimized: true };
          }
          return session;
        });
        chatSessionTrace('toggleSessionMinimize.afterExpandFromPreview', { sessions: snap(next) });
        return next;
      } else {
        const next = prev.map((session) =>
          session.id === sessionId ? { ...session, isMinimized: true } : session,
        );
        chatSessionTrace('toggleSessionMinimize.afterMinimize', { sessions: snap(next) });
        return next;
      }
    });
  }, []);

  /**
   * Показать только эту сессию развёрнутой: target — на передний план, остальные свернуть.
   * Работает и для клика по превью (был свёрнут), и для починки состояния «несколько expanded».
   */
  const expandSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setSessions((prev) => {
      const snap = (list: ChatSession[]) =>
        list.map((s) => ({
          id: s.id,
          min: s.isMinimized,
          user: s.selectedUsers?.[0],
          dialog:
            s.selectedDialog?.id != null
              ? String(s.selectedDialog.id)
              : s.assignedDialogId != null
                ? String(s.assignedDialogId)
                : null,
        }));

      if (!prev.some((s) => s.id === sessionId)) {
        chatSessionTrace('expandSession.skipMissing', { sessionId, sessions: snap(prev) });
        return prev;
      }
      chatSessionTrace('exclusiveExpand.before', { sessionId, sessions: snap(prev) });
      const next = prev.map((s) => {
        if (s.id === sessionId) return normalizeExpandedSessionInboundStatus(s);
        if (!s.isMinimized) return { ...s, isMinimized: true };
        return s;
      });
      chatSessionTrace('exclusiveExpand.after', { sessionId, sessions: snap(next) });
      return next;
    });
  }, []);

  const findSessionByUserId = useCallback(
    (userId: number): ChatSession | undefined => {
      const foundSession = sessions.find(
        (session) =>
          session.selectedUsers.includes(userId) &&
          session.id !== activeSessionId &&
          !session.isMinimized,
      );

      if (!foundSession) {
        const anySession = sessions.find(
          (session) => session.selectedUsers.includes(userId) && session.id !== activeSessionId,
        );
        return anySession;
      }

      return foundSession;
    },
    [sessions, activeSessionId],
  );

  const hasSessionWithUser = useCallback(
    (userId: number): boolean => {
      return sessions.some(
        (session) => session.selectedUsers && session.selectedUsers.includes(userId),
      );
    },
    [sessions],
  );

  const getSessionByUserId = useCallback(
    (userId: number): ChatSession | undefined => {
      return sessions.find(
        (session) => session.selectedUsers && session.selectedUsers.includes(userId),
      );
    },
    [sessions],
  );

  const getSessionByDialogId = useCallback(
    (dialogId: string): ChatSession | undefined => {
      const dialogIdStr = String(dialogId);
      return sessions.find(
        (session) =>
          (session.selectedDialog?.id && String(session.selectedDialog.id) === dialogIdStr) ||
          (session.assignedDialogId && String(session.assignedDialogId) === dialogIdStr),
      );
    },
    [sessions],
  );

  const incrementUnreadCount = useCallback((sessionId: string, amount = 1) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id === sessionId) {
          const newCount = (session.unreadCount || 0) + amount;
          return { ...session, unreadCount: newCount };
        }
        return session;
      }),
    );
  }, []);

  const removeDuplicateSessions = useCallback(() => {
    const keyToSessionMap = new Map<string, string>();
    const sessionsToRemove = new Set<string>();

    const dedupKeyForSession = (session: ChatSession): string | null => {
      if (!session.selectedUsers?.length) return null;
      const userId = session.selectedUsers[0];
      const raw =
        session.selectedDialog?.id ??
        session.assignedDialogId ??
        session.messages?.[0]?.dialog?.id ??
        session.messages?.[0]?.dialogId;
      const str = raw !== undefined && raw !== null ? String(raw).trim() : '';
      const resolved = str !== '' && str !== '0' && str !== 'assigned' ? str : null;
      /* Пока нет однозначного id диалога — не склеиваем сессии по «user_none»,
       * иначе два свёрнутых чата / обмен местами приводит к удалению превью. */
      if (resolved === null) return `${userId}_pending_${session.id}`;
      return `${userId}_${resolved}`;
    };

    sessions.forEach((session) => {
      const key = dedupKeyForSession(session);
      if (!key) return;

      if (keyToSessionMap.has(key)) {
        const existingSessionId = keyToSessionMap.get(key)!;
        const existingSession = getSession(existingSessionId);
        if (existingSession && session) {
          if (!existingSession.isMinimized && session.isMinimized) {
            sessionsToRemove.add(session.id);
          } else if (existingSession.isMinimized && !session.isMinimized) {
            sessionsToRemove.add(existingSessionId);
            keyToSessionMap.set(key, session.id);
          } else {
            const existingCreationTime = parseInt(existingSessionId);
            const currentCreationTime = parseInt(session.id);
            if (currentCreationTime > existingCreationTime) {
              sessionsToRemove.add(existingSessionId);
              keyToSessionMap.set(key, session.id);
            } else {
              sessionsToRemove.add(session.id);
            }
          }
        }
      } else {
        keyToSessionMap.set(key, session.id);
      }
    });

    if (sessionsToRemove.size > 0) {
      chatSessionTrace('removeDuplicateSessions.removing', {
        ids: Array.from(sessionsToRemove),
        keyToSession: Object.fromEntries(keyToSessionMap),
      });
      setSessions((prev) => prev.filter((session) => !sessionsToRemove.has(session.id)));

      if (activeSessionId && sessionsToRemove.has(activeSessionId)) {
        const remainingSessions = sessions.filter((s) => !sessionsToRemove.has(s.id));
        if (remainingSessions.length > 0) {
          setActiveSessionId(remainingSessions[0].id);
        } else {
          setActiveSessionId(null);
        }
      }
    }
  }, [sessions, getSession, activeSessionId]);

  const removeEmptySessions = useCallback(
    (excludeSessionId?: string) => {
      setSessions((prev) => {
        const filteredSessions = prev.filter((session) => {
          if (session.id === excludeSessionId) {
            return true;
          }

          const hasUnreadPreviewDialogs = (session.unreadDialogs?.length ?? 0) > 0;
          const isEmpty =
            session.selectedUsers.length === 0 &&
            session.messages.length === 0 &&
            !hasUnreadPreviewDialogs;
          return !isEmpty;
        });

        if (activeSessionId && !filteredSessions.some((s) => s.id === activeSessionId)) {
          if (filteredSessions.length > 0) {
            setActiveSessionId(filteredSessions[0].id);
          } else {
            setActiveSessionId(null);
          }
        }

        return filteredSessions;
      });
    },
    [activeSessionId],
  );

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    updateSession,
    getSession,
    createNewSession,
    closeSession,
    toggleSessionMinimize,
    expandSession,
    findSessionByUserId,
    hasSessionWithUser,
    getSessionByUserId,
    getSessionByDialogId,
    incrementUnreadCount,
    removeDuplicateSessions,
    removeEmptySessions,
  };
};
