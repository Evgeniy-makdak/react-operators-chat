/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useState } from 'react';

import { ChatSession } from '../types/ChatTypes';

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

      if (isCurrentlyMinimized) {
        const currentlyExpandedSession = prev.find((s) => !s.isMinimized);

        setActiveSessionId(sessionId);

        return prev.map((session) => {
          if (session.id === sessionId) {
            return { ...session, isMinimized: false };
          }
          if (currentlyExpandedSession && session.id === currentlyExpandedSession.id) {
            return { ...session, isMinimized: true };
          }
          return session;
        });
      } else {
        return prev.map((session) =>
          session.id === sessionId ? { ...session, isMinimized: true } : session,
        );
      }
    });
  }, []);

  /**
   * Разворачивание сессии: сворачивает раскрытую, разворачивает указанную.
   * Обе сессии остаются в массиве (swap визуального порядка).
   */
  const expandSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setSessions((prev) => {
      const targetSession = prev.find((s) => s.id === sessionId);
      if (!targetSession) return prev;

      const expandedSession = prev.find((s) => !s.isMinimized);

      if (!targetSession.isMinimized) {
        return prev;
      }

      if (!expandedSession) {
        return prev.map((s) => (s.id === sessionId ? { ...s, isMinimized: false } : s));
      }

      return prev.map((s) => {
        if (s.id === sessionId) return { ...s, isMinimized: false };
        if (s.id === expandedSession.id) return { ...s, isMinimized: true };
        return s;
      });
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

    sessions.forEach((session) => {
      if (session.selectedUsers && session.selectedUsers.length > 0) {
        const userId = session.selectedUsers[0];
        const dialogId =
          session.selectedDialog?.id ??
          session.assignedDialogId ??
          session.messages?.[0]?.dialog?.id ??
          session.messages?.[0]?.dialogId;
        const key = `${userId}_${dialogId ?? 'none'}`;

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
      }
    });

    if (sessionsToRemove.size > 0) {
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

          const isEmpty = session.selectedUsers.length === 0 && session.messages.length === 0;
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
