/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useState } from 'react';

import { UsersApi } from '@shared/api/baseQuerys';
import { appStore } from '@shared/model/app_store/AppStore';

import api from '../../api';
import { stompDebugLog } from '../../lib/stompDebugLog';
import { useSocket } from '../SocketContext';

export const useChatMessages = (
  sessions: any[],
  activeSessionId: string | null,
  updateSession: (sessionId: string, updates: any) => void,
  getSession: (sessionId: string) => any,
) => {
  const { stompClient, isConnected, connectionStatus } = useSocket();
  const [responseTimers, setResponseTimers] = useState<Map<string, NodeJS.Timeout[]>>(new Map());
  const [processedUserMessageIds, setProcessedUserMessageIds] = useState<Map<string, number[]>>(
    new Map(),
  );
  const [sendTimeouts, setSendTimeouts] = useState<Map<string, NodeJS.Timeout>>(new Map());

  const generateUUID = useCallback((): string => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }, []);

  const sendMessageStatus = useCallback(
    (uuid: string, status: 'DELIVERED' | 'READ'): boolean => {
      if (!stompClient || !stompClient.connected) {
        api.sendDeliveryConfirm(uuid, status).catch(() => {});
        return true;
      }

      const success = api.sendDeliveryConfirmWS(stompClient, uuid, status);
      if (!success) {
        api.sendDeliveryConfirm(uuid, status).catch(() => {});
      }
      return success;
    },
    [stompClient],
  );

  const scrollToBottom = useCallback((sessionId: string) => {
    setTimeout(() => {
      const container = document.querySelector(`[data-session-id="${sessionId}"] .feed`);
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
  }, []);

  const clearMessages = useCallback(
    (sessionId: string) => {
      const timers = responseTimers.get(sessionId) || [];
      timers.forEach((timer) => clearTimeout(timer));

      const newTimers = new Map(responseTimers);
      newTimers.set(sessionId, []);
      setResponseTimers(newTimers);

      const newProcessed = new Map(processedUserMessageIds);
      newProcessed.set(sessionId, []);
      setProcessedUserMessageIds(newProcessed);

      updateSession(sessionId, {
        messages: [],
        uploadedAttachments: [],
        lastSendError: null,
      });
    },
    [responseTimers, processedUserMessageIds, updateSession],
  );

  const getCurrentUserInfo = useCallback(() => {
    const storeState = appStore.getState();
    const userId = storeState.authId;
    const fullNameFromStore = storeState.fullName;
    const emailFromStore = storeState.email || '';

    let userFullName = fullNameFromStore;
    let displayName = 'Оператор';

    if (userFullName && userFullName.trim() !== '') {
      displayName = userFullName;
    } else {
      const fullNameFromLocalStorage = localStorage.getItem('userFullName');
      if (fullNameFromLocalStorage && fullNameFromLocalStorage.trim() !== '') {
        userFullName = fullNameFromLocalStorage;
        displayName = fullNameFromLocalStorage;
      }
    }

    return {
      id: userId,
      email: emailFromStore,
      isAdmin: storeState.isAdmin || false,
      fullName: userFullName || displayName,
      displayName: displayName,
      branchId: storeState.selectedBranchState?.id,
      branchName: storeState.selectedBranchState?.name,
    };
  }, []);

  const sendMessage = useCallback(
    async (sessionId: string, value: any, onSuccess: () => void, onError: (err: any) => void) => {
      const session = getSession(sessionId);
      if (!session) return;

      if (session.isSendingMessage) {
        return;
      }

      updateSession(sessionId, {
        isSendingMessage: true,
        lastSendError: null,
      });

      const messageUuid = generateUUID();
      let localMessageAdded = false;

      try {
        const textIsEmpty = !value.text?.trim()?.length;
        const hasAttachments = value.attachments && value.attachments.length > 0;

        if (textIsEmpty && !hasAttachments) {
          throw new Error('Сообщение не может быть пустым');
        }

        let pathsToAttaches: string[] = [];

        if (hasAttachments) {
          try {
            const uploadResponse = await api.uploadAttachments(value.attachments);
            pathsToAttaches = uploadResponse.attachmentIds || [];
          } catch (uploadError: any) {
            console.error('❌ Детальная ошибка загрузки вложений:', {
              message: uploadError.message,
              stack: uploadError.stack,
              files: value.attachments.map((f: File) => f.name),
            });
            throw new Error(`Ошибка загрузки вложений: ${uploadError.message}`);
          }
        }

        let dialogId = session.assignedDialogId || session.selectedDialog?.id;

        if (!dialogId || dialogId === '0') {
          if (session.selectedUsers.length > 0) {
            const userId = session.selectedUsers[0];
            try {
              const dialogsResponse = await api.getAllDialogs();
              let dialogsArray: any[] = [];
              if (Array.isArray(dialogsResponse)) {
                dialogsArray = dialogsResponse;
              } else if (dialogsResponse && Array.isArray((dialogsResponse as any).data)) {
                dialogsArray = (dialogsResponse as any).data;
              } else if (dialogsResponse && Array.isArray((dialogsResponse as any).content)) {
                dialogsArray = (dialogsResponse as any).content;
              } else if (dialogsResponse && typeof dialogsResponse === 'object') {
                const possibleArrays = Object.values(dialogsResponse).filter(Array.isArray);
                if (possibleArrays.length > 0) {
                  dialogsArray = possibleArrays[0];
                }
              }

              const userDialog = dialogsArray.find(
                (d: any) =>
                  d.owner?.id === userId || d.userId === userId || d.client?.id === userId,
              );

              if (userDialog?.id) {
                dialogId = userDialog.id.toString();
                updateSession(sessionId, {
                  assignedDialogId: dialogId,
                  selectedDialog: userDialog,
                });
              } else {
                dialogId = '0';
              }
            } catch (error) {
              dialogId = '0';
            }
          } else {
            dialogId = '0';
          }
        }

        const finalDialogId = dialogId || '0';

        const stompMessage = {
          recipientId: session.selectedUsers[0].toString(),
          uuid: messageUuid,
          text: value.text || '',
          dialogId: finalDialogId,
          pathsToAttaches: pathsToAttaches.length > 0 ? pathsToAttaches : undefined,
          replyToMessageId: value.replyTo || undefined,
        };

        const cleanStompMessage = JSON.parse(JSON.stringify(stompMessage));

        if (!stompClient || !stompClient.connected) {
          stompDebugLog('sendMessage blocked: STOMP not ready', {
            hasStompClient: Boolean(stompClient),
            stompConnected: stompClient?.connected === true,
            contextIsConnected: isConnected,
            connectionStatus,
            dialogId: finalDialogId,
          });
          throw new Error('STOMP клиент не подключен');
        }

        const sendResult = stompClient.publish({
          destination: '/app/chat.send',
          body: JSON.stringify(cleanStompMessage),
          headers: {
            'content-type': 'application/json',
          },
        });

        if (sendResult === false) {
          stompDebugLog('sendMessage blocked: stompClient.publish returned false', {
            destination: '/app/chat.send',
            stompConnected: stompClient.connected,
            connectionStatus,
          });
          throw new Error('Не удалось отправить сообщение через STOMP');
        }

        const currentUserInfo = getCurrentUserInfo();

        const localMessage = {
          id: messageUuid,
          uuid: messageUuid,
          text: value.text,
          created_at: new Date().toISOString(),
          is_read: false,
          sender: 'user',
          messageStatus: 'TO_USER',
          confirmStatus: 'SENT',
          attachments:
            value.attachments && value.attachments.length > 0
              ? value.attachments.map((file: File, i: number) => {
                  const fileName = pathsToAttaches[i] || file.name;
                  return {
                    id: fileName,
                    type: 'image',
                    name: file.name,
                    fileName,
                    url: URL.createObjectURL(file),
                    size: file.size,
                  };
                })
              : [],
          replyTo: value.replyTo || null,
          recipientId: session.selectedUsers[0],
          isPending: true,
          senderInfo: {
            id: currentUserInfo.id,
            email: currentUserInfo.email,
            isAdmin: currentUserInfo.isAdmin,
            fullName: currentUserInfo.fullName,
            displayName: currentUserInfo.displayName,
            ...(currentUserInfo.branchId && {
              branchId: currentUserInfo.branchId,
              branchName: currentUserInfo.branchName,
            }),
          },
          createdBy: currentUserInfo.id,
          dialogId: finalDialogId,
        };
        updateSession(sessionId, {
          messages: [...session.messages, localMessage],
          hasSentMessage: true,
          isSendingMessage: false,
        });
        localMessageAdded = true;

        scrollToBottom(sessionId);

        onSuccess();
      } catch (err) {
        if (localMessageAdded) {
          const currentSession = getSession(sessionId);
          if (currentSession) {
            const filteredMessages = currentSession.messages.filter(
              (msg: any) => msg.id !== messageUuid,
            );
            updateSession(sessionId, {
              messages: filteredMessages,
            });
          }
        }

        updateSession(sessionId, {
          isSendingMessage: false,
          lastSendError: err instanceof Error ? err.message : 'Неизвестная ошибка',
        });

        const timeout = setTimeout(() => {
          updateSession(sessionId, { lastSendError: null });
        }, 10000);

        const newSendTimeouts = new Map(sendTimeouts);
        newSendTimeouts.set(sessionId, timeout);
        setSendTimeouts(newSendTimeouts);

        onError(err);
      }
    },
    [
      getSession,
      updateSession,
      stompClient,
      isConnected,
      connectionStatus,
      sendTimeouts,
      generateUUID,
      getCurrentUserInfo,
      scrollToBottom,
    ],
  );

  const getUserFullName = useCallback((userData: any) => {
    return (
      userData?.fullName ||
      [userData?.firstName, userData?.middleName, userData?.surname].filter(Boolean).join(' ') ||
      userData?.email?.split('@')[0] ||
      `Пользователь ${userData?.id}`
    );
  }, []);

  const fetchUserInfo = useCallback(async (userId: number) => {
    try {
      const currentUserId = appStore.getState().authId;
      const isAdmin = currentUserId === 1;

      const options = {
        searchQuery: userId.toString(),
        limit: 1,
        filterOptions: {
          forChat: true,
          ...(isAdmin ? { isAdmin: true } : {}),
        },
        excludeDisabledUsers: true,
        isAttachment: true,
      };

      const response = await UsersApi.getListToAttachments(options, false);
      if (Array.isArray(response.data) && response.data.length > 0) {
        return response.data[0];
      }
      return null;
    } catch (error) {
      return null;
    }
  }, []);

  const refreshDialogs = useCallback(
    (sessionId: string) => {
      const session = getSession(sessionId);
      if (session && session.selectedUsers.length > 0) {
        updateSession(sessionId, { hasLoadedDialogs: false });
      }
    },
    [getSession, updateSession],
  );

  return {
    sendMessage,
    clearMessages,
    refreshDialogs,
    getUserFullName,
    fetchUserInfo,
    responseTimers,
    processedUserMessageIds,
    sendTimeouts,
    setResponseTimers,
    setProcessedUserMessageIds,
    setSendTimeouts,
    sendMessageStatus,
  };
};
