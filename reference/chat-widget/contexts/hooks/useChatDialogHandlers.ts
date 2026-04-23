import { useCallback } from 'react';

import { ChatsApi } from '@shared/api/baseQuerys';

import api from '../../api';
import { operatorUnreadDebug } from '../../lib/operatorUnreadDebugLog';
import { ChatConfig } from '../chatConfig';
import { ChatRefs } from './useChatRefs';

interface DialogHandlersDeps {
  getSession: (sessionId: string) => any;
  updateSession: (sessionId: string, updates: any) => void;
  assignDialog: (sessionId: string, userId: number) => Promise<any>;
}

/** В открытой панели входящие с SENT с бэка показываем как DELIVERED до ответа сервера. */
function normalizeOpenPanelInboundSentToDelivered(
  messages: any[],
  dialogId: string,
  isMinimized: boolean,
): any[] {
  if (isMinimized || !messages?.length) return messages;
  const d = String(dialogId);
  return messages.map((msg: any) => {
    const mid = String(msg.dialogId ?? msg.dialog?.id ?? '');
    if (
      mid === d &&
      msg.messageStatus === 'TO_OPERATOR' &&
      String(msg.confirmStatus ?? '').toUpperCase() === 'SENT' &&
      !msg.is_read
    ) {
      return { ...msg, confirmStatus: 'DELIVERED' };
    }
    return msg;
  });
}

