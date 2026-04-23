import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Close, Minimize } from '@mui/icons-material';
import { Box, IconButton, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { appStore } from '@shared/model/app_store/AppStore';

import api from '../api';
import { useChat } from '../contexts/ChatContext';
import { useSocket } from '../contexts/SocketContext';
import { operatorUnreadDebug } from '../lib/operatorUnreadDebugLog';
import styles from './ChatPanel.module.scss';
import { DialogActions } from './DialogActions';
import MessageFeed from './MessageFeed';
import MessageInput from './MessageInput';
import { TransferOperatorSelect } from './TransferOperatorSelect';
import UsersSelect from './UsersSelect';

interface ChatPanelProps {
  sessionId: string;
  onMinimize?: () => void;
  scrollToBottomOnExpand?: boolean;
  onScrollToBottomDone?: () => void;
}

function getLastOperatorIdFromDialog(d: any): number | string | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const lo = d.lastOperator ?? d.last_operator ?? d.dialog?.lastOperator ?? d.dialog?.last_operator;
  return lo?.id;
}

/** Активный dialogId для ленты: мета сессии или fallback из сообщений (пока selectedDialog не проставлен). */
function resolveActiveFeedDialogIdStr(session: any): string | null {
  if (!session) return null;
  let sid =
    session.selectedDialog?.id && String(session.selectedDialog.id) !== '0'
      ? String(session.selectedDialog.id)
      : session.assignedDialogId &&
          String(session.assignedDialogId) !== '0' &&
          String(session.assignedDialogId) !== 'assigned'
        ? String(session.assignedDialogId)
        : null;
  if (sid == null && session.messages?.length) {
    const m = session.messages.find((x: any) => x.dialogId != null || x.dialog?.id != null);
    if (m) sid = String(m.dialogId ?? m.dialog?.id ?? '');
  }
  return sid && sid !== '' ? sid : null;
}

