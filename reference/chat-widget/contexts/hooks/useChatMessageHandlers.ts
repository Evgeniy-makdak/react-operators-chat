/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from 'react';

import { ChatsApi } from '@shared/api/baseQuerys';

import { ChatRefs } from './useChatRefs';

interface MessageHandlersDeps {
  getSession: (sessionId: string) => any;
  updateSession: (sessionId: string, updates: any) => void;
  sendMessageStatus: (uuid: string, status: string) => boolean;
  refreshDialogHistory: (sessionId: string, dialogId: string) => Promise<boolean>;
}

const imageCache = new Map<string, string>();

const processAttachments = async (attachments: any[]): Promise<any[]> => {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const processedAttachments = [];

  for (const attachment of attachments) {
    try {
      if (typeof attachment === 'string') {
        const fileName = attachment;

        if (imageCache.has(fileName)) {
          processedAttachments.push({
            id: fileName,
            type: 'image',
            name: fileName,
            url: imageCache.get(fileName),
            fileName: fileName,
          });
          continue;
        }

        const response = await ChatsApi.getPhotoByFileName(fileName);
        if (response?.data) {
          const blob = response.data;
          const imageUrl = URL.createObjectURL(blob);

          imageCache.set(fileName, imageUrl);

          const extension = fileName.split('.').pop()?.toLowerCase() || '';
          const type = ['jpg', 'jpeg', 'png', 'bmp', 'gif'].includes(extension) ? 'image' : 'file';

          processedAttachments.push({
            id: fileName,
            type: type,
            name: fileName,
            url: imageUrl,
            fileName: fileName,
            blob: blob,
            size: blob.size,
          });
        }
      } else if (attachment && typeof attachment === 'object') {
        const fileName = attachment.fileName || attachment.name || attachment.id;

        if (!fileName) {
          continue;
        }

        if (imageCache.has(fileName)) {
          processedAttachments.push({
            id: attachment.id || fileName,
            type: attachment.extension ? 'image' : 'file',
            name: fileName,
            url: imageCache.get(fileName),
            fileName: fileName,
            ...attachment,
          });
          continue;
        }

        try {
          const response = await ChatsApi.getPhotoByFileName(fileName);
          if (response?.data) {
            const blob = response.data;
            const imageUrl = URL.createObjectURL(blob);

            imageCache.set(fileName, imageUrl);

            const extension =
              attachment.extension || fileName.split('.').pop()?.toLowerCase() || '';
            const type = ['jpg', 'jpeg', 'png', 'bmp', 'gif', 'jpeg'].includes(
              extension.toLowerCase(),
            )
              ? 'image'
              : 'file';

            processedAttachments.push({
              id: attachment.id || fileName,
              type: type,
              name: fileName,
              url: imageUrl,
              fileName: fileName,
              blob: blob,
              size: blob.size,
              extension: extension,
              ...attachment,
            });
          }
        } catch (error) {
          processedAttachments.push({
            id: attachment.id || fileName,
            type: 'file',
            name: fileName,
            url: null,
            fileName: fileName,
            error: true,
            ...attachment,
          });
        }
      }
    } catch (error) {
      console.error('❌ Ошибка обработки вложения:', attachment, error);
    }
  }

  return processedAttachments;
};