export const useChatDialogHandlers = (refs: ChatRefs, deps: DialogHandlersDeps) => {
  const { getSession, updateSession, assignDialog } = deps;
  const {
    assignedDialogsRef,
    dialogLoadingInProgressRef,
    loadHistoryInProgressRef,
    dialogTotalElementsCacheRef,
    lastDialogHistoryUpdateRef,
    loadedDialogsHistoryRef,
    historyRefreshInProgressRef,
    messagesPaginationStateRef,
    loadingMoreMessagesRef,
    loadedPagesRef,
    pageLoadingInProgressRef,
  } = refs;

  const imageCache = new Map<string, string>();

  const processAttachments = async (attachments: any[]): Promise<any[]> => {
    if (!attachments || attachments.length === 0) return [];

    const processedAttachments = [];
    for (const attachment of attachments) {
      try {
        let fileName: string;
        if (typeof attachment === 'string') {
          fileName = attachment;
        } else if (attachment && typeof attachment === 'object') {
          fileName = attachment.fileName || attachment.name || attachment.id;
          if (!fileName) continue;
        } else {
          continue;
        }

        if (imageCache.has(fileName)) {
          processedAttachments.push({
            id: fileName,
            type: 'image',
            name: fileName,
            url: imageCache.get(fileName),
            fileName,
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
              type,
              name: fileName,
              url: imageUrl,
              fileName,
              blob,
              size: blob.size,
              extension,
              ...attachment,
            });
          }
        } catch (error) {
          console.error('Ошибка загрузки вложения:', fileName, error);
          processedAttachments.push({
            id: attachment.id || fileName,
            type: 'file',
            name: fileName,
            url: null,
            fileName,
            error: true,
            ...attachment,
          });
        }
      } catch (error) {
        console.error('Ошибка обработки вложения:', attachment, error);
      }
    }
    return processedAttachments;
  };

  const processMessageWithAttachments = useCallback(async (msg: any): Promise<any> => {
    let processedAttachments: any[] = [];

    if (msg.attaches?.length > 0) {
      try {
        processedAttachments = await processAttachments(msg.attaches);
      } catch (error) {
        console.error('Ошибка обработки вложений:', error);
      }
    }

    let replyToMessageId = null;
    let replyToMessage = null;

    if (msg.replyToMessage) {
      replyToMessageId = msg.replyToMessage.id?.toString() || msg.replyToMessage.uuid;
      replyToMessage = {
        id: msg.replyToMessage.id?.toString() || msg.replyToMessage.uuid,
        uuid: msg.replyToMessage.uuid,
        text: msg.replyToMessage.text,
        sender: msg.replyToMessage.messageStatus === 'TO_USER' ? 'user' : 'client',
        messageStatus: msg.replyToMessage.messageStatus,
        confirmStatus: msg.replyToMessage.confirmStatus,
        createdBy: msg.replyToMessage.createdBy,
        senderInfo: msg.replyToMessage.senderInfo,
        createdAt: msg.replyToMessage.createdAt,
        created_at: msg.replyToMessage.createdAt,
        attachments:
          msg.replyToMessage.attaches?.length > 0
            ? await processAttachments(msg.replyToMessage.attaches)
            : [],
      };
    } else if (msg.replyToMessageId) {
      replyToMessageId = msg.replyToMessageId.toString();
    }

    return {
      id: msg.id?.toString() || msg.uuid,
      uuid: msg.uuid,
      text: msg.text,
      created_at: msg.createdAt || new Date().toISOString(),
      createdAt: msg.createdAt || new Date().toISOString(),
      is_read: msg.confirmStatus === 'READ',
      sender: msg.messageStatus === 'TO_USER' ? 'user' : 'client',
      messageStatus: msg.messageStatus || 'TO_OPERATOR',
      confirmStatus: msg.confirmStatus || 'SENT',
      attachments: processedAttachments,
      recipientId: msg.recipient?.id,
      createdBy: msg.createdBy,
      senderInfo: msg.senderInfo || null,
      clientInfo: msg.clientInfo || null,
      dialogId: msg.dialog?.id,
      dialogStatus: msg.dialog?.status,
      replyTo: replyToMessageId,
      replyToMessage,
      rawAttaches: msg.attaches,
    };
  }, []);

  const mergeMessagesWithoutDuplicates = useCallback(
    (
      existingMessages: any[],
      newMessages: any[],
      targetPage: number,
      currentPage: number,
    ): any[] => {
      const existingMessagesMap = new Map<string, any>();
      existingMessages.forEach((msg: any) => {
        const key = msg.uuid || msg.id?.toString();
        if (key) {
          existingMessagesMap.set(key, msg);
        }
      });

      const newMessagesMap = new Map<string, any>();
      newMessages.forEach((msg: any) => {
        const key = msg.uuid || msg.id?.toString();
        if (key) {
          newMessagesMap.set(key, msg);
        }
      });

      const mergedMap = new Map<string, any>();

      existingMessagesMap.forEach((value, key) => {
        mergedMap.set(key, value);
      });

      newMessagesMap.forEach((value, key) => {
        mergedMap.set(key, value);
      });

      const mergedMessages = Array.from(mergedMap.values());
      if (targetPage > currentPage) {
        const uniqueNewMessages = Array.from(mergedMap.values()).filter((msg: any) => {
          const key = msg.uuid || msg.id?.toString();
          return newMessagesMap.has(key) && !existingMessagesMap.has(key);
        });

        const result = [...uniqueNewMessages, ...existingMessages];
        return result;
      } else if (targetPage < currentPage) {
        const uniqueNewMessages = Array.from(mergedMap.values()).filter((msg: any) => {
          const key = msg.uuid || msg.id?.toString();
          return newMessagesMap.has(key) && !existingMessagesMap.has(key);
        });

        const result = [...existingMessages, ...uniqueNewMessages];
        return result;
      } else {
        return mergedMessages;
      }
    },
    [],
  );

  const loadFirstPageMessages = useCallback(
    async (
      sessionId: string,
      dialogId: string,
      pageSize: number = ChatConfig.HISTORY_PAGE_SIZE,
    ) => {
      const session = getSession(sessionId);
      if (!session || !dialogId || dialogId === '0') return false;

      const loadingKey = `${sessionId}_${dialogId}_first_page`;
      if (pageLoadingInProgressRef.current.has(loadingKey)) return false;

      pageLoadingInProgressRef.current.add(loadingKey);

      try {
        updateSession(sessionId, {
          pagination: {
            ...session.pagination,
            isLoadingNext: true,
            currentPage: 0,
          },
        });

        const response = await api.getFirstPageMessages(dialogId, pageSize, 'createdAt,desc');

        if (response?.content && Array.isArray(response.content)) {
          const reversedContent = [...response.content].reverse();
          const serverMessagesPromises = reversedContent.map(processMessageWithAttachments);
          const processedMessages = await Promise.all(serverMessagesPromises);

          const totalPages = Math.ceil(response.totalElements / pageSize);
          const paginationUpdate = {
            currentPage: 0,
            totalPages,
            totalElements: response.totalElements,
            isLoadingMore: false,
            isLoadingNext: false,
            hasMoreMessages: totalPages > 1,
            hasNextMessages: false,
          };

          const sessAtSave = getSession(sessionId);
          const normalizedFirst = normalizeOpenPanelInboundSentToDelivered(
            processedMessages,
            dialogId,
            !!sessAtSave?.isMinimized,
          );
          operatorUnreadDebug(
            'FETCH first-page (createdAt,desc->UI asc): снимок порядка и статусов',
            {
              sessionId,
              dialogId,
              isMinimized: !!sessAtSave?.isMinimized,
              fromApiCount: response?.content?.length ?? 0,
              uiCount: normalizedFirst.length,
              первые10Ui: normalizedFirst.slice(0, 10).map((m: any, idx: number) => ({
                uiПорядок: idx + 1,
                id: m.id,
                text: String(m.text ?? '').slice(0, 30),
                messageStatus: m.messageStatus,
                confirmStatus: m.confirmStatus,
                is_read: m.is_read,
                created_at: m.created_at ?? m.createdAt,
              })),
            },
          );
          updateSession(sessionId, {
            messages: normalizedFirst,
            pagination: paginationUpdate,
          });

          const loadedPagesKey = `${sessionId}_${dialogId}`;
          const loadedPagesSet = new Set<number>();
          loadedPagesSet.add(0);
          loadedPagesRef.current.set(loadedPagesKey, loadedPagesSet);

          const hasUnreadInbound = processedMessages.some(
            (msg: any) =>
              msg.messageStatus === 'TO_OPERATOR' &&
              !msg.is_read &&
              String(msg.confirmStatus ?? '').toUpperCase() !== 'READ',
          );
          setTimeout(() => {
            const container = document.querySelector(`[data-session-id="${sessionId}"] .feed`);
            if (container && !hasUnreadInbound) {
              container.scrollTop = container.scrollHeight;
            }
          }, 100);

          return true;
        }
        return false;
      } catch (error) {
        console.error('Ошибка загрузки первой страницы сообщений:', error);
        return false;
      } finally {
        pageLoadingInProgressRef.current.delete(loadingKey);
      }
    },
    [
      getSession,
      updateSession,
      processMessageWithAttachments,
      pageLoadingInProgressRef,
      loadedPagesRef,
    ],
  );

  const loadDialogHistory = useCallback(
    async (sessionId: string, dialogId: string, force = false, targetPage = 0, isMerge = false) => {
      const session = getSession(sessionId);
      if (!session) return;

      if (loadHistoryInProgressRef.current.get(dialogId) && !force) return;

      loadHistoryInProgressRef.current.set(dialogId, true);
      historyRefreshInProgressRef.current.add(dialogId);

      try {
        let historyResult;

        if (ChatConfig.DISABLE_PAGINATION) {
          const dialogInfo = await api.getDialogInfo(dialogId);
          const totalElements = dialogInfo?.totalElements || 0;

          if (totalElements > 0) {
            historyResult = await api.getDialogMessagesWithPagination(
              dialogId,
              0,
              totalElements,
              'createdAt,desc',
            );
            if (historyResult.content) historyResult.content.reverse();
          } else {
            historyResult = {
              content: [],
              totalElements: 0,
              totalPages: 0,
              currentPage: 0,
              isLastPage: true,
            };
          }

          const loadedContent = historyResult?.content || [];
          const loadedTotalElements = historyResult?.totalElements || totalElements;
          const totalPages = loadedTotalElements > 0 ? 1 : 0;

          historyResult = {
            content: loadedContent,
            totalElements: loadedTotalElements,
            totalPages,
            currentPage: 0,
            isLastPage: true,
          };
        } else {
          historyResult = await api.getDialogMessagesWithPagination(
            dialogId,
            targetPage,
            ChatConfig.HISTORY_PAGE_SIZE,
            'createdAt,desc',
          );
          if (historyResult.content) historyResult.content.reverse();
        }

        if (historyResult.content) {
          const existingMessages = session.messages || [];
          const currentPage = session.pagination?.currentPage || 0;
          const loadedPagesKey = `${sessionId}_${dialogId}`;
          const loadedPagesSet = loadedPagesRef.current.get(loadedPagesKey) || new Set<number>();

          if (force && !isMerge) loadedPagesSet.clear();
          loadedPagesSet.add(targetPage);
          loadedPagesRef.current.set(loadedPagesKey, loadedPagesSet);

          let mergedMessages;
          if (force && !isMerge) {
            const serverMessagesPromises = historyResult.content.map(processMessageWithAttachments);
            const processedMessages = await Promise.all(serverMessagesPromises);
            mergedMessages = processedMessages;
          } else if (isMerge) {
            const serverMessagesPromises = historyResult.content.map(processMessageWithAttachments);
            const processedServerMessages = await Promise.all(serverMessagesPromises);
            mergedMessages = mergeMessagesWithoutDuplicates(
              existingMessages,
              processedServerMessages,
              targetPage,
              currentPage,
            );
          } else {
            const serverMessagesPromises = historyResult.content.map(processMessageWithAttachments);
            const processedMessages = await Promise.all(serverMessagesPromises);
            mergedMessages = processedMessages;
          }

          mergedMessages.sort((a: any, b: any) => {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });

          const uniqueMessagesMap = new Map<string, any>();
          const finalMessages = [];
          for (const msg of mergedMessages) {
            const key = msg.uuid || msg.id?.toString() || Math.random().toString();
            if (!uniqueMessagesMap.has(key)) {
              uniqueMessagesMap.set(key, msg);
              finalMessages.push(msg);
            }
          }

          if (historyResult.totalElements > 0) {
            dialogTotalElementsCacheRef.current.set(dialogId, historyResult.totalElements);
          }

          let updatedCurrentPage = targetPage;
          if (isMerge) {
            if (targetPage > currentPage) updatedCurrentPage = targetPage;
            else if (targetPage < currentPage) updatedCurrentPage = targetPage;
          }

          const totalPages =
            historyResult.totalPages ||
            Math.ceil((historyResult.totalElements || 0) / ChatConfig.HISTORY_PAGE_SIZE);
          const hasMoreMessages = targetPage < totalPages - 1;
          const hasNextMessages = targetPage > 0;

          const paginationUpdate = {
            currentPage: updatedCurrentPage,
            totalPages,
            totalElements: historyResult.totalElements || 0,
            isLoadingMore: false,
            isLoadingNext: false,
            hasMoreMessages,
            hasNextMessages,
          };

          const sessAtSave = getSession(sessionId);
          const messagesForStore = normalizeOpenPanelInboundSentToDelivered(
            finalMessages,
            dialogId,
            !!sessAtSave?.isMinimized,
          );
          operatorUnreadDebug('FETCH history->store: SENT/DELIVERED входящих в открытой панели', {
            sessionId,
            dialogId,
            isMinimized: !!sessAtSave?.isMinimized,
            sentInbound: messagesForStore.filter(
              (m: any) =>
                m.messageStatus === 'TO_OPERATOR' &&
                String(m.confirmStatus ?? '').toUpperCase() === 'SENT' &&
                !m.is_read,
            ).length,
            deliveredInbound: messagesForStore.filter(
              (m: any) =>
                m.messageStatus === 'TO_OPERATOR' &&
                String(m.confirmStatus ?? '').toUpperCase() === 'DELIVERED' &&
                !m.is_read,
            ).length,
          });
          updateSession(sessionId, {
            messages: messagesForStore,
            hasHistoryLoaded: true,
            pagination: paginationUpdate,
          });

          messagesPaginationStateRef.current.set(sessionId, paginationUpdate);
          lastDialogHistoryUpdateRef.current.set(dialogId, Date.now());
          loadedDialogsHistoryRef.current.add(dialogId);
        }
      } catch (error) {
        console.error('Ошибка загрузки истории диалога:', error);
      } finally {
        setTimeout(() => {
          loadHistoryInProgressRef.current.delete(dialogId);
          historyRefreshInProgressRef.current.delete(dialogId);
        }, 1000);
      }
    },
    [getSession, updateSession, processMessageWithAttachments, mergeMessagesWithoutDuplicates],
  );

  const refreshDialogHistory = useCallback(
    async (sessionId: string, dialogId: string): Promise<boolean> => {
      try {
        await loadDialogHistory(sessionId, dialogId, true);
        return true;
      } catch (error) {
        console.error('Ошибка синхронизации истории диалога:', error);
        return false;
      }
    },
    [loadDialogHistory],
  );

  const navigateToQuotedMessage = useCallback(
    async (sessionId: string, dialogId: string, quotedMessage: any, pageSize = 50) => {
      const session = getSession(sessionId);
      if (!session) return false;

      try {
        const messageCreatedAt = quotedMessage.createdAt || quotedMessage.created_at;
        if (!messageCreatedAt) return false;

        const position = await api.getMessagePositionInDialog(dialogId, messageCreatedAt);
        if (position === 0) {
          const existingMessage = session.messages?.find(
            (msg: any) =>
              msg.id === quotedMessage.id.toString() || msg.uuid === quotedMessage.id.toString(),
          );

          if (existingMessage) {
            const element = document.getElementById(`message-${quotedMessage.id}`);
            if (element) {
              element.scrollIntoView({ behavior: 'smooth', block: 'center' });
              element.classList.add('replyTarget');
              setTimeout(() => element.classList.remove('replyTarget'), 2000);
            }
            return true;
          }
          await loadDialogHistory(sessionId, dialogId, true, 0, false);
          return true;
        }

        const targetPage = Math.floor(position / pageSize);
        await loadDialogHistory(sessionId, dialogId, true, targetPage, false);

        setTimeout(() => {
          const element = document.getElementById(`message-${quotedMessage.id}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('replyTarget');
            setTimeout(() => element.classList.remove('replyTarget'), 2000);
          }
        }, 500);

        return true;
      } catch (error) {
        console.error('Ошибка навигации к цитируемому сообщению:', error);
        return false;
      }
    },
    [getSession, updateSession, loadDialogHistory],
  );

  const loadPreviousMessages = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const session = getSession(sessionId);
      if (!session?.selectedDialog?.id) return false;

      const dialogId = session.selectedDialog.id;
      const pagination = session.pagination || {
        currentPage: 0,
        totalPages: 0,
        totalElements: 0,
        isLoadingMore: false,
        isLoadingNext: false,
        hasMoreMessages: false,
        hasNextMessages: false,
      };

      if (pageLoadingInProgressRef.current.has(sessionId)) return false;
      if (pagination.isLoadingMore || !pagination.hasMoreMessages) return false;
      if (loadingMoreMessagesRef.current.has(sessionId)) return false;

      const loadedPagesKey = `${sessionId}_${dialogId}`;
      const loadedPagesSet = loadedPagesRef.current.get(loadedPagesKey) || new Set<number>();
      const nextPage = pagination.currentPage + 1;

      if (nextPage >= pagination.totalPages) {
        updateSession(sessionId, {
          pagination: { ...pagination, hasMoreMessages: false },
        });
        return false;
      }

      if (loadedPagesSet.has(nextPage)) {
        const sessionMessagesIds = new Set(
          session.messages.map((msg: any) => msg.uuid || msg.id?.toString()).filter(Boolean),
        );

        try {
          const pageInfo = await api.getDialogMessagesWithPagination(
            dialogId,
            nextPage,
            ChatConfig.HISTORY_PAGE_SIZE,
            'createdAt,desc',
          );

          if (pageInfo.content) {
            const pageMessageIds = new Set(
              pageInfo.content.map((msg: any) => msg.uuid || msg.id?.toString()).filter(Boolean),
            );
            const allMessagesExist = Array.from(pageMessageIds).every((id) =>
              sessionMessagesIds.has(id),
            );
            if (allMessagesExist) {
              updateSession(sessionId, { pagination: { ...pagination, currentPage: nextPage } });
              return true;
            }
          }
        } catch (error) {
          console.warn('Не удалось проверить содержимое страницы:', error);
        }
      }

      loadingMoreMessagesRef.current.add(sessionId);
      pageLoadingInProgressRef.current.add(sessionId);

      updateSession(sessionId, { pagination: { ...pagination, isLoadingMore: true } });

      try {
        await loadDialogHistory(sessionId, dialogId, false, nextPage, true);
        return true;
      } catch (error) {
        console.error('Ошибка загрузки предыдущих сообщений:', error);
        updateSession(sessionId, { pagination: { ...pagination, isLoadingMore: false } });
        return false;
      } finally {
        loadingMoreMessagesRef.current.delete(sessionId);
        pageLoadingInProgressRef.current.delete(sessionId);
      }
    },
    [getSession, updateSession, loadDialogHistory],
  );

  const loadNextMessages = useCallback(
    async (sessionId: string): Promise<boolean> => {
      const session = getSession(sessionId);
      if (!session?.selectedDialog?.id) return false;

      const dialogId = session.selectedDialog.id;
      const pagination = session.pagination || {
        currentPage: 0,
        totalPages: 0,
        totalElements: 0,
        isLoadingMore: false,
        isLoadingNext: false,
        hasMoreMessages: false,
        hasNextMessages: false,
      };

      if (pageLoadingInProgressRef.current.has(sessionId)) return false;
      if (pagination.isLoadingNext || !pagination.hasNextMessages) return false;

      const loadedPagesKey = `${sessionId}_${dialogId}`;
      const loadedPagesSet = loadedPagesRef.current.get(loadedPagesKey) || new Set<number>();
      const nextPage = pagination.currentPage - 1;

      if (nextPage < 0) {
        updateSession(sessionId, { pagination: { ...pagination, hasNextMessages: false } });
        return false;
      }

      if (loadedPagesSet.has(nextPage)) {
        const sessionMessagesIds = new Set(
          session.messages.map((msg: any) => msg.uuid || msg.id?.toString()).filter(Boolean),
        );

        try {
          const pageInfo = await api.getDialogMessagesWithPagination(
            dialogId,
            nextPage,
            ChatConfig.HISTORY_PAGE_SIZE,
            'createdAt,desc',
          );

          if (pageInfo.content) {
            const pageMessageIds = new Set(
              pageInfo.content.map((msg: any) => msg.uuid || msg.id?.toString()).filter(Boolean),
            );
            const allMessagesExist = Array.from(pageMessageIds).every((id) =>
              sessionMessagesIds.has(id),
            );
            if (allMessagesExist) {
              updateSession(sessionId, { pagination: { ...pagination, currentPage: nextPage } });
              return true;
            }
          }
        } catch (error) {
          console.warn('Не удалось проверить содержимое страницы:', error);
        }
      }

      pageLoadingInProgressRef.current.add(sessionId);
      updateSession(sessionId, { pagination: { ...pagination, isLoadingNext: true } });

      try {
        await loadDialogHistory(sessionId, dialogId, false, nextPage, true);
        return true;
      } catch (error) {
        console.error('Ошибка загрузки следующих сообщений:', error);
        updateSession(sessionId, { pagination: { ...pagination, isLoadingNext: false } });
        return false;
      } finally {
        pageLoadingInProgressRef.current.delete(sessionId);
      }
    },
    [getSession, updateSession, loadDialogHistory],
  );

  const refreshSessionMessages = useCallback(
    async (sessionId: string, force = false) => {
      const session = getSession(sessionId);
      if (!session) return;

      const dialogId = session.selectedDialog?.id || session.assignedDialogId;
      if (!dialogId || dialogId === '0') return;

      if (session.pagination?.currentPage != null && session.pagination.currentPage !== 0) {
        return;
      }

      try {
        if (ChatConfig.DISABLE_PAGINATION) {
          await refreshDialogHistory(sessionId, dialogId);
        } else if (session.pagination?.currentPage !== undefined) {
          await loadDialogHistory(
            sessionId,
            dialogId,
            force,
            session.pagination.currentPage,
            false,
          );
        } else {
          await loadDialogHistory(sessionId, dialogId, force);
        }
      } catch (error) {
        console.error('Ошибка обновления сообщений:', error);
      }
    },
    [getSession, loadDialogHistory, refreshDialogHistory],
  );

  const addNewMessageToSession = useCallback(
    async (sessionId: string, messageData: any) => {
      const session = getSession(sessionId);
      if (!session) return;

      const dialogId = session.selectedDialog?.id || session.assignedDialogId;
      if (!dialogId || dialogId === '0') return;

      try {
        const processedMessage = await processMessageWithAttachments(messageData);

        const currentPage = session.pagination?.currentPage || 0;

        if (currentPage === 0) {
          const updatedMessages = [...(session.messages || []), processedMessage];

          const newTotalElements = (session.pagination?.totalElements || 0) + 1;
          const totalPages = Math.ceil(newTotalElements / ChatConfig.HISTORY_PAGE_SIZE);

          updateSession(sessionId, {
            messages: updatedMessages,
            pagination: {
              ...session.pagination,
              totalElements: newTotalElements,
              totalPages,
              hasMoreMessages: totalPages > 1,
            },
          });

          setTimeout(() => {
            const container = document.querySelector(`[data-session-id="${sessionId}"] .feed`);
            if (container) {
              container.scrollTop = container.scrollHeight;
            }
          }, 50);
        } else {
          const newTotalElements = (session.pagination?.totalElements || 0) + 1;
          const totalPages = Math.ceil(newTotalElements / ChatConfig.HISTORY_PAGE_SIZE);

          updateSession(sessionId, {
            pagination: {
              ...session.pagination,
              totalElements: newTotalElements,
              totalPages,
              hasMoreMessages: totalPages > currentPage + 1,
            },
          });

          await loadFirstPageMessages(sessionId, dialogId);
        }
      } catch (error) {
        console.error('Ошибка добавления нового сообщения:', error);
      }
    },
    [getSession, updateSession, processMessageWithAttachments, loadFirstPageMessages],
  );

  const refreshMessagesForUserId = useCallback(
    async (sessionId: string, userId: number) => {
      const session = getSession(sessionId);
      if (!session) return;

      const dialogId = session.selectedDialog?.id || session.assignedDialogId;
      if (dialogId && dialogId !== '0') {
        const ownerFromDialog = session.selectedDialog?.owner?.id;
        const dialogBelongsToUser =
          ownerFromDialog == null || Number(ownerFromDialog) === Number(userId);
        if (dialogBelongsToUser) {
          await refreshSessionMessages(sessionId);
          return;
        }
        updateSession(sessionId, {
          selectedDialog: null,
          assignedDialogId: null,
          messages: [],
          hasHistoryLoaded: false,
        });
      }

      try {
        const messagesResponse = await api.getUserMessages(userId, 0, 1);
        if (messagesResponse?.content?.length > 0) {
          const firstMessage = messagesResponse.content[0];
          if (firstMessage.dialog?.id) {
            updateSession(sessionId, { selectedDialog: firstMessage.dialog });
            await loadDialogHistory(sessionId, firstMessage.dialog.id);
          } else {
            const limitedResponse = await api.getUserMessages(userId, 0, 50);
            if (limitedResponse?.content) {
              const reversedContent = [...(limitedResponse.content || [])].reverse();
              const updatedMessagesPromises = reversedContent.map(processMessageWithAttachments);
              const updatedMessages = await Promise.all(updatedMessagesPromises);
              const paginationUpdate = {
                currentPage: 0,
                totalPages: 1,
                totalElements: limitedResponse.content.length,
                isLoadingMore: false,
                isLoadingNext: false,
                hasMoreMessages: false,
                hasNextMessages: false,
              };
              updateSession(sessionId, {
                messages: updatedMessages,
                hasHistoryLoaded: true,
                pagination: paginationUpdate,
              });
            }
          }
        }
      } catch (error) {
        console.error('Ошибка загрузки сообщений по userId:', error);
      }
    },
    [
      getSession,
      updateSession,
      loadDialogHistory,
      refreshSessionMessages,
      processMessageWithAttachments,
    ],
  );

  const autoRefreshOpenSessionMessages = useCallback(
    async (sessionId: string) => {
      const session = getSession(sessionId);
      if (!session || session.isMinimized || session.selectedUsers.length === 0) return;

      const userId = session.selectedUsers[0];
      const dialogId = session.selectedDialog?.id || session.assignedDialogId;

      try {
        if (dialogId && dialogId !== '0') {
          await refreshSessionMessages(sessionId, false);
        } else {
          await refreshMessagesForUserId(sessionId, userId);
        }
      } catch (error) {
        console.error('Ошибка авто-обновления сообщений:', error);
      }
    },
    [getSession, refreshSessionMessages, refreshMessagesForUserId],
  );

  const forceRefreshSessionMessages = useCallback(
    async (sessionId: string, retryCount = 0) => {
      if (retryCount > 2) return;
      try {
        await refreshSessionMessages(sessionId, true);
      } catch (error) {
        setTimeout(() => forceRefreshSessionMessages(sessionId, retryCount + 1), 1000);
      }
    },
    [refreshSessionMessages],
  );

  const openUnreadDialogWithStatus = useCallback(
    async (
      sessionId: string,
      dialog: any,
      openUnreadDialogFn: (sessionId: string, dialog: any) => Promise<void>,
    ) => {
      const dialogId = dialog?.id != null ? String(dialog.id) : '';
      dialogLoadingInProgressRef.current.delete(dialogId);
      await openUnreadDialogFn(sessionId, dialog);

      if (dialogId) {
        await loadDialogHistory(sessionId, dialogId);
      }
    },
    [loadDialogHistory],
  );

  const refreshUserMessages = useCallback(
    async (sessionId: string) => {
      const session = getSession(sessionId);
      if (!session || !session.selectedDialog?.id) return;
      await forceRefreshSessionMessages(sessionId);
    },
    [getSession, forceRefreshSessionMessages],
  );

  const refreshUserMessagesAfterSend = useCallback(
    async (sessionId: string) => {
      await forceRefreshSessionMessages(sessionId);
    },
    [forceRefreshSessionMessages],
  );

  const restoreAssignedDialog = useCallback(
    async (sessionId: string, userId: number) => {
      try {
        const savedDialogId = assignedDialogsRef.current.get(userId);
        if (savedDialogId) {
          updateSession(sessionId, {
            assignedDialogId: savedDialogId,
            selectedDialog: { id: savedDialogId },
          });
          return savedDialogId;
        }

        const response = await assignDialog(sessionId, userId);
        if (response?.id) {
          assignedDialogsRef.current.set(userId, response.id.toString());
          return response.id.toString();
        }
      } catch (error: any) {
        if (error?.status === 409) {
          try {
            const dialogs = await api.getAllDialogs();
            const userDialog = dialogs?.find(
              (d: any) => d.owner?.id === userId || d.userId === userId,
            );
            if (userDialog?.id) {
              assignedDialogsRef.current.set(userId, userDialog.id.toString());
              updateSession(sessionId, {
                assignedDialogId: userDialog.id.toString(),
                selectedDialog: userDialog,
                hasLoadedDialogs: true,
              });
              return userDialog.id.toString();
            }
          } catch (dialogError) {
            console.error('Ошибка поиска диалогов:', dialogError);
          }
        }
      }
      return null;
    },
    [assignDialog, updateSession],
  );

  return {
    restoreAssignedDialog,
    loadDialogHistory,
    refreshDialogHistory,
    navigateToQuotedMessage,
    loadPreviousMessages,
    loadNextMessages,
    loadFirstPageMessages,
    refreshSessionMessages,
    addNewMessageToSession,
    refreshMessagesForUserId,
    autoRefreshOpenSessionMessages,
    forceRefreshSessionMessages,
    openUnreadDialogWithStatus,
    refreshUserMessages,
    refreshUserMessagesAfterSend,
  };
};
