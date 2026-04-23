import { useCallback, useRef } from 'react';

import { appStore } from '@shared/model/app_store/AppStore';
import { UnreadDialog } from '@widgets/chat/api/dialogsApi';

import api from '../../api';
import { chatSessionTrace } from '../chatUnreadTrace';

/** После assign текущий оператор — локер; бэкенд иногда отдаёт только last_operator или без поля. */
function normalizeAssignedDialogResponse(response: any): any {
  if (!response || typeof response !== 'object') return response;
  const meName = appStore.getState().fullName;
  const authId = appStore.getState().authId;
  const rawLo = (response as any).lastOperator ?? (response as any).last_operator;
  const lastOperator =
    rawLo ??
    (authId != null && authId !== ''
      ? { id: authId, ...(meName ? { fullName: meName } : {}) }
      : undefined);
  return { ...response, lastOperator };
}

function mergeListDialogLastOperator(d: any): any {
  if (!d || typeof d !== 'object') return d;
  const rawLo = d.lastOperator ?? d.last_operator;
  return rawLo != null ? { ...d, lastOperator: rawLo } : { ...d };
}

export const useChatDialogs = (
  getSession: (sessionId: string) => any,
  updateSession: (sessionId: string, updates: any) => void,
  onUnreadDialogsLoaded?: (dialogs: UnreadDialog[]) => void,
  /** После открытия диалога — одна развёрнутая сессия (как при клике по превью чата). */
  ensureExclusiveExpanded?: (sessionId: string) => void,
) => {
  const loadingUnreadDialogsRef = useRef<Set<string>>(new Set());
  const loadDialogInProgressRef = useRef<Set<string>>(new Set());
  const dialogLoadingRef = useRef<Map<string, boolean>>(new Map());

  const assignDialog = useCallback(
    async (sessionId: string, userId: number): Promise<any> => {
      try {
        const response = await api.assignDialog(userId.toString());
        const normalized = normalizeAssignedDialogResponse(response);
        updateSession(sessionId, {
          assignedDialogId: normalized?.id || null,
          selectedDialog: normalized || null,
          lastSendError: null,
        });

        return normalized;
      } catch (error: any) {
        console.error('Ошибка блокировки диалога:', error);

        if (error?.status === 409) {
          try {
            const dialogs = await api.getAllDialogs();
            const userDialog = dialogs?.find(
              (d: any) => d.owner?.id === userId || d.userId === userId,
            );

            if (userDialog) {
              const merged = mergeListDialogLastOperator(userDialog);
              updateSession(sessionId, {
                selectedDialog: merged,
                assignedDialogId: userDialog.id,
                hasLoadedDialogs: true,
                lastSendError: null,
              });
              return merged;
            } else {
              updateSession(sessionId, {
                assignedDialogId: 'assigned',
                lastSendError: null,
              });
              return { id: 'assigned' };
            }
          } catch {
            updateSession(sessionId, {
              assignedDialogId: 'assigned',
              lastSendError: null,
            });
            return { id: 'assigned' };
          }
        }

        throw error;
      }
    },
    [updateSession],
  );

  const loadUnreadDialogsCommon = useCallback(
    async (sessionId: string, force: boolean = false) => {
      const session = getSession(sessionId);
      if (!session || (!force && loadDialogInProgressRef.current.has(sessionId))) return;

      if (!force) loadingUnreadDialogsRef.current.add(sessionId);
      loadDialogInProgressRef.current.add(sessionId);

      updateSession(sessionId, { isLoadingUnreadDialogs: true });

      try {
        const unreadDialogs = await api.getUnreadDialogs();
        const list = unreadDialogs || [];
        updateSession(sessionId, {
          unreadDialogs: list,
          isLoadingUnreadDialogs: false,
        });
        onUnreadDialogsLoaded?.(list);
      } catch {
        updateSession(sessionId, {
          unreadDialogs: [],
          isLoadingUnreadDialogs: false,
        });
      } finally {
        loadingUnreadDialogsRef.current.delete(sessionId);
        loadDialogInProgressRef.current.delete(sessionId);
      }
    },
    [getSession, updateSession, onUnreadDialogsLoaded],
  );

  const forceLoadUnreadDialogs = useCallback(
    (sessionId: string) => loadUnreadDialogsCommon(sessionId, true),
    [loadUnreadDialogsCommon],
  );

  const loadUnreadDialogs = useCallback(
    (sessionId: string) => loadUnreadDialogsCommon(sessionId, false),
    [loadUnreadDialogsCommon],
  );

  const loadDialogDetails = useCallback(async (dialogId: number): Promise<any> => {
    try {
      return await api.getDialogDetails(dialogId.toString());
    } catch (error) {
      console.error('Ошибка загрузки деталей диалога:', error);
      throw error;
    }
  }, []);

  const openUnreadDialog = useCallback(
    async (sessionId: string, dialog: UnreadDialog) => {
      const session = getSession(sessionId);
      if (!session) return;

      const dialogId = dialog.id.toString();
      if (dialogLoadingRef.current.get(dialogId)) return;

      dialogLoadingRef.current.set(dialogId, true);

      try {
        updateSession(sessionId, {
          isMinimized: false,
          selectedDialog: {
            id: dialogId,
            client_name: dialog.owner.fullName,
            status: dialog.status,
            ...dialog,
          },
          selectedUsers: [dialog.owner.id],
          selectedUserName: dialog.owner.fullName,
          assignedDialogId: dialogId,
          hasLoadedDialogs: true,
          messages: [],
          unreadDialogs: session.unreadDialogs.filter((d: UnreadDialog) => d.id !== dialog.id),
          pagination: {
            currentPage: 0,
            totalPages: 0,
            totalElements: 0,
            isLoadingMore: false,
            hasMoreMessages: false,
          },
        });
        chatSessionTrace('openUnreadDialog.patched', {
          sessionId,
          dialogId,
          ownerId: dialog.owner?.id,
        });
        ensureExclusiveExpanded?.(sessionId);
      } catch (error) {
        console.error('Ошибка открытия диалога:', error);
      } finally {
        setTimeout(() => dialogLoadingRef.current.delete(dialogId), 1000);
      }
    },
    [getSession, updateSession, ensureExclusiveExpanded],
  );

  return {
    assignDialog,
    forceLoadUnreadDialogs,
    loadUnreadDialogs,
    loadDialogDetails,
    openUnreadDialog,
    loadingUnreadDialogsRef,
  };
};