export const useChatMessageHandlers = (refs: ChatRefs, deps: MessageHandlersDeps) => {
  const { getSession, updateSession, refreshDialogHistory } = deps;
  const { syncHistoryDebounceRef } = refs;

  const checkIfUserAtBottom = useCallback(
    (sessionId: string): boolean => {
      const session = getSession(sessionId);
      if (!session) return false;

      let container = document.querySelector(`[data-session-id="${sessionId}"] [class*="feed"]`);
      if (!container) {
        const containers = document.querySelectorAll('[class*="feed"]');
        if (containers.length > 0) {
          container = containers[0];
        } else {
          return false;
        }
      }

      const { scrollTop, scrollHeight, clientHeight } = container;
      const isBottom = scrollHeight - scrollTop - clientHeight < 100;
      return isBottom;
    },
    [getSession],
  );

  const debouncedSyncDialogHistory = useCallback(
    (sessionId: string, dialogId: string) => {
      const session = getSession(sessionId);
      const currentPage = session?.pagination?.currentPage;

      if (currentPage !== 0) {
        return;
      }

      const key = `${sessionId}_${dialogId}`;
      const existingTimeout = syncHistoryDebounceRef.current.get(key);

      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const newTimeout = setTimeout(() => {
        refreshDialogHistory(sessionId, dialogId);
        syncHistoryDebounceRef.current.delete(key);
      }, 800);

      syncHistoryDebounceRef.current.set(key, newTimeout);
    },
    [refreshDialogHistory, getSession, syncHistoryDebounceRef],
  );

  const addMessageFromWebSocket = useCallback(
    async (sessionId: string, messageData: any) => {
      const session = getSession(sessionId);
      if (!session) {
        return;
      }

      const currentDialogId = session.selectedDialog?.id || session.assignedDialogId;
      const messageDialogId = messageData.dialog?.id || messageData.dialogId;
      const inUnreadPreview = session.unreadDialogs?.some(
        (d: any) => String(d.id) === String(messageDialogId),
      );

      const messageOwnerRaw =
        messageData?.dialog?.owner?.id ?? messageData?.createdBy?.id ?? messageData?.user?.id;
      const messageOwnerNum =
        messageOwnerRaw != null && messageOwnerRaw !== ''
          ? parseInt(String(messageOwnerRaw), 10)
          : NaN;
      const ownerMatchesSession =
        !Number.isNaN(messageOwnerNum) &&
        messageOwnerNum > 0 &&
        Boolean(session.selectedUsers?.includes(messageOwnerNum));

      if (
        messageDialogId &&
        currentDialogId &&
        messageDialogId.toString() !== currentDialogId.toString() &&
        !inUnreadPreview &&
        !ownerMatchesSession
      ) {
        return;
      }

      const existingMessage = session.messages.find(
        (msg: any) => msg.uuid === messageData.uuid || msg.id === messageData.id,
      );

      let processedAttachments: any[] = [];

      const attachmentsData =
        messageData.attaches || messageData.pathsToAttaches || messageData.attachments;

      if (attachmentsData && attachmentsData.length > 0) {
        try {
          processedAttachments = await processAttachments(attachmentsData);
        } catch (error) {
          console.error('❌ Ошибка обработки вложений:', error);
        }
      }

      let replyToMessageId = null;
      if (messageData.replyToMessage) {
        replyToMessageId =
          messageData.replyToMessage.id?.toString() || messageData.replyToMessage.uuid;
      } else if (messageData.replyToMessageId) {
        replyToMessageId = messageData.replyToMessageId.toString();
      }

      let replyToMessage = null;
      if (replyToMessageId) {
        replyToMessage = session.messages.find(
          (msg: any) => msg.id === replyToMessageId || msg.uuid === replyToMessageId,
        );

        if (!replyToMessage && messageData.replyToMessage) {
          replyToMessage = {
            id: messageData.replyToMessage.id?.toString() || messageData.replyToMessage.uuid,
            uuid: messageData.replyToMessage.uuid,
            text: messageData.replyToMessage.text,
            sender: messageData.replyToMessage.messageStatus === 'TO_USER' ? 'user' : 'client',
            messageStatus: messageData.replyToMessage.messageStatus,
            confirmStatus: messageData.replyToMessage.confirmStatus,
            createdBy: messageData.replyToMessage.createdBy,
            senderInfo: messageData.replyToMessage.senderInfo,
          };
        }
      }

      const newMessage = {
        id: messageData.id?.toString() || messageData.uuid,
        uuid: messageData.uuid,
        text: messageData.text || '',
        created_at: messageData.createdAt || new Date().toISOString(),
        is_read: messageData.confirmStatus === 'READ',
        sender: messageData.messageStatus === 'TO_USER' ? 'user' : 'client',
        messageStatus: messageData.messageStatus || 'TO_OPERATOR',
        confirmStatus: messageData.confirmStatus || 'SENT',
        attachments: processedAttachments,
        recipientId: messageData.recipient?.id || messageData.recipientId,
        createdBy: messageData.createdBy,
        senderInfo: messageData.senderInfo || null,
        clientInfo: messageData.clientInfo || null,
        userInfo: messageData.userInfo || null,
        dialogId: messageData.dialog?.id || messageDialogId,
        replyTo: replyToMessageId,
        replyToMessage: replyToMessage,
        dialogStatus: messageData.dialog?.status,
        isFromWebSocket: true,
        rawAttaches: attachmentsData,
      };

      const shouldPatchDialogMeta =
        Boolean(messageData.dialog) &&
        Boolean(messageDialogId) &&
        ownerMatchesSession &&
        (!currentDialogId || messageDialogId.toString() !== currentDialogId.toString());

      const dialogMetaPatch =
        shouldPatchDialogMeta && messageData.dialog
          ? {
              assignedDialogId: messageDialogId!.toString(),
              selectedDialog: {
                ...(session.selectedDialog || {}),
                ...messageData.dialog,
              },
            }
          : {};

      if (existingMessage) {
        const updatedMessages = session.messages.map((msg: any) =>
          msg.uuid === messageData.uuid || msg.id === messageData.id
            ? { ...msg, ...newMessage }
            : msg,
        );

        updateSession(sessionId, { messages: updatedMessages, ...dialogMetaPatch });
      } else {
        updateSession(sessionId, {
          messages: [...session.messages, newMessage],
          ...dialogMetaPatch,
        });
      }
    },
    [getSession, updateSession],
  );

  const reloadMessageAttachments = useCallback(
    async (sessionId: string, messageId: string) => {
      const session = getSession(sessionId);
      if (!session) return;

      const message = session.messages.find(
        (msg: any) => msg.id === messageId || msg.uuid === messageId,
      );
      if (!message || !message.rawAttaches) return;

      try {
        const processedAttachments = await processAttachments(message.rawAttaches);

        const updatedMessages = session.messages.map((msg: any) =>
          msg.id === messageId || msg.uuid === messageId
            ? { ...msg, attachments: processedAttachments }
            : msg,
        );

        updateSession(sessionId, { messages: updatedMessages });
      } catch (error) {
        console.error('❌ Ошибка перезагрузки вложений:', error);
      }
    },
    [getSession, updateSession],
  );

  return {
    checkIfUserAtBottom,
    addMessageFromWebSocket,
    debouncedSyncDialogHistory,
    reloadMessageAttachments,
  };
};
