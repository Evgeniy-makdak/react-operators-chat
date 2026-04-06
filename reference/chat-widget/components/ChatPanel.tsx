import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Close, Minimize } from '@mui/icons-material';
import { IconButton } from '@mui/material';

import api from '../api';
import { useChat } from '../contexts/ChatContext';
import { useSocket } from '../contexts/SocketContext';
import styles from './ChatPanel.module.scss';
import { DialogActions } from './DialogActions';
import MessageFeed from './MessageFeed';
import MessageInput from './MessageInput';
import UsersSelect from './UsersSelect';

interface ChatPanelProps {
  sessionId: string;
  onMinimize?: () => void;
  scrollToBottomOnExpand?: boolean;
  onScrollToBottomDone?: () => void;
}

function ChatPanel({
  sessionId,
  onMinimize,
  scrollToBottomOnExpand,
  onScrollToBottomDone,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const { dialogsUnreadCounts } = useSocket();
  const {
    closeSession,
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

  const isUpdatingRef = useRef(false);
  const prevSessionIdRef = useRef<string>(sessionId);
  const lastMessageCountRef = useRef<number>(0);
  const lastStableUnreadCountRef = useRef<number>(0);
  const unreadCountDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadDoneRef = useRef(false);
  const historyLoadAttemptedRef = useRef(false);
  const refreshAfterReadTriggeredRef = useRef(false);
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

    unreadCountDebounceRef.current = setTimeout(() => {
      if (newCount !== lastStableUnreadCountRef.current) {
        setUnreadCount(newCount);
        lastStableUnreadCountRef.current = newCount;
      }
      unreadCountDebounceRef.current = null;
    }, 150);
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
        const activeSid =
          session.selectedDialog?.id && String(session.selectedDialog.id) !== '0'
            ? String(session.selectedDialog.id)
            : session.assignedDialogId &&
                String(session.assignedDialogId) !== '0' &&
                String(session.assignedDialogId) !== 'assigned'
              ? String(session.assignedDialogId)
              : null;
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
      refreshAfterReadTriggeredRef.current = false;
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
        loadDialogHistory(sessionId, session.selectedDialog.id).then(() => {
          // После загрузки истории прокручиваем вниз
          setTimeout(() => {
            const messageFeed = document.querySelector(
              `[data-session-id="${sessionId}"] .${styles.feed}`,
            );
            if (messageFeed) {
              messageFeed.scrollTop = messageFeed.scrollHeight;
            }
          }, 100);
        });
      } else if (isDialogOpen && !hasDialogId) {
        loadMessagesByUserId(sessionId, userId)
          .catch(console.error)
          .finally(() => {
            // После загрузки сообщений прокручиваем вниз
            setTimeout(() => {
              const messageFeed = document.querySelector(
                `[data-session-id="${sessionId}"] .${styles.feed}`,
              );
              if (messageFeed) {
                messageFeed.scrollTop = messageFeed.scrollHeight;
              }
            }, 100);
          });
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

            updateSession(sessionId, {
              selectedDialog: {
                ...session.selectedDialog,
                status: dialogDetails.status,
                lastOperator: dialogDetails.lastOperator,
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
        refreshAfterReadTriggeredRef.current = false;
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
        refreshAfterReadTriggeredRef.current = false;
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
      refreshAfterReadTriggeredRef.current = false;
    },
    [sessionId, updateSession, session?.usersCache],
  );

  const handleMinimize = useCallback(() => {
    if (onMinimize) {
      onMinimize();
    } else {
      toggleSessionMinimize(sessionId);
      setActiveSessionId(null);
    }
  }, [sessionId, toggleSessionMinimize, onMinimize, setActiveSessionId]);

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
          selectedDialog: {
            ...session.selectedDialog,
            status: status,
          },
        });
      }
    },
    [sessionId, updateSession, session?.selectedDialog],
  );

  const handleMarkMessagesAsRead = useCallback(
    (messageIds: string[]) => {
      if (messageIds.length > 0) {
        messageIds.forEach((messageId) => {
          sendReadStatusForMessageId(sessionId, messageId);
        });

        if (!refreshAfterReadTriggeredRef.current) {
          refreshAfterReadTriggeredRef.current = true;
          const idSet = new Set(messageIds);
          const updatedMessages = (session?.messages || []).map((msg: any) =>
            idSet.has(String(msg.id)) || idSet.has(String(msg.uuid))
              ? { ...msg, is_read: true, confirmStatus: 'READ' }
              : msg,
          );

          updateSession(sessionId, { messages: updatedMessages });

          setTimeout(() => {
            refreshAfterReadTriggeredRef.current = false;
          }, 5000);
        }
      }
    },
    [sessionId, sendReadStatusForMessageId, session?.messages, updateSession],
  );

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
  } = session;

  const activeDialogNumericId =
    selectedDialog?.id != null && String(selectedDialog.id) !== '0'
      ? Number(selectedDialog.id)
      : assignedDialogId != null &&
          String(assignedDialogId) !== '0' &&
          String(assignedDialogId) !== 'assigned'
        ? Number(assignedDialogId)
        : NaN;
  const socketEntry = Number.isFinite(activeDialogNumericId)
    ? dialogsUnreadCounts.get(activeDialogNumericId)
    : undefined;
  /**
   * Локальная лента может отставать от WS; обычно max(local, socket).
   * Явный 0 в карте после прочтения — не держим «1» из устаревшего msg.is_read.
   */
  const displayUnreadCount =
    socketEntry === 0 ? 0 : Math.max(unreadCount, session.unreadCount ?? 0, socketEntry ?? 0);

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

  const hasExistingDialog = selectedDialog && selectedDialog.id !== '0';

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
          <IconButton
            size="small"
            onClick={() => closeSession(sessionId)}
            title={t('chat.closeDialog')}>
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
      </div>

      <div className={styles.dialogActionsContainer}>
        {selectedUsers.length > 0 && (
          <DialogActions
            sessionId={sessionId}
            userId={selectedUsers[0]}
            dialogId={selectedDialog?.id || '0'}
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
          unreadCount={displayUnreadCount}
          scrollToBottomOnExpand={scrollToBottomOnExpand}
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
        />
      </div>
    </div>
  );
}

export default ChatPanel;
