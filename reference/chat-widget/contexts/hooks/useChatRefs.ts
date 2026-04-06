/* eslint-disable prettier/prettier */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useRef } from 'react';

import { ChatPagination } from '../types/ChatTypes';

export const useChatRefs = () => {
  // Основные refs
  const prevIsChatOpenRef = useRef<boolean>(false);

  // Обработка сессий и диалогов
  const loadingSessionsRef = useRef<Set<string>>(new Set());
  const assignedDialogsRef = useRef<Map<number, string>>(new Map());
  const sessionCreationTimeRef = useRef<Map<string, number>>(new Map());
  const lastDialogsUpdateRef = useRef<Map<string, number>>(new Map());
  const readStatusesRef = useRef<Set<string>>(new Set());

  // Обработка ошибок
  const processedErrorsRef = useRef<Set<string>>(new Set());
  const accessDeniedProcessingRef = useRef<Map<string, number>>(new Map());

  // Статусы сообщений
  const deliveredStatusesRef = useRef<Set<string>>(new Set());
  const statusSendingInProgressRef = useRef<Set<string>>(new Set());
  const processedDialogStatusesRef = useRef<Set<string>>(new Set());
  const failedStatusAttemptsRef = useRef<Map<string, number>>(new Map());
  const processedReadStatusesRef = useRef<Set<string>>(new Set());
  const readStatusTimestampsRef = useRef<Map<string, number>>(new Map());
  const deliveredSendingInProgressRef = useRef<Set<string>>(new Set());
  const lastDeliveredSendTimeRef = useRef<Map<string, number>>(new Map());
  const processedDeliveryConfirmsRef = useRef<Set<string>>(new Set());
  const readStatusOnOpenSendingRef = useRef<Set<string>>(new Set());
  /** READ отправить только после подтверждения DELIVERED от бэка: uuid -> sessionId */
  const pendingReadAfterDeliveredConfirmRef = useRef<Map<string, string>>(new Map());
  /** Бэк уже прислал подтверждение DELIVERED для этого uuid (можно отправлять READ) */
  const deliveredConfirmedByBackendRef = useRef<Set<string>>(new Set());

  // Обработка входящих сообщений
  const processedIncomingMessagesRef = useRef<Set<string>>(new Set());
  const lastUnreadUpdateRef = useRef<number>(0);

  // Обновление диалогов
  const refreshDialogsInProgressRef = useRef<Set<string>>(new Set());
  const forceLoadUnreadDialogsDebounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastSessionRefreshRef = useRef<Map<string, number>>(new Map());
  const refreshingSessionsRef = useRef<Set<string>>(new Set());

  // История и пагинация
  const loadedDialogsHistoryRef = useRef<Set<string>>(new Set());
  const historyRefreshInProgressRef = useRef<Set<string>>(new Set());
  const refreshMessagesDebounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const syncHistoryDebounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const loadedPagesRef = useRef<Map<string, Set<number>>>(new Map());
  const pageLoadingInProgressRef = useRef<Set<string>>(new Set());
  const lastScrollTimeRef = useRef<Map<string, number>>(new Map());

  // Пагинация сообщений
  const loadingMoreMessagesRef = useRef<Set<string>>(new Set());
  const messagesPaginationStateRef = useRef<Map<string, ChatPagination>>(new Map());
  const loadMoreTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Загрузка диалогов
  const dialogLoadingInProgressRef = useRef<Map<string, boolean>>(new Map());
  const loadHistoryInProgressRef = useRef<Map<string, boolean>>(new Map());
  const dialogTotalElementsCacheRef = useRef<Map<string, number>>(new Map());
  const lastDialogHistoryUpdateRef = useRef<Map<string, number>>(new Map());

  // Локальные сообщения
  const recentLocalMessagesRef = useRef<Map<string, Set<string>>>(new Map());

  // Авто-обновление
  const openSessionsForAutoRefreshRef = useRef<Set<string>>(new Set());

  return {
    prevIsChatOpenRef,
    loadingSessionsRef,
    assignedDialogsRef,
    processedErrorsRef,
    accessDeniedProcessingRef,
    sessionCreationTimeRef,
    deliveredStatusesRef,
    statusSendingInProgressRef,
    processedDialogStatusesRef,
    failedStatusAttemptsRef,
    lastUnreadUpdateRef,
    processedIncomingMessagesRef,
    lastDialogsUpdateRef,
    readStatusesRef,
    deliveredSendingInProgressRef,
    lastDeliveredSendTimeRef,
    refreshDialogsInProgressRef,
    processedDeliveryConfirmsRef,
    forceLoadUnreadDialogsDebounceRef,
    lastSessionRefreshRef,
    refreshingSessionsRef,
    loadedDialogsHistoryRef,
    processedReadStatusesRef,
    readStatusTimestampsRef,
    historyRefreshInProgressRef,
    readStatusOnOpenSendingRef,
    pendingReadAfterDeliveredConfirmRef,
    deliveredConfirmedByBackendRef,
    openSessionsForAutoRefreshRef,
    refreshMessagesDebounceRef,
    syncHistoryDebounceRef,
    loadingMoreMessagesRef,
    messagesPaginationStateRef,
    loadMoreTimeoutsRef,
    dialogLoadingInProgressRef,
    loadHistoryInProgressRef,
    dialogTotalElementsCacheRef,
    lastDialogHistoryUpdateRef,
    recentLocalMessagesRef,
    loadedPagesRef,
    pageLoadingInProgressRef,
    lastScrollTimeRef,
  };
};

export type ChatRefs = ReturnType<typeof useChatRefs>;
