/* eslint-disable prettier/prettier */

/* eslint-disable @typescript-eslint/no-explicit-any */

/* eslint-disable no-console */
import { useCallback } from 'react';

import { ChatRefs } from './useChatRefs';

interface StatusHandlersDeps {
  getSession: (sessionId: string) => any;
  updateSession: (sessionId: string, updates: any) => void;
  sendMessageStatus: (uuid: string, status: string) => boolean;
  recalculateSessionUnreadCount?: (sessionId: string, dialogId?: string) => void;
}

export const useChatStatusHandlers = (refs: ChatRefs, deps: StatusHandlersDeps) => {
  const { getSession, updateSession, sendMessageStatus, recalculateSessionUnreadCount } = deps;
  const {
    statusSendingInProgressRef,
    processedReadStatusesRef,
    readStatusTimestampsRef,
    failedStatusAttemptsRef,
    deliveredStatusesRef,
    deliveredSendingInProgressRef,
    lastDeliveredSendTimeRef,
    processedDeliveryConfirmsRef,
    readStatusOnOpenSendingRef,
    pendingReadAfterDeliveredConfirmRef,
    deliveredConfirmedByBackendRef,
  } = refs;

  const sendDeliveredStatusForMessage = useCallback(
    (sessionId: string, messageUuid: string) => {
      const sendKey = `DELIVERED_${messageUuid}`;

      if (statusSendingInProgressRef.current.has(sendKey)) {
        return false;
      }

      const session = getSession(sessionId);
      if (!session) {
        return false;
      }

      const message = session.messages.find((msg: any) => msg.uuid === messageUuid);
      if (!message) {
        return false;
      }

      // Проверяем реальный статус сообщения, а не ref
      if (message.confirmStatus !== 'SENT') {
        return false;
      }

      statusSendingInProgressRef.current.add(sendKey);

      const sendResult = sendMessageStatus(messageUuid, 'DELIVERED');

      if (sendResult) {
        deliveredStatusesRef.current.add(messageUuid);

        const updatedMessages = session.messages.map((msg: any) =>
          msg.uuid === messageUuid ? { ...msg, confirmStatus: 'DELIVERED' } : msg,
        );
        updateSession(sessionId, { messages: updatedMessages });

        setTimeout(() => {
          statusSendingInProgressRef.current.delete(sendKey);
        }, 5000);
        return true;
      } else {
        statusSendingInProgressRef.current.delete(sendKey);
        return false;
      }
    },
    [getSession, updateSession, sendMessageStatus],
  );

  const sendReadStatusForMessage = useCallback(
    (sessionId: string, message: any, forceImmediate: boolean = false) => {
      const messageUuid = message.uuid;
      if (!messageUuid) {
        return;
      }

      const sendKey = `READ_${messageUuid}`;
      const now = Date.now();

      if (statusSendingInProgressRef.current.has(sendKey)) return;

      if (processedReadStatusesRef.current.has(messageUuid)) {
        const session = getSession(sessionId);
        if (session) {
          const currentMessage = session.messages.find((msg: any) => msg.uuid === messageUuid);
          if (currentMessage && currentMessage.confirmStatus !== 'READ') {
            const updatedMessages = session.messages.map((msg: any) =>
              msg.uuid === messageUuid ? { ...msg, confirmStatus: 'READ', is_read: true } : msg,
            );
            updateSession(sessionId, { messages: updatedMessages });
          }
        }
        return;
      }

      const lastSendTime = readStatusTimestampsRef.current.get(messageUuid);
      if (lastSendTime && now - lastSendTime < 5000 && !forceImmediate) return;

      if (message.confirmStatus === 'READ') return;

      if (message.messageStatus !== 'TO_OPERATOR') return;

      const session = getSession(sessionId);
      if (!session) return;

      const currentMessage = session.messages.find((msg: any) => msg.uuid === messageUuid);
      if (!currentMessage) return;

      const currentAttempts = failedStatusAttemptsRef.current.get(sendKey) || 0;
      if (currentAttempts >= 3 && !forceImmediate) return;

      // Обновляем локально сразу, чтобы пользователь видел статус READ
      processedReadStatusesRef.current.add(messageUuid);
      statusSendingInProgressRef.current.add(sendKey);
      readStatusTimestampsRef.current.set(messageUuid, now);

      // Сначала обновляем локально
      const updatedMessages = session.messages.map((msg: any) =>
        msg.uuid === messageUuid ? { ...msg, confirmStatus: 'READ', is_read: true } : msg,
      );
      updateSession(sessionId, { messages: updatedMessages });

      const sendResult = sendMessageStatus(messageUuid, 'READ');

      if (sendResult && recalculateSessionUnreadCount) {
        const dialogId = message.dialog?.id?.toString() || message.dialogId?.toString();
        setTimeout(() => recalculateSessionUnreadCount(sessionId, dialogId), 150);
      }

      if (sendResult) {
        failedStatusAttemptsRef.current.delete(sendKey);

        const readSendKey = `SENT_READ_${messageUuid}`;
        localStorage.setItem(readSendKey, now.toString());

        pendingReadAfterDeliveredConfirmRef.current.delete(messageUuid);

        setTimeout(() => {
          statusSendingInProgressRef.current.delete(sendKey);
        }, 5000);
      } else {
        processedReadStatusesRef.current.delete(messageUuid);
        failedStatusAttemptsRef.current.set(sendKey, currentAttempts + 1);
        statusSendingInProgressRef.current.delete(sendKey);

        // Откатываем локальное изменение если отправка не удалась
        const rollbackMessages = session.messages.map((msg: any) =>
          msg.uuid === messageUuid
            ? {
                ...msg,
                confirmStatus: currentMessage.confirmStatus,
                is_read: currentMessage.is_read,
              }
            : msg,
        );
        updateSession(sessionId, { messages: rollbackMessages });

        if (currentAttempts + 1 < 3 || forceImmediate) {
          setTimeout(
            () => {
              const currentSession = getSession(sessionId);
              if (currentSession) {
                const msg = currentSession.messages.find((m: any) => m.uuid === messageUuid);
                if (msg && msg.messageStatus === 'TO_OPERATOR' && msg.confirmStatus !== 'READ') {
                  if (!statusSendingInProgressRef.current.has(sendKey)) {
                    sendReadStatusForMessage(sessionId, msg, true);
                  }
                }
              }
            },
            forceImmediate ? 100 : 1000 + currentAttempts * 500,
          );
        }
      }
    },
    [getSession, updateSession, sendMessageStatus],
  );

  const sendReadStatusesForSession = useCallback(
    (sessionId: string) => {
      const session = getSession(sessionId);
      if (!session || !session.messages || session.messages.length === 0) {
        return;
      }

      const dialogStatus = session.selectedDialog?.status;
      if (!dialogStatus) {
        return;
      }

      const unreadMessages = session.messages.filter((msg: any) => {
        if (msg.messageStatus !== 'TO_OPERATOR') {
          return false;
        }
        if (msg.confirmStatus === 'READ') {
          return false;
        }
        if (msg.confirmStatus !== 'DELIVERED' && msg.confirmStatus !== 'SENT') {
          return false;
        }

        const sendKey = `READ_${msg.uuid}`;
        const failedAttempts = failedStatusAttemptsRef.current.get(sendKey) || 0;
        if (failedAttempts >= 3) {
          return false;
        }
        return true;
      });

      if (unreadMessages.length === 0) {
        return;
      }

      if (dialogStatus === 'CLOSED' && !readStatusOnOpenSendingRef.current.has(sessionId)) {
        readStatusOnOpenSendingRef.current.add(sessionId);
        unreadMessages.slice(0, 5).forEach((message: any) => {
          sendReadStatusForMessage(sessionId, message);
        });

        setTimeout(() => {
          readStatusOnOpenSendingRef.current.delete(sessionId);
        }, 30000);
      } else if (dialogStatus === 'ACTIVE' || dialogStatus === 'OPEN') {
        unreadMessages.forEach((message: any) => {
          sendReadStatusForMessage(sessionId, message);
        });
      }
    },
    [getSession, sendReadStatusForMessage],
  );

  const sendDeliveredStatusesForSession = useCallback(
    (sessionId: string) => {
      if (deliveredSendingInProgressRef.current.has(sessionId)) {
        return;
      }

      const session = getSession(sessionId);
      if (!session || !session.messages || session.messages.length === 0) {
        return;
      }

      const dialogStatus = session.selectedDialog?.status;
      if (!dialogStatus) {
        return;
      }

      const lastSendTime = lastDeliveredSendTimeRef.current.get(sessionId) || 0;
      const now = Date.now();
      if (now - lastSendTime < 2000) {
        return;
      }

      deliveredSendingInProgressRef.current.add(sessionId);
      lastDeliveredSendTimeRef.current.set(sessionId, now);

      session.messages.forEach((message: any) => {
        const sendKey = `DELIVERED_${message.uuid}`;

        if (statusSendingInProgressRef.current.has(sendKey)) {
          return;
        }

        if (
          message.messageStatus === 'TO_OPERATOR' &&
          message.uuid &&
          message.confirmStatus === 'SENT' && // Проверяем реальный статус
          !statusSendingInProgressRef.current.has(sendKey)
        ) {
          statusSendingInProgressRef.current.add(sendKey);

          const sendResult = sendMessageStatus(message.uuid, 'DELIVERED');

          if (sendResult) {
            deliveredStatusesRef.current.add(message.uuid);
            const updatedMessages = session.messages.map((msg: any) =>
              msg.uuid === message.uuid ? { ...msg, confirmStatus: 'DELIVERED' } : msg,
            );
            updateSession(sessionId, { messages: updatedMessages });

            const deliveredSendKey = `SENT_DELIVERED_${message.uuid}`;
            localStorage.setItem(deliveredSendKey, now.toString());
            setTimeout(() => {
              statusSendingInProgressRef.current.delete(sendKey);
            }, 5000);
          } else {
            statusSendingInProgressRef.current.delete(sendKey);
          }
        }
      });

      setTimeout(() => {
        deliveredSendingInProgressRef.current.delete(sessionId);
      }, 3000);
    },
    [getSession, updateSession, sendMessageStatus],
  );

  const sendDeliveredStatusForNewMessage = useCallback(
    (sessionId: string, messageUuid: string) => {
      const sendKey = `DELIVERED_${messageUuid}`;

      if (deliveredSendingInProgressRef.current.has(sessionId)) {
        return false;
      }

      if (statusSendingInProgressRef.current.has(sendKey)) {
        return false;
      }

      const session = getSession(sessionId);
      if (!session) {
        return false;
      }

      const message = session.messages.find((msg: any) => msg.uuid === messageUuid);
      if (!message) {
        return false;
      }

      if (message.confirmStatus !== 'SENT') {
        return false;
      }

      if (message.messageStatus !== 'TO_OPERATOR') {
        return false;
      }

      deliveredSendingInProgressRef.current.add(sessionId);
      statusSendingInProgressRef.current.add(sendKey);

      const sendResult = sendMessageStatus(messageUuid, 'DELIVERED');

      if (sendResult) {
        deliveredStatusesRef.current.add(messageUuid);

        const updatedMessages = session.messages.map((msg: any) =>
          msg.uuid === messageUuid ? { ...msg, confirmStatus: 'DELIVERED' } : msg,
        );
        updateSession(sessionId, { messages: updatedMessages });

        const deliveredSendKey = `SENT_DELIVERED_${messageUuid}`;
        localStorage.setItem(deliveredSendKey, Date.now().toString());
      }

      setTimeout(() => {
        statusSendingInProgressRef.current.delete(sendKey);
        deliveredSendingInProgressRef.current.delete(sessionId);
      }, 5000);

      return sendResult;
    },
    [getSession, updateSession, sendMessageStatus],
  );

  const sendReadStatusForMessageId = useCallback(
    (sessionId: string, messageId: string) => {
      const session = getSession(sessionId);
      if (!session) {
        return;
      }

      const message = session.messages.find(
        (msg: any) => msg.id === messageId || msg.uuid === messageId,
      );
      if (message) {
        sendReadStatusForMessage(sessionId, message);
      }
    },
    [getSession, sendReadStatusForMessage],
  );

  const handleDeliveryConfirm = useCallback(
    (
      confirmData: any,
      sessions: any[],
      updateSession: (id: string, updates: any) => void,
      recalculateSessionUnreadCount?: (sessionId: string, dialogId?: string) => void,
    ) => {
      const { uuidMessage, status } = confirmData;

      if (status === 'READ' && uuidMessage) {
        processedReadStatusesRef.current.add(uuidMessage);
      }

      if (status !== 'READ' && uuidMessage && processedReadStatusesRef.current.has(uuidMessage)) {
        return;
      }

      const confirmKey = `${uuidMessage}_${status}_${Date.now()}`;

      if (processedDeliveryConfirmsRef.current.has(confirmKey)) {
        return;
      }

      if (!uuidMessage) {
        return;
      }

      processedDeliveryConfirmsRef.current.add(confirmKey);

      setTimeout(() => {
        processedDeliveryConfirmsRef.current.delete(confirmKey);
      }, 5000);

      sessions.forEach((session: any) => {
        const messageIndex = session.messages.findIndex((msg: any) => msg.uuid === uuidMessage);
        if (messageIndex !== -1) {
          const currentMessage = session.messages[messageIndex];
          const currentStatus = currentMessage.confirmStatus;
          const statusOrder = { SENT: 1, DELIVERED: 2, READ: 3 } as any;

          if (statusOrder[status] <= (statusOrder[currentStatus] || 0)) {
            return;
          }

          const updatedMessages = [...session.messages];
          updatedMessages[messageIndex] = {
            ...updatedMessages[messageIndex],
            confirmStatus: status,
            ...(status === 'READ' && { is_read: true }),
          };

          updateSession(session.id, { messages: updatedMessages });

          if (status === 'READ') {
            processedReadStatusesRef.current.add(uuidMessage);
            if (recalculateSessionUnreadCount) {
              const dialogId =
                currentMessage.dialog?.id?.toString() || currentMessage.dialogId?.toString();
              setTimeout(() => recalculateSessionUnreadCount(session.id, dialogId), 150);
            }
          } else if (status === 'DELIVERED') {
            deliveredStatusesRef.current.add(uuidMessage);
            deliveredConfirmedByBackendRef.current.add(uuidMessage);
          }
        }
      });
    },
    [],
  );

  return {
    sendReadStatusForMessage,
    sendReadStatusesForSession,
    sendDeliveredStatusesForSession,
    sendDeliveredStatusForNewMessage,
    sendReadStatusForMessageId,
    handleDeliveryConfirm,
    sendDeliveredStatusForMessage,
  };
};