function ChatPanel({
  sessionId,
  onMinimize,
  scrollToBottomOnExpand,
  onScrollToBottomDone,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { dialogsUnreadCounts, updateDialogUnreadCount } = useSocket();
  const {
    sessions,
    closeSession,
    setIsChatOpen,
    toggleSessionMinimize,
    updateSession,
    getSession,
    setActiveSessionId,
    findSessionByUserId,
    removeEmptySessions,
    clearPendingAttachments,
    setPendingAttachments,
    getPendingAttachments,
    sendReadStatusForMessageId,
    loadDialogHistory,
    loadMessagesByUserId,
  } = useChat();

  const session = getSession(sessionId);
  const resolvedFeedDialogIdStr = useMemo(() => resolveActiveFeedDialogIdStr(session), [session]);

  /** Актуальный getSession без подписки useCallback на usersCache — иначе цикл запросов в UsersSelect. */
  const getSessionLiveRef = useRef(getSession);
  getSessionLiveRef.current = getSession;

  const [localIsUsersTouched, setLocalIsUsersTouched] = useState(false);
  const [localHasSentMessage, setLocalHasSentMessage] = useState(false);
  const [localClearMessageInput, setLocalClearMessageInput] = useState(false);
  const [replyTarget, setReplyTarget] = useState<any>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dialogStatus, setDialogStatus] = useState<string>('');
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isDialogReallyBlocked, setIsDialogReallyBlocked] = useState(false);
  const [isTransferLoading, setIsTransferLoading] = useState(false);

  const authId = appStore((state) => state.authId);

  const isUpdatingRef = useRef(false);
  const prevSessionIdRef = useRef<string>(sessionId);
  const lastMessageCountRef = useRef<number>(0);
  const lastStableUnreadCountRef = useRef<number>(0);
  const unreadCountDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const headerUnreadLogRef = useRef<number | null>(null);
  const initialLoadDoneRef = useRef(false);
  const historyLoadAttemptedRef = useRef(false);
  const isSessionSwitchingRef = useRef(false);

  const getDisplayUserName = useCallback(() => {
    if (session?.selectedUserName) return session.selectedUserName;
    if (session?.selectedUsers?.length > 0) {
      const userId = session.selectedUsers[0];
      const cachedUser = session.usersCache?.get(userId);
      if (cachedUser?.fullName) return cachedUser.fullName;
    }
    return '';
  }, [session]);

  const stableSetUnreadCount = useCallback((newCount: number) => {
    if (unreadCountDebounceRef.current) clearTimeout(unreadCountDebounceRef.current);
    if (newCount !== lastStableUnreadCountRef.current) {
      lastStableUnreadCountRef.current = newCount;
      setUnreadCount(newCount);
    }
  }, []);

  useEffect(() => {
    if (!session || isUpdatingRef.current || isSessionSwitchingRef.current) return;

    isUpdatingRef.current = true;

    try {
      if (session.isUsersTouched !== localIsUsersTouched) {
        setLocalIsUsersTouched(session.isUsersTouched || false);
      }

      if (session.hasSentMessage !== localHasSentMessage) {
        setLocalHasSentMessage(session.hasSentMessage || false);
      }

      if (session.clearMessageInput !== localClearMessageInput) {
        setLocalClearMessageInput(session.clearMessageInput || false);
      }

      const pendingAttachments = getPendingAttachments(sessionId);
      const currentAttachmentsKey = attachments.map((f) => `${f.name}-${f.size}`).join(',');
      const pendingAttachmentsKey = pendingAttachments.map((f) => `${f.name}-${f.size}`).join(',');

      if (currentAttachmentsKey !== pendingAttachmentsKey) {
        setAttachments(pendingAttachments);
      }

      if (session.selectedDialog?.status && session.selectedDialog.status !== dialogStatus) {
        setDialogStatus(session.selectedDialog.status);
      }

      if (session.messages) {
        const activeSid = resolvedFeedDialogIdStr;
        const msgsForUnread =
          activeSid != null
            ? session.messages.filter(
                (msg: any) => String(msg.dialogId ?? msg.dialog?.id ?? '') === activeSid,
              )
            : [];

        const currentMessageCount = msgsForUnread.length;
        if (currentMessageCount !== lastMessageCountRef.current) {
          lastMessageCountRef.current = currentMessageCount;
        }

        const strictCount = msgsForUnread.reduce((acc: number, msg: any) => {
          if (String(msg.confirmStatus ?? '').toUpperCase() === 'READ') return acc;
          if (
            msg.messageStatus === 'TO_OPERATOR' &&
            (msg.confirmStatus === 'SENT' || msg.confirmStatus === 'DELIVERED') &&
            !msg.is_read
          ) {
            return acc + 1;
          }
          return acc;
        }, 0);
        const relaxedCount = msgsForUnread.reduce((acc: number, msg: any) => {
          if (String(msg.confirmStatus ?? '').toUpperCase() === 'READ') return acc;
          if (msg.messageStatus === 'TO_OPERATOR' && !msg.is_read) {
            return acc + 1;
          }
          return acc;
        }, 0);
        const count = Math.max(strictCount, relaxedCount);

        stableSetUnreadCount(count);
        // Синхронизация в сессию сразу при вычислении для корректного превью при сворачивании
        if (count !== (session.unreadCount ?? 0)) {
          updateSession(sessionId, { unreadCount: count });
        }
      }
    } finally {
      setTimeout(() => {
        isUpdatingRef.current = false;
      }, 0);
    }
  }, [
    session,
    sessionId,
    resolvedFeedDialogIdStr,
    getPendingAttachments,
    attachments,
    dialogStatus,
    stableSetUnreadCount,
    updateSession,
  ]);

  useEffect(() => {
    if (prevSessionIdRef.current !== sessionId) {
      prevSessionIdRef.current = sessionId;
      isUpdatingRef.current = false;
      lastMessageCountRef.current = 0;
      lastStableUnreadCountRef.current = 0;
      initialLoadDoneRef.current = false;
      historyLoadAttemptedRef.current = false;
      isSessionSwitchingRef.current = false;
    }
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (unreadCountDebounceRef.current) clearTimeout(unreadCountDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (session) {
      const shouldUpdate =
        session.isUsersTouched !== localIsUsersTouched ||
        session.hasSentMessage !== localHasSentMessage ||
        session.clearMessageInput !== localClearMessageInput;

      if (shouldUpdate && !isUpdatingRef.current) {
        isUpdatingRef.current = true;
        updateSession(sessionId, {
          isUsersTouched: localIsUsersTouched,
          hasSentMessage: localHasSentMessage,
          clearMessageInput: localClearMessageInput,
        });

        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      }
    }
  }, [
    localIsUsersTouched,
    localHasSentMessage,
    localClearMessageInput,
    sessionId,
    updateSession,
    session,
  ]);

  useEffect(() => {
    if (session) {
      const pendingAttachments = getPendingAttachments(sessionId);
      const currentAttachmentNames = attachments.map((f) => f.name + f.size).join(',');
      const pendingAttachmentNames = pendingAttachments.map((f) => f.name + f.size).join(',');

      if (currentAttachmentNames !== pendingAttachmentNames) {
        setAttachments(pendingAttachments);
      }
    }
  }, [sessionId, getPendingAttachments, session, attachments]);

  useEffect(() => {
    if (localClearMessageInput) {
      setLocalClearMessageInput(false);
      updateSession(sessionId, { clearMessageInput: false });
    }
  }, [localClearMessageInput, sessionId, updateSession]);

  useEffect(() => {
    if (
      session?.selectedDialog?.id &&
      session.selectedDialog.id !== '0' &&
      !historyLoadAttemptedRef.current &&
      (!session.messages || session.messages.length === 0)
    ) {
      historyLoadAttemptedRef.current = true;
      loadDialogHistory(sessionId, session.selectedDialog.id).catch(console.error);
    }
  }, [session?.selectedDialog?.id, session?.messages, sessionId, loadDialogHistory]);

  useEffect(() => {
    if (session?.selectedUsers && session.selectedUsers.length > 0 && !initialLoadDoneRef.current) {
      const userId = session.selectedUsers[0];
      const hasDialogId = session.selectedDialog?.id && session.selectedDialog.id !== '0';
      const isDialogClosed = session.selectedDialog?.status === 'CLOSED';
      const isDialogOpen =
        session.selectedDialog?.status === 'OPEN' ||
        session.selectedDialog?.status === 'ACTIVE' ||
        !session.selectedDialog?.status;

      if (hasDialogId && isDialogClosed) {
        loadDialogHistory(sessionId, session.selectedDialog.id).catch(console.error);
      } else if (isDialogOpen && !hasDialogId) {
        loadMessagesByUserId(sessionId, userId)
          .catch(console.error)
          .finally(() => undefined);
      }

      initialLoadDoneRef.current = true;
    }
  }, [
    session?.selectedUsers,
    session?.selectedDialog,
    sessionId,
    loadDialogHistory,
    loadMessagesByUserId,
  ]);

  useEffect(() => {
    if (!session?.selectedDialog?.id || session.selectedDialog.id === '0') return;

    const checkDialogStatusInterval = setInterval(() => {
      const session = getSession(sessionId);
      if (!session?.selectedDialog?.id || session.selectedDialog.id === '0') return;

      api
        .getDialogDetails(session.selectedDialog.id)
        .then((dialogDetails) => {
          if (dialogDetails?.status && dialogDetails.status !== dialogStatus) {
            setDialogStatus(dialogDetails.status);

            if (dialogStatus === 'CLOSED' && dialogDetails.status !== 'CLOSED') {
              updateSession(sessionId, {
                assignedDialogId: null,
                lastSendError: null,
              });
            }

            const incomingLo = dialogDetails.lastOperator ?? dialogDetails.last_operator;
            updateSession(sessionId, {
              selectedDialog: {
                ...session.selectedDialog,
                status: dialogDetails.status,
                ...(incomingLo != null ? { lastOperator: incomingLo } : {}),
              },
            });
          }
        })
        .catch((error) => {
          console.error('Ошибка проверки статуса диалога:', error);
        });
    }, 60000);

    return () => clearInterval(checkDialogStatusInterval);
  }, [sessionId, getSession, updateSession, dialogStatus, session?.selectedDialog?.id]);

  const handleUsersChange = useCallback(
    (users: number[]) => {
      const filteredUsers = users.filter((id) => id !== 0);

      if (filteredUsers.length === 0) {
        updateSession(sessionId, {
          selectedUsers: [],
          selectedUserName: '',
          selectedDialog: null,
          assignedDialogId: null,
          hasLoadedDialogs: false,
          clearMessageInput: true,
          messages: [],
          hasSentMessage: false,
          isDialogEnded: false,
          transferRecipientFullName: null,
          pagination: {
            currentPage: 0,
            totalPages: 0,
            totalElements: 0,
            isLoadingMore: false,
            isLoadingNext: false,
            hasMoreMessages: false,
            hasNextMessages: false,
          },
        });
        setLocalClearMessageInput(true);
        setLocalHasSentMessage(false);
        setAttachments([]);
        clearPendingAttachments(sessionId);
        setDialogStatus('');
        stableSetUnreadCount(0);
        initialLoadDoneRef.current = false;
        historyLoadAttemptedRef.current = false;
      } else {
        /* Иначе остаётся selectedDialog/assignedDialogId от предыдущего пользователя:
         loadMessagesByUserId уходит в refreshSessionMessages(старый dialogId), запросов по новому userId нет,
         а эффект ниже не вызывает loadMessagesByUserId из‑за hasDialogId. */
        updateSession(sessionId, {
          selectedUsers: filteredUsers,
          selectedDialog: null,
          assignedDialogId: null,
          messages: [],
          hasHistoryLoaded: false,
          hasSentMessage: false,
          isDialogEnded: false,
          hasLoadedDialogs: false,
          lastSendError: null,
          transferRecipientFullName: null,
          pagination: {
            currentPage: 0,
            totalPages: 0,
            totalElements: 0,
            isLoadingMore: false,
            isLoadingNext: false,
            hasMoreMessages: false,
            hasNextMessages: false,
          },
        });
        initialLoadDoneRef.current = false;
        historyLoadAttemptedRef.current = false;
      }
    },
    [sessionId, updateSession, clearPendingAttachments, stableSetUnreadCount],
  );

  const handleUsersBlur = useCallback(() => {
    setLocalIsUsersTouched(true);
  }, []);

  const handleEndDialog = useCallback(() => {
    updateSession(sessionId, { isDialogEnded: true });
  }, [sessionId, updateSession]);

  const handleCheckExistingSession = useCallback(
    (userId: number): boolean => {
      const existingSession = findSessionByUserId(userId);

      if (existingSession && existingSession.id !== sessionId) {
        setActiveSessionId(existingSession.id);
        isSessionSwitchingRef.current = true;

        if (!existingSession.isMinimized) {
          toggleSessionMinimize(sessionId);
        }

        setTimeout(() => {
          isSessionSwitchingRef.current = false;
        }, 100);

        return true;
      }
      return false;
    },
    [
      sessionId,
      findSessionByUserId,
      toggleSessionMinimize,
      setActiveSessionId,
      removeEmptySessions,
    ],
  );

  const handleUserSelect = useCallback(
    (userId: number, userName: string, userData?: any) => {
      // userId === 0 означает "снятие выбора" — handleUsersChange уже очистил сессию, не перезаписывать
      if (userId === 0) return;

      updateSession(sessionId, {
        selectedUsers: [userId],
        selectedUserName: userName,
      });

      if (userData) {
        const newCache = new Map(session?.usersCache || new Map());
        newCache.set(userId, userData);
        updateSession(sessionId, { usersCache: newCache });
      }

      initialLoadDoneRef.current = false;
      historyLoadAttemptedRef.current = false;
    },
    [sessionId, updateSession, session?.usersCache],
  );

  const handleMinimize = useCallback(() => {
    if (onMinimize) {
      onMinimize();
    } else if (session?.selectedDialog?.id) {
      toggleSessionMinimize(sessionId);
      setActiveSessionId(null);
    } else {
      closeSession(sessionId);
    }
  }, [
    session?.selectedDialog?.id,
    sessionId,
    toggleSessionMinimize,
    onMinimize,
    setActiveSessionId,
    closeSession,
  ]);

  const handleCloseAllChats = useCallback(() => {
    sessions.forEach((s) => {
      closeSession(s.id);
    });
    setIsChatOpen(false);
  }, [sessions, closeSession, setIsChatOpen]);

  const updateUsersCache = useCallback(
    (users: any[]) => {
      const current = getSessionLiveRef.current(sessionId);
      const newCache = new Map(current?.usersCache || new Map());
      users.forEach((user) => {
        if (user && user.id) newCache.set(user.id, user);
      });
      updateSession(sessionId, { usersCache: newCache });
    },
    [sessionId, updateSession],
  );

  const handleMessageTextChange = useCallback(
    (text: string) => {
      updateSession(sessionId, { messageText: text });
    },
    [sessionId, updateSession],
  );

  const handleMessageSent = useCallback(() => {
    setLocalHasSentMessage(true);
    updateSession(sessionId, {
      hasSentMessage: true,
      messageText: '',
    });
    setReplyTarget(null);
    setAttachments([]);
    clearPendingAttachments(sessionId);
  }, [sessionId, updateSession, clearPendingAttachments]);

  const handleReplyToMessage = useCallback((message: any) => {
    setReplyTarget(message);
  }, []);

  const handleClearReply = useCallback(() => {
    setReplyTarget(null);
  }, []);

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const updatedMessages = (session?.messages || []).map((msg: any) =>
          msg.id === messageId ? { ...msg, isDeleted: true } : msg,
        );
        updateSession(sessionId, { messages: updatedMessages });
      } catch (error) {
        console.error('Error deleting message:', error);
      }
    },
    [sessionId, session?.messages, updateSession],
  );

  const handleEditMessage = useCallback(
    async (messageId: string, newText: string) => {
      try {
        const updatedMessages = (session?.messages || []).map((msg: any) =>
          msg.id === messageId
            ? {
                ...msg,
                text: newText,
                edited_at: new Date().toISOString(),
              }
            : msg,
        );
        updateSession(sessionId, { messages: updatedMessages });
      } catch (error) {
        console.error('Error editing message:', error);
      }
    },
    [sessionId, session?.messages, updateSession],
  );

  const handleAttachmentsChange = useCallback(
    (files: File[]) => {
      setAttachments(files);
      setPendingAttachments(sessionId, files);
    },
    [sessionId, setPendingAttachments],
  );

  const handleRemoveAttachment = useCallback(
    (index: number) => {
      const newAttachments = [...attachments];
      newAttachments.splice(index, 1);
      setAttachments(newAttachments);
      setPendingAttachments(sessionId, newAttachments);
    },
    [sessionId, attachments, setPendingAttachments],
  );

  const updateDialogStatus = useCallback(
    (status: string) => {
      setDialogStatus(status);
      if (session?.selectedDialog) {
        updateSession(sessionId, {
          ...(status === 'OPEN' ? { transferRecipientFullName: null } : {}),
          selectedDialog: {
            ...session.selectedDialog,
            status: status,
          },
        });
      }
    },
    [sessionId, updateSession, session?.selectedDialog],
  );

  const handleTransferToOperator = useCallback(
    async (targetOperatorId: number, pickedLabel: string) => {
      const live = getSession(sessionId);
      if (!live || isTransferLoading) return;

      const sel = live.selectedDialog;
      const rawDialogId = sel?.id;
      const assigned = live.assignedDialogId;
      const effectiveDialogId =
        rawDialogId != null && String(rawDialogId) !== '0'
          ? String(rawDialogId)
          : assigned != null &&
              String(assigned) !== '' &&
              String(assigned) !== '0' &&
              String(assigned) !== 'assigned'
            ? String(assigned)
            : '';

      const uid = authId != null ? Number(authId) : NaN;
      if (
        !effectiveDialogId ||
        effectiveDialogId === '0' ||
        targetOperatorId === uid ||
        !Number.isFinite(uid) ||
        !sel ||
        sel.id === '0'
      ) {
        return;
      }

      const effectiveStatus = String(sel.status || '').trim();
      if (effectiveStatus !== 'CLOSED') return;

      const lastOpId = getLastOperatorIdFromDialog(sel);
      if (lastOpId == null || Number(lastOpId) !== uid) return;

      setIsTransferLoading(true);
      try {
        const statusForTransfer = effectiveStatus || 'ACTIVE';
        const updated = await api.transferDialog(
          effectiveDialogId,
          targetOperatorId,
          statusForTransfer,
        );

        const sessionNow = getSession(sessionId);
        const baseDialog = sessionNow?.selectedDialog || {};
        const mergedDialog =
          updated && typeof updated === 'object'
            ? {
                ...baseDialog,
                ...updated,
                lastOperator: (updated as any).lastOperator ??
                  (updated as any).dialog?.lastOperator ?? { id: targetOperatorId },
              }
            : {
                ...baseDialog,
                lastOperator: { id: targetOperatorId },
              };

        const lo = mergedDialog.lastOperator as
          | { fullName?: string; firstName?: string; surname?: string }
          | undefined;
        const recipientName =
          lo?.fullName || [lo?.firstName, lo?.surname].filter(Boolean).join(' ') || pickedLabel;

        updateSession(sessionId, {
          selectedDialog: mergedDialog as any,
          assignedDialogId: mergedDialog.id != null ? String(mergedDialog.id) : effectiveDialogId,
          hasLoadedDialogs: true,
          lastSendError: null,
          transferRecipientFullName: recipientName || null,
        });
      } catch (error) {
        console.error('Ошибка передачи диалога:', error);
      } finally {
        setIsTransferLoading(false);
      }
    },
    [isTransferLoading, authId, sessionId, getSession, updateSession],
  );

  const handleMarkMessagesAsRead = useCallback(
    (messageIds: string[]) => {
      if (messageIds.length > 0) {
        operatorUnreadDebug('READ на бэк + локальное обновление ленты', {
          sessionId,
          messageIds,
        });
        messageIds.forEach((messageId) => {
          sendReadStatusForMessageId(sessionId, messageId);
        });

        const liveSession = getSession(sessionId);
        const idSet = new Set(messageIds);
        const updatedMessages = (liveSession?.messages || []).map((msg: any) =>
          idSet.has(String(msg.id)) || idSet.has(String(msg.uuid))
            ? { ...msg, is_read: true, confirmStatus: 'READ' }
            : msg,
        );
        updateSession(sessionId, { messages: updatedMessages });

        const activeDialogId =
          liveSession?.selectedDialog?.id && String(liveSession.selectedDialog.id) !== '0'
            ? String(liveSession.selectedDialog.id)
            : liveSession?.assignedDialogId &&
                String(liveSession.assignedDialogId) !== '' &&
                String(liveSession.assignedDialogId) !== '0' &&
                String(liveSession.assignedDialogId) !== 'assigned'
              ? String(liveSession.assignedDialogId)
              : null;
        if (activeDialogId) {
          const nextUnread = updatedMessages.reduce((acc: number, msg: any) => {
            if (String(msg.dialogId ?? msg.dialog?.id ?? '') !== activeDialogId) return acc;
            if (msg.messageStatus !== 'TO_OPERATOR') return acc;
            if (msg.is_read) return acc;
            if (String(msg.confirmStatus ?? '').toUpperCase() === 'READ') return acc;
            return acc + 1;
          }, 0);
          stableSetUnreadCount(nextUnread);
          updateSession(sessionId, { unreadCount: nextUnread });
          const activeDialogNumericId = Number(activeDialogId);
          if (Number.isFinite(activeDialogNumericId)) {
            // Локально отправили READ: сразу синхронизируем per-dialog счётчик в socket-карте,
            // чтобы исключить редкий "залипший +1" до прихода следующего WS-кадра.
            updateDialogUnreadCount(activeDialogNumericId, nextUnread);
          }
        }
      }
    },
    [
      sessionId,
      sendReadStatusForMessageId,
      getSession,
      updateSession,
      stableSetUnreadCount,
      updateDialogUnreadCount,
    ],
  );

  const activeDialogNumericId = useMemo(() => {
    if (!resolvedFeedDialogIdStr) return NaN;
    const n = Number(resolvedFeedDialogIdStr);
    return Number.isFinite(n) ? n : NaN;
  }, [resolvedFeedDialogIdStr]);

  const feedUnreadFromMessages = useMemo(() => {
    if (!session?.messages?.length || !resolvedFeedDialogIdStr) return 0;
    const activeSid = resolvedFeedDialogIdStr;
    const msgs = session.messages.filter(
      (msg: any) => String(msg.dialogId ?? msg.dialog?.id ?? '') === activeSid,
    );
    const strict = msgs.reduce((acc: number, msg: any) => {
      if (String(msg.confirmStatus ?? '').toUpperCase() === 'READ') return acc;
      if (
        msg.messageStatus === 'TO_OPERATOR' &&
        (msg.confirmStatus === 'SENT' || msg.confirmStatus === 'DELIVERED') &&
        !msg.is_read
      ) {
        return acc + 1;
      }
      return acc;
    }, 0);
    const relaxed = msgs.reduce((acc: number, msg: any) => {
      if (String(msg.confirmStatus ?? '').toUpperCase() === 'READ') return acc;
      if (msg.messageStatus === 'TO_OPERATOR' && !msg.is_read) return acc + 1;
      return acc;
    }, 0);
    return Math.max(strict, relaxed);
  }, [session, resolvedFeedDialogIdStr]);

  const socketEntry = Number.isFinite(activeDialogNumericId)
    ? dialogsUnreadCounts.get(activeDialogNumericId)
    : undefined;

  const displayUnreadCount = session
    ? Math.max(unreadCount, session.unreadCount ?? 0, socketEntry ?? 0, feedUnreadFromMessages)
    : 0;

  useEffect(() => {
    if (!session) return;
    if (headerUnreadLogRef.current === displayUnreadCount) return;
    headerUnreadLogRef.current = displayUnreadCount;
    operatorUnreadDebug('Шапка открытого чата: бейдж непрочитанных', {
      sessionId,
      dialogId: Number.isFinite(activeDialogNumericId) ? activeDialogNumericId : null,
      показываем: displayUnreadCount,
      локальныйСтейтПанели: unreadCount,
      sessionUnreadCount: session.unreadCount,
      wsКартаПоДиалогу: socketEntry ?? null,
      подсчётПоСообщениям: feedUnreadFromMessages,
    });
  }, [
    session,
    sessionId,
    displayUnreadCount,
    unreadCount,
    socketEntry,
    feedUnreadFromMessages,
    activeDialogNumericId,
  ]);

  if (!session) return null;

  const {
    selectedDialog,
    messages,
    isMinimized,
    selectedUsers,
    selectedUserName,
    messageText,
    usersCache,
    isDialogEnded,
    isSendingMessage,
    lastSendError,
    assignedDialogId,
    transferRecipientFullName = null,
  } = session;

  // Скролл к первому непрочитанному в MessageFeed: флаг scrollToBottomOnExpand.
  // ChatFooter передаёт true только когда панель только что развернули из минимизации;
  // в остальных случаях автоскролл по новым входящим не должен запускаться.
  const shouldScrollToFirstUnreadOnExpand = useMemo(() => {
    return Boolean(scrollToBottomOnExpand);
  }, [scrollToBottomOnExpand]);

  useEffect(() => {
    operatorUnreadDebug('ChatPanel → MessageFeed: флаг скролла к непрочитанным', {
      sessionId,
      shouldScrollToFirstUnreadOnExpand,
      displayUnreadCount,
      пропОтChatFooter: scrollToBottomOnExpand,
    });
  }, [sessionId, shouldScrollToFirstUnreadOnExpand, displayUnreadCount, scrollToBottomOnExpand]);

  if (isMinimized) {
    return (
      <div className={styles.minimizedPanel}>
        <div className={styles.minimizedHeader} onClick={() => toggleSessionMinimize(sessionId)}>
          <h3>
            {selectedUserName || selectedDialog?.client_name || t('chat.dialogTitleFallback')}
          </h3>
          {displayUnreadCount > 0 && (
            <span className={styles.unreadBadgeMinimized}>
              {displayUnreadCount > 99 ? '99+' : displayUnreadCount}
            </span>
          )}
          <IconButton
            title={t('chat.minimizeDialog')}
            onClick={(e) => {
              e.stopPropagation();
              toggleSessionMinimize(sessionId);
            }}>
            <Minimize />
          </IconButton>
        </div>
      </div>
    );
  }

  const hasExistingDialog =
    (selectedDialog?.id != null && String(selectedDialog.id) !== '0') ||
    (assignedDialogId != null &&
      String(assignedDialogId) !== '' &&
      String(assignedDialogId) !== '0' &&
      String(assignedDialogId) !== 'assigned');

  /** id диалога для действий (в т.ч. transfer), если в selectedDialog ещё не проставлен */
  const resolvedDialogIdForActions =
    selectedDialog?.id != null && String(selectedDialog.id) !== '0'
      ? String(selectedDialog.id)
      : assignedDialogId != null &&
          String(assignedDialogId) !== '' &&
          String(assignedDialogId) !== 'assigned'
        ? String(assignedDialogId)
        : '0';

  const dialogStatusEffective = String(selectedDialog?.status || dialogStatus || '');
  const lastOpIdForTransfer = getLastOperatorIdFromDialog(selectedDialog);
  const uidNum = authId != null ? Number(authId) : NaN;
  const canTransferDialog =
    selectedUsers.length > 0 &&
    !!hasExistingDialog &&
    dialogStatusEffective === 'CLOSED' &&
    lastOpIdForTransfer != null &&
    Number.isFinite(uidNum) &&
    Number(lastOpIdForTransfer) === uidNum;

  const showTransferSection =
    selectedUsers.length > 0 &&
    resolvedDialogIdForActions !== '0' &&
    dialogStatusEffective === 'CLOSED';

  const blockingOperatorLo =
    selectedDialog?.lastOperator ??
    selectedDialog?.dialog?.lastOperator ??
    selectedDialog?.last_operator;
  const blockingOperatorDisplay =
    blockingOperatorLo &&
    (blockingOperatorLo.fullName ||
      [blockingOperatorLo.firstName, blockingOperatorLo.surname].filter(Boolean).join(' ').trim() ||
      (blockingOperatorLo.id != null ? t('chat.userWithId', { id: blockingOperatorLo.id }) : ''));

  return (
    <div className={styles.panel} data-session-id={sessionId}>
      <div className={styles.chatHeader}>
        <h3>{selectedUserName || selectedDialog?.client_name || t('chat.dialogTitleFallback')}</h3>
        {displayUnreadCount > 0 && (
          <span className={styles.unreadBadge}>
            {displayUnreadCount > 99 ? '99+' : displayUnreadCount}
          </span>
        )}
        <div className={styles.headerActions}>
          <IconButton size="small" onClick={handleMinimize} title={t('chat.minimizeDialog')}>
            <Minimize fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={handleCloseAllChats} title={t('chat.closeDialog')}>
            <Close fontSize="small" />
          </IconButton>
        </div>
      </div>

      <div className={styles.usersSelectContainer}>
        <UsersSelect
          selectedUsers={selectedUsers}
          onUsersChange={handleUsersChange}
          onUserSelect={handleUserSelect}
          isTouched={localIsUsersTouched}
          onBlur={handleUsersBlur}
          disabled={dialogStatus === 'ACTIVE' || dialogStatus === 'CLOSED'}
          usersCache={usersCache}
          onUpdateUsersCache={updateUsersCache}
          onCheckExistingSession={handleCheckExistingSession}
          displayUserName={getDisplayUserName()}
        />
        {showTransferSection ? (
          <div className={styles.transferRow}>
            {transferRecipientFullName && !canTransferDialog ? (
              <Box
                sx={{
                  mt: 1.5,
                  p: 1.25,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(144, 202, 249, 0.45)'
                      : theme.palette.primary.light,
                  bgcolor:
                    theme.palette.mode === 'dark'
                      ? 'rgba(144, 202, 249, 0.1)'
                      : 'rgba(25, 118, 210, 0.08)',
                }}>
                <Typography
                  variant="body2"
                  sx={{
                    lineHeight: 1.4,
                    color:
                      theme.palette.mode === 'dark'
                        ? theme.palette.primary.light
                        : theme.palette.primary.dark,
                  }}>
                  {t('chat.dialogTransferredToOperator', {
                    fullName: transferRecipientFullName,
                  })}
                </Typography>
              </Box>
            ) : (
              <TransferOperatorSelect
                disabled={isTransferLoading || !canTransferDialog}
                selectionResetKey={`${resolvedDialogIdForActions}-${selectedUsers[0] ?? ''}`}
                onOperatorSelected={(id, label) => void handleTransferToOperator(id, label)}
              />
            )}
          </div>
        ) : null}
      </div>

      <div className={styles.dialogActionsContainer}>
        {selectedUsers.length > 0 && (
          <DialogActions
            sessionId={sessionId}
            userId={selectedUsers[0]}
            dialogId={resolvedDialogIdForActions}
            hasExistingDialog={hasExistingDialog}
            onDialogStatusChange={updateDialogStatus}
            dialogData={selectedDialog}
            onBlockedStateChange={setIsDialogReallyBlocked}
          />
        )}
      </div>

      <div className={styles.messageFeedContainer}>
        <MessageFeed
          sessionId={sessionId}
          messages={messages}
          onReplyToMessage={handleReplyToMessage}
          onDeleteMessage={handleDeleteMessage}
          onEditMessage={handleEditMessage}
          attachments={attachments}
          onRemoveAttachment={handleRemoveAttachment}
          userId={selectedUsers[0]}
          selectedUserName={selectedUserName}
          onMarkMessagesAsRead={handleMarkMessagesAsRead}
          unreadCount={feedUnreadFromMessages}
          expandUnreadHintCount={displayUnreadCount}
          scrollToBottomOnExpand={shouldScrollToFirstUnreadOnExpand}
          onScrollToBottomDone={onScrollToBottomDone}
          dialogStatus={dialogStatus}
          isDialogBlockedByOtherOperator={isDialogReallyBlocked}
          isDialogEnded={isDialogEnded}
        />
      </div>

      <div className={styles.messageInputContainer}>
        <MessageInput
          selectedUsers={selectedUsers}
          isUsersTouched={localIsUsersTouched}
          onUsersBlur={handleUsersBlur}
          onMessageSent={handleMessageSent}
          onEndDialog={handleEndDialog}
          isDialogEnded={isDialogEnded}
          clearInput={localClearMessageInput}
          onClearComplete={() => setLocalClearMessageInput(false)}
          initialText={messageText}
          onTextChange={handleMessageTextChange}
          sessionId={sessionId}
          replyTarget={replyTarget}
          onClearReply={handleClearReply}
          onAttachmentsChange={handleAttachmentsChange}
          attachments={attachments}
          isSendingMessage={isSendingMessage}
          lastSendError={lastSendError}
          dialogStatus={dialogStatus}
          isDialogBlockedByOtherOperator={isDialogReallyBlocked}
          blockingOperatorLabel={
            isDialogReallyBlocked ? blockingOperatorDisplay || undefined : undefined
          }
        />
      </div>
    </div>
  );
}

export default ChatPanel;
