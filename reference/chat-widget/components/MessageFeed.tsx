import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BsArrowDown, BsCheck2, BsCheck2All, BsPencil } from 'react-icons/bs';
import { FaReply, FaTimes, FaTrash } from 'react-icons/fa';

import dayjs from 'dayjs';

import { CircularProgress } from '@mui/material';

import { useChat } from '../contexts/ChatContext';
import { isOperatorUnreadDebugEnabled, operatorUnreadDebug } from '../lib/operatorUnreadDebugLog';
import styles from './MessageFeed.module.scss';

interface MessageFeedProps {
  sessionId: string;
  messages: any[];
  onReplyToMessage?: (message: any) => void;
  onDeleteMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string, newText: string) => void;
  currentUserId?: number;
  attachments?: File[];
  onRemoveAttachment?: (index: number) => void;
  userId?: number;
  onLoadMore?: (page: number) => void;
  isLoading?: boolean;
  hasMore?: boolean;
  selectedUserName?: string;
  currentPage?: number;
  totalPages?: number;
  onMarkMessagesAsRead?: (messageIds: string[]) => void;
  unreadCount?: number;
  expandUnreadHintCount?: number;
  scrollToBottomOnExpand?: boolean;
  onScrollToBottomDone?: () => void;
  dialogStatus?: string;
  isDialogBlockedByOtherOperator?: boolean;
  isDialogEnded?: boolean;
}

/**
 * Согласовано с подсчётом непрочитанных в ChatPanel (relaxed): любой входящий без READ.
 * Иначе при статусе с бэка вне SENT/DELIVERED скролл к первому непрочитанному не находит якорь, хотя бейдж > 0.
 */
function isInboundUnread(msg: any): boolean {
  if (msg.messageStatus !== 'TO_OPERATOR') return false;
  if (msg.is_read) return false;
  const confirmStatus = String(msg.confirmStatus ?? '')
    .trim()
    .toUpperCase();
  if (confirmStatus === 'READ') return false;
  return true;
}

/** Совпадает с id строки сообщения в DOM: `message-${id ?? uuid ?? index}` (без index здесь). */
function messageRowDomSuffix(msg: any): string {
  const raw = msg?.id ?? msg?.uuid;
  if (raw == null || raw === '') return '';
  return String(raw);
}

function findFirstUnreadMessage(messages: any[]): { msg: any; index: number } | null {
  if (!messages.length) return null;
  for (let i = 0; i < messages.length; i++) {
    if (isInboundUnread(messages[i])) {
      return { msg: messages[i], index: i };
    }
  }
  return null;
}

/** Снимок ленты для отладки скролла к первому непрочитанному (вкл. CHAT_UNREAD_DEBUG / dev). */
function buildMessageTapeScrollDebugRows(messages: any[]) {
  return messages.map((msg, index) => ({
    index,
    id: msg?.id ?? null,
    uuid: msg?.uuid ?? null,
    domSuffix: messageRowDomSuffix(msg) || '(нет id/uuid)',
    dialogId: msg?.dialogId ?? msg?.dialog?.id ?? null,
    messageStatus: msg?.messageStatus ?? null,
    confirmStatus: msg?.confirmStatus ?? null,
    confirmUpper:
      String(msg?.confirmStatus ?? '')
        .trim()
        .toUpperCase() || '(пусто)',
    is_read: !!msg?.is_read,
    inboundUnread: isInboundUnread(msg),
    textPreview: String(msg?.text ?? '').slice(0, 48),
  }));
}

function collectDomMessageIdsInFeed(container: HTMLElement | null, limit = 40): string[] {
  if (!container) return [];
  const nodes = container.querySelectorAll('[id^="message-"]');
  const out: string[] = [];
  for (let i = 0; i < nodes.length && out.length < limit; i++) {
    const id = nodes[i].id?.replace(/^message-/, '') ?? '';
    if (id) out.push(id);
  }
  return out;
}

function findTopVisibleMessageIdInContainer(container: HTMLElement): string | null {
  const containerRect = container.getBoundingClientRect();
  const messagesElements = container.querySelectorAll('[id^="message-"]');
  for (let i = 0; i < messagesElements.length; i++) {
    const element = messagesElements[i];
    const rect = element.getBoundingClientRect();
    if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
      const messageId = element.id.replace('message-', '');
      return messageId || null;
    }
  }
  return null;
}

function resolveFeedDialogIdFromSession(session: any, allMessages: any[]): string | null {
  let id =
    session?.selectedDialog?.id && String(session.selectedDialog.id) !== '0'
      ? String(session.selectedDialog.id)
      : session?.assignedDialogId &&
          String(session.assignedDialogId) !== '0' &&
          String(session.assignedDialogId) !== 'assigned'
        ? String(session.assignedDialogId)
        : null;
  if (id == null && Array.isArray(allMessages) && allMessages.length > 0) {
    const m = allMessages.find((x: any) => x.dialogId != null || x.dialog?.id != null);
    if (m) id = String(m.dialogId ?? m.dialog?.id ?? '');
  }
  return id && id !== '' ? id : null;
}

function parseMessageTimeMs(msg: any): number {
  const raw = msg?.created_at ?? msg?.createdAt ?? null;
  if (!raw) return Number.POSITIVE_INFINITY;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

function MessageFeed({
  sessionId,
  messages,
  onReplyToMessage,
  onDeleteMessage,
  onEditMessage,
  attachments = [],
  onRemoveAttachment,
  selectedUserName,
  onMarkMessagesAsRead,
  unreadCount: externalUnreadCount,
  expandUnreadHintCount = 0,
  scrollToBottomOnExpand,
  onScrollToBottomDone,
  dialogStatus = '',
  isDialogBlockedByOtherOperator = false,
  isDialogEnded = false,
}: MessageFeedProps) {
  const { t } = useTranslation();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [deletedMessages, setDeletedMessages] = useState<Set<string>>(new Set());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [internalUnreadCount, setInternalUnreadCount] = useState<number>(0);
  const [lastSeenMessageId, setLastSeenMessageId] = useState<string | null>(null);
  const visibleMessagesIds = useRef<Set<string>>(new Set());
  const sentReadStatusesRef = useRef<Map<string, number>>(new Map());

  const readSentTrackingKeys = useCallback((msg: any): string[] => {
    const keys: string[] = [];
    if (msg?.uuid != null && String(msg.uuid).trim() !== '') keys.push(String(msg.uuid));
    if (msg?.id != null) keys.push(String(msg.id));
    return keys;
  }, []);

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const needsScrollToBottomRef = useRef(false);
  const expandScrollPendingRef = useRef(false);
  const freezeAutoBottomUntilUserScrollRef = useRef(false);
  const programmaticScrollLockRef = useRef(false);
  const needsScrollToFirstUnreadRef = useRef(false);
  const suppressBottomScrollAfterExpandUnreadRef = useRef(false);
  const scrollDoneCallbackRef = useRef<(() => void) | undefined>(undefined);
  const prevMessageLenRef = useRef(messages.length);
  const hasScrolledToFirstUnreadRef = useRef(false);
  const scrollAttemptsRef = useRef(0);
  const prevScrollToBottomOnExpandRef = useRef(false);
  const prevFeedDialogIdForScrollRef = useRef<string | null>(null);

  const scrollDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastScrollPositionRef = useRef<number>(0);
  const scrollDirectionRef = useRef<'up' | 'down' | null>(null);
  const scrollTriggerHistoryRef = useRef<{ up: boolean; down: boolean }>({
    up: false,
    down: false,
  });

  const {
    getSession,
    loadPreviousMessages,
    loadNextMessages,
    navigateToQuotedMessage,
    loadFirstPageMessages,
  } = useChat();
  const loadingMoreRef = useRef(false);
  const loadingNextRef = useRef(false);
  const loadFirstPageRef = useRef(false);

  const scrollHeightBeforeLoadRef = useRef<number>(0);
  const firstVisibleMessageIdRef = useRef<string | null>(null);

  const isLoadInProgressRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);

  const session = getSession(sessionId);
  const pagination = session?.pagination;

  const canInteractWithMessages =
    dialogStatus === 'CLOSED' && !isDialogBlockedByOtherOperator && !isDialogEnded;

  const feedDialogId = useMemo(
    () => resolveFeedDialogIdFromSession(session, messages),
    [session, messages],
  );

  const messagesInActiveDialog = useMemo(() => {
    if (!feedDialogId) return [];
    const filtered = messages.filter(
      (msg) => String(msg.dialogId ?? msg.dialog?.id ?? '') === feedDialogId,
    );
    return [...filtered].sort((a: any, b: any) => {
      const idA = Number(a.id);
      const idB = Number(b.id);
      if (Number.isFinite(idA) && Number.isFinite(idB) && idA !== idB) {
        return idA - idB;
      }
      const ta = parseMessageTimeMs(a);
      const tb = parseMessageTimeMs(b);
      if (ta !== tb) return ta - tb;
      return 0;
    });
  }, [messages, feedDialogId]);

  const hasUnreadOnExpandHint =
    !!scrollToBottomOnExpand &&
    (expandUnreadHintCount > 0 || messagesInActiveDialog.some(isInboundUnread));

  const feedTapeDebugKey = useMemo(
    () =>
      messagesInActiveDialog
        .map(
          (m) =>
            `${m.id ?? m.uuid ?? '?'}:${String(m.confirmStatus ?? '')}:${m.messageStatus ?? ''}:${m.is_read ? 1 : 0}`,
        )
        .join('|'),
    [messagesInActiveDialog],
  );

  useEffect(() => {
    if (!isOperatorUnreadDebugEnabled()) return;
    operatorUnreadDebug('MessageFeed: снимок ленты и флагов', {
      sessionId,
      scrollToBottomOnExpand,
      expandUnreadHintCount,
      feedDialogId,
      длинаЛентыАктивногоДиалога: messagesInActiveDialog.length,
      всегоСообщенийВПропе: messages.length,
      непрочитанныхПоЛентеInbound: messagesInActiveDialog.filter(isInboundUnread).length,
    });
  }, [
    sessionId,
    scrollToBottomOnExpand,
    expandUnreadHintCount,
    feedDialogId,
    messages.length,
    feedTapeDebugKey,
    messagesInActiveDialog.length,
  ]);

  const calculateUnreadMessages = useCallback(() => {
    let count = 0;
    for (let i = messagesInActiveDialog.length - 1; i >= 0; i--) {
      const msg = messagesInActiveDialog[i];
      if (isInboundUnread(msg)) {
        count++;
      }
      if (lastSeenMessageId && msg.id === lastSeenMessageId) {
        break;
      }
    }
    return count;
  }, [messagesInActiveDialog, lastSeenMessageId]);

  const sendReadStatusForVisibleMessages = useCallback(() => {
    if (!onMarkMessagesAsRead) return;
    if (
      expandScrollPendingRef.current ||
      needsScrollToFirstUnreadRef.current ||
      freezeAutoBottomUntilUserScrollRef.current
    ) {
      return;
    }
    if (visibleMessagesIds.current.size === 0) return;

    const messagesToMarkAsRead: string[] = [];

    messagesInActiveDialog.forEach((msg) => {
      const messageIdentifier = msg.id ? String(msg.id) : null;
      const trackKeys = readSentTrackingKeys(msg);
      const callbackId =
        msg.uuid != null && String(msg.uuid).trim() !== ''
          ? String(msg.uuid)
          : msg.id != null
            ? String(msg.id)
            : '';

      if (!callbackId) return;

      const isVisible = messageIdentifier
        ? visibleMessagesIds.current.has(messageIdentifier)
        : msg.uuid
          ? visibleMessagesIds.current.has(String(msg.uuid))
          : false;
      const now = Date.now();
      const readSendTtlMs = 3500;
      const alreadySent = trackKeys.some((k) => {
        const ts = sentReadStatusesRef.current.get(k);
        return ts != null && now - ts < readSendTtlMs;
      });

      const cs = String(msg.confirmStatus ?? '')
        .trim()
        .toUpperCase();
      const canSendRead = (cs === 'DELIVERED' || cs === 'SENT') && !alreadySent;
      const shouldSend = isVisible && msg.messageStatus === 'TO_OPERATOR' && canSendRead;

      if (shouldSend) {
        messagesToMarkAsRead.push(callbackId);
        trackKeys.forEach((k) => sentReadStatusesRef.current.set(k, now));
      }
    });

    if (messagesToMarkAsRead.length > 0) {
      operatorUnreadDebug('Sending READ by visibility', {
        sessionId,
        dialogId: feedDialogId,
        ids: messagesToMarkAsRead,
      });
      messagesToMarkAsRead.forEach((messageId, index) => {
        setTimeout(() => {
          onMarkMessagesAsRead([messageId]);
        }, index * 500);
      });
    }
  }, [messagesInActiveDialog, onMarkMessagesAsRead, sessionId, feedDialogId, readSentTrackingKeys]);

  useEffect(() => {
    const count = calculateUnreadMessages();
    setInternalUnreadCount(count);
  }, [messages, calculateUnreadMessages]);

  const unreadCount = externalUnreadCount !== undefined ? externalUnreadCount : internalUnreadCount;

  const messagesJustLoaded = messages.length > 0 && prevMessageLenRef.current === 0;
  prevMessageLenRef.current = messages.length;

  useEffect(() => {
    if (scrollToBottomOnExpand) {
      const expandBecameTrue = !prevScrollToBottomOnExpandRef.current;
      const dialogChanged = feedDialogId !== prevFeedDialogIdForScrollRef.current;
      prevScrollToBottomOnExpandRef.current = true;
      const shouldStartExpandFlow = dialogChanged || expandBecameTrue;

      if (dialogChanged) {
        prevFeedDialogIdForScrollRef.current = feedDialogId;
        hasScrolledToFirstUnreadRef.current = false;
        scrollAttemptsRef.current = 0;
      } else if (expandBecameTrue) {
        hasScrolledToFirstUnreadRef.current = false;
        scrollAttemptsRef.current = 0;
      }

      // Если expand уже инициирован ранее (до прихода ленты), не выходим:
      // нужно дождаться появления сообщений и выполнить скролл к первому непрочитанному.
      if (!shouldStartExpandFlow && !expandScrollPendingRef.current) {
        return;
      }
      expandScrollPendingRef.current = true;

      const firstUnread = findFirstUnreadMessage(messagesInActiveDialog);
      const hasUnreadInbound = !!firstUnread;
      const shouldScrollToFirstUnread = hasUnreadInbound || expandUnreadHintCount > 0;

      needsScrollToFirstUnreadRef.current = shouldScrollToFirstUnread;

      if (shouldScrollToFirstUnread) {
        suppressBottomScrollAfterExpandUnreadRef.current = true;
        freezeAutoBottomUntilUserScrollRef.current = true;
        needsScrollToBottomRef.current = false;

        operatorUnreadDebug('Expand with unread: will scroll to first unread', {
          sessionId,
          feedDialogId,
          expandUnreadHintCount,
          firstUnreadIndex: firstUnread?.index ?? null,
          firstUnreadId: firstUnread?.msg?.id ?? null,
          firstUnreadUuid: firstUnread?.msg?.uuid ?? null,
          firstUnreadDomSuffix: firstUnread ? messageRowDomSuffix(firstUnread.msg) : null,
          лентаСообщений: buildMessageTapeScrollDebugRows(messagesInActiveDialog),
        });
      } else if (messagesInActiveDialog.length > 0) {
        needsScrollToBottomRef.current = true;
        needsScrollToFirstUnreadRef.current = false;
        suppressBottomScrollAfterExpandUnreadRef.current = false;
      }
      return;
    }

    prevScrollToBottomOnExpandRef.current = false;

    if (
      ((messages.length > 0 && isInitialLoad) || messagesJustLoaded) &&
      !suppressBottomScrollAfterExpandUnreadRef.current &&
      !expandScrollPendingRef.current
    ) {
      needsScrollToFirstUnreadRef.current = false;
      needsScrollToBottomRef.current = true;
    }
  }, [
    scrollToBottomOnExpand,
    messagesInActiveDialog,
    expandUnreadHintCount,
    sessionId,
    feedDialogId,
    messages.length,
    isInitialLoad,
    messagesJustLoaded,
  ]);

  useEffect(() => {
    scrollDoneCallbackRef.current = onScrollToBottomDone;
  });

  useEffect(() => {
    if (messages.length > 0 && isInitialLoad) {
      setIsInitialLoad(false);
      if (
        !needsScrollToFirstUnreadRef.current &&
        !hasUnreadOnExpandHint &&
        !suppressBottomScrollAfterExpandUnreadRef.current
      ) {
        needsScrollToBottomRef.current = true;
      }

      const lastReadMessage = [...messages]
        .reverse()
        .find((msg) => msg.messageStatus === 'TO_OPERATOR' && msg.confirmStatus === 'READ');
      if (lastReadMessage) {
        setLastSeenMessageId(lastReadMessage.id);
      } else if (messagesInActiveDialog.length > 0) {
        setLastSeenMessageId(messagesInActiveDialog[messagesInActiveDialog.length - 1].id);
      }
    }
  }, [messages, messagesInActiveDialog, isInitialLoad, hasUnreadOnExpandHint]);

  useLayoutEffect(() => {
    if (hasUnreadOnExpandHint) return;
    if (suppressBottomScrollAfterExpandUnreadRef.current) return;
    if (expandScrollPendingRef.current) return;
    if (freezeAutoBottomUntilUserScrollRef.current) return;
    if (messagesInActiveDialog.some(isInboundUnread)) return;
    if (needsScrollToFirstUnreadRef.current) return;
    if (!needsScrollToBottomRef.current) return;
    const container = scrollRef.current;
    if (!container || messages.length === 0) return;
    container.scrollTop = container.scrollHeight;
  }, [hasUnreadOnExpandHint, messages.length, messagesInActiveDialog]);

  const getFirstVisibleMessageId = useCallback((): string | null => {
    if (!scrollRef.current || messages.length === 0) return null;
    const container = scrollRef.current;
    const containerRect = container.getBoundingClientRect();
    const messagesElements = container.querySelectorAll('[id^="message-"]');
    for (let i = 0; i < messagesElements.length; i++) {
      const element = messagesElements[i];
      const rect = element.getBoundingClientRect();
      if (rect.top >= containerRect.top && rect.bottom <= containerRect.bottom) {
        const messageId = element.id.replace('message-', '');
        return messageId || null;
      }
    }
    for (let i = 0; i < messagesElements.length; i++) {
      const element = messagesElements[i];
      const rect = element.getBoundingClientRect();
      if (rect.top >= containerRect.top && rect.top <= containerRect.bottom) {
        const messageId = element.id.replace('message-', '');
        return messageId || null;
      }
    }
    return null;
  }, [messages]);

  const saveScrollState = useCallback(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    scrollHeightBeforeLoadRef.current = container.scrollHeight;
    firstVisibleMessageIdRef.current = getFirstVisibleMessageId();
  }, [getFirstVisibleMessageId]);

  const restoreScrollPosition = useCallback(() => {
    if (
      !scrollRef.current ||
      !scrollHeightBeforeLoadRef.current ||
      !firstVisibleMessageIdRef.current
    )
      return;
    const container = scrollRef.current;
    const newScrollHeight = container.scrollHeight;
    const heightDifference = newScrollHeight - scrollHeightBeforeLoadRef.current;
    if (heightDifference > 0 && firstVisibleMessageIdRef.current) {
      const targetElement = document.getElementById(`message-${firstVisibleMessageIdRef.current}`);
      if (targetElement) {
        setTimeout(() => targetElement.scrollIntoView({ block: 'start', behavior: 'auto' }), 50);
      } else {
        setTimeout(() => (container.scrollTop = container.scrollTop + heightDifference), 50);
      }
    }
    scrollHeightBeforeLoadRef.current = 0;
    firstVisibleMessageIdRef.current = null;
  }, []);

  const updateVisibleMessages = useCallback(() => {
    if (!scrollRef.current) return;
    const container = scrollRef.current;
    const messagesElements = container.querySelectorAll('[id^="message-"]');
    const newVisibleIds = new Set<string>();
    const containerRect = container.getBoundingClientRect();
    messagesElements.forEach((element) => {
      const rect = element.getBoundingClientRect();
      const messageIdAttr = element.getAttribute('data-message-id');
      const messageIdentifier = messageIdAttr;
      const messageUuid = !messageIdAttr ? element.getAttribute('data-message-uuid') : null;
      const intersectionTop = Math.max(rect.top, containerRect.top);
      const intersectionBottom = Math.min(rect.bottom, containerRect.bottom);
      const visibleHeight = Math.max(0, intersectionBottom - intersectionTop);
      // Сообщение считаем "прочитанным по видимости" только если видна заметная часть,
      // а не случайные 1-2px на границе viewport.
      const minVisiblePx = Math.min(24, rect.height * 0.35);
      const isVisible = visibleHeight >= minVisiblePx;
      if (isVisible) {
        if (messageIdentifier) newVisibleIds.add(messageIdentifier);
        else if (messageUuid) newVisibleIds.add(messageUuid);
      }
    });
    visibleMessagesIds.current = newVisibleIds;
  }, []);

  const handleLoadPreviousMessages = useCallback(async () => {
    if (isLoadInProgressRef.current) return;
    const now = Date.now();
    if (now - lastLoadTimeRef.current < 500) return;
    if (!pagination?.hasMoreMessages || pagination?.isLoadingMore || loadingMoreRef.current) return;
    saveScrollState();
    isLoadInProgressRef.current = true;
    lastLoadTimeRef.current = now;
    loadingMoreRef.current = true;
    try {
      await loadPreviousMessages(sessionId);
    } catch (error) {
      console.error('Error loading previous messages:', error);
    } finally {
      setTimeout(() => {
        isLoadInProgressRef.current = false;
      }, 1000);
    }
  }, [pagination, sessionId, loadPreviousMessages, saveScrollState]);

  const handleLoadNextMessages = useCallback(async () => {
    if (isLoadInProgressRef.current) return;
    const now = Date.now();
    if (now - lastLoadTimeRef.current < 500) return;
    if (!pagination?.hasNextMessages || pagination?.isLoadingNext || loadingNextRef.current) return;
    saveScrollState();
    isLoadInProgressRef.current = true;
    lastLoadTimeRef.current = now;
    loadingNextRef.current = true;
    try {
      await loadNextMessages(sessionId);
    } catch (error) {
      console.error('Error loading next messages:', error);
    } finally {
      setTimeout(() => {
        isLoadInProgressRef.current = false;
      }, 1000);
    }
  }, [pagination, sessionId, loadNextMessages, saveScrollState]);

  const handleLoadFirstPage = useCallback(async () => {
    if (isLoadInProgressRef.current) return;
    const now = Date.now();
    if (now - lastLoadTimeRef.current < 500) return;
    if (!session?.selectedDialog?.id || session.selectedDialog.id === '0') return;
    isLoadInProgressRef.current = true;
    lastLoadTimeRef.current = now;
    loadFirstPageRef.current = true;
    try {
      await loadFirstPageMessages(sessionId, session.selectedDialog.id);
    } catch (error) {
      console.error('Error loading first page:', error);
    } finally {
      setTimeout(() => {
        isLoadInProgressRef.current = false;
        loadFirstPageRef.current = false;
        setTimeout(() => {
          const container = scrollRef.current;
          if (!container) return;
          if (
            suppressBottomScrollAfterExpandUnreadRef.current ||
            needsScrollToFirstUnreadRef.current
          )
            return;
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
          setIsAtBottom(true);
          if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            setLastSeenMessageId(lastMessage.id);
            setInternalUnreadCount(0);
          }
        }, 200);
      }, 1000);
    }
  }, [sessionId, session?.selectedDialog?.id, loadFirstPageMessages, messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (loadingMoreRef.current) {
      setTimeout(() => {
        restoreScrollPosition();
        setTimeout(() => {
          loadingMoreRef.current = false;
        }, 100);
      }, 100);
    }
    if (loadingNextRef.current || loadFirstPageRef.current) {
      setTimeout(() => {
        loadingNextRef.current = false;
        loadFirstPageRef.current = false;
      }, 100);
    }
  }, [messages, restoreScrollPosition]);

  const handleScroll = useCallback(() => {
    if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
    scrollDebounceRef.current = setTimeout(() => {
      if (!scrollRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const currentScrollTop = scrollTop;
      if (lastScrollPositionRef.current !== null) {
        scrollDirectionRef.current =
          currentScrollTop > lastScrollPositionRef.current ? 'down' : 'up';
      }
      lastScrollPositionRef.current = currentScrollTop;
      const isBottom = scrollHeight - scrollTop - clientHeight < 100;
      setIsAtBottom(isBottom);
      if (freezeAutoBottomUntilUserScrollRef.current && !programmaticScrollLockRef.current) {
        freezeAutoBottomUntilUserScrollRef.current = false;
      }
      updateVisibleMessages();
      const shouldShowButton = !isBottom;
      setShowScrollButton(shouldShowButton);
      if (scrollTop < 100 && scrollDirectionRef.current === 'up') {
        if (!scrollTriggerHistoryRef.current.up) {
          if (
            pagination?.hasMoreMessages &&
            !pagination?.isLoadingMore &&
            !loadingMoreRef.current &&
            !isLoadInProgressRef.current
          ) {
            scrollTriggerHistoryRef.current.up = true;
            scrollTriggerHistoryRef.current.down = false;
            handleLoadPreviousMessages();
          }
        }
      }
      if (isBottom && scrollDirectionRef.current === 'down') {
        if (!scrollTriggerHistoryRef.current.down) {
          if (
            pagination?.hasNextMessages &&
            !pagination?.isLoadingNext &&
            !loadingNextRef.current &&
            !isLoadInProgressRef.current
          ) {
            scrollTriggerHistoryRef.current.down = true;
            scrollTriggerHistoryRef.current.up = false;
            handleLoadNextMessages();
          }
        }
      }
      if (scrollTop >= 100 && !isBottom) {
        scrollTriggerHistoryRef.current.up = false;
        scrollTriggerHistoryRef.current.down = false;
      } else if (scrollTop < 100 && scrollDirectionRef.current === 'down') {
        scrollTriggerHistoryRef.current.up = false;
      } else if (isBottom && scrollDirectionRef.current === 'up') {
        scrollTriggerHistoryRef.current.down = false;
      }
      if (isBottom && messagesInActiveDialog.length > 0) {
        const stillUnreadInbound = messagesInActiveDialog.some(isInboundUnread);
        const lastMessage = messagesInActiveDialog[messagesInActiveDialog.length - 1];
        if (!stillUnreadInbound && lastMessage.id !== lastSeenMessageId) {
          setLastSeenMessageId(lastMessage.id);
          setInternalUnreadCount(0);
        }
        if (
          isBottom &&
          !stillUnreadInbound &&
          !needsScrollToFirstUnreadRef.current &&
          !hasUnreadOnExpandHint
        ) {
          suppressBottomScrollAfterExpandUnreadRef.current = false;
        }
      }
      sendReadStatusForVisibleMessages();
    }, 200);
  }, [
    messagesInActiveDialog,
    pagination,
    handleLoadPreviousMessages,
    handleLoadNextMessages,
    updateVisibleMessages,
    lastSeenMessageId,
    sendReadStatusForVisibleMessages,
    hasUnreadOnExpandHint,
  ]);

  useEffect(() => {
    const scrollContainer = scrollRef.current;
    if (scrollContainer) {
      scrollContainer.addEventListener('scroll', handleScroll);
      setTimeout(updateVisibleMessages, 100);
      return () => scrollContainer.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll, updateVisibleMessages]);

  useEffect(() => {
    sendReadStatusForVisibleMessages();
  }, [sendReadStatusForVisibleMessages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const t = setTimeout(() => {
      updateVisibleMessages();
      sendReadStatusForVisibleMessages();
    }, 150);
    return () => clearTimeout(t);
  }, [messages.length, sessionId, updateVisibleMessages, sendReadStatusForVisibleMessages]);

  useEffect(() => {
    if (hasUnreadOnExpandHint) return;
    if (suppressBottomScrollAfterExpandUnreadRef.current) return;
    if (expandScrollPendingRef.current) return;
    if (freezeAutoBottomUntilUserScrollRef.current) return;
    if (messagesInActiveDialog.some(isInboundUnread)) return;
    if (!needsScrollToBottomRef.current || messages.length === 0) return;
    if (needsScrollToFirstUnreadRef.current) return;

    let stopped = false;
    let attempts = 0;
    const maxAttempts = 120;
    const tryScroll = () => {
      if (stopped) return;
      const c = scrollRef.current;
      if (!c) return;
      c.scrollTop = c.scrollHeight;
      attempts++;
      const isAtBot = c.scrollHeight - c.scrollTop - c.clientHeight < 5;
      const hasContent = c.scrollHeight > c.clientHeight + 10;
      if ((isAtBot && hasContent) || attempts >= maxAttempts) {
        stopped = true;
        needsScrollToBottomRef.current = false;
        setIsAtBottom(true);
        scrollDoneCallbackRef.current?.();
      }
    };
    const intervalId = setInterval(tryScroll, 50);
    tryScroll();
    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
  }, [messages, hasUnreadOnExpandHint, messagesInActiveDialog]);

  // Reset flags on session change
  useEffect(() => {
    suppressBottomScrollAfterExpandUnreadRef.current = false;
    expandScrollPendingRef.current = false;
    freezeAutoBottomUntilUserScrollRef.current = false;
    hasScrolledToFirstUnreadRef.current = false;
    scrollAttemptsRef.current = 0;
    prevScrollToBottomOnExpandRef.current = false;
    prevFeedDialogIdForScrollRef.current = null;
  }, [sessionId]);

  // Прокрутка к первому непрочитанному: useLayoutEffect + rAF, ключ DOM = id ?? uuid (как в разметке)
  useLayoutEffect(() => {
    if (!scrollToBottomOnExpand) return;
    if (hasScrolledToFirstUnreadRef.current) return;
    if (messagesInActiveDialog.length === 0) {
      operatorUnreadDebug('First-unread scroll: SKIP (лента пустая)', { sessionId, feedDialogId });
      return;
    }

    const tapeRows = buildMessageTapeScrollDebugRows(messagesInActiveDialog);
    const firstUnread = findFirstUnreadMessage(messagesInActiveDialog);

    operatorUnreadDebug('First-unread scroll: старт layout-effect', {
      sessionId,
      feedDialogId,
      scrollToBottomOnExpand,
      expandUnreadHintCount,
      needsScrollToFirstUnreadRef: needsScrollToFirstUnreadRef.current,
      якорьИндекс: firstUnread?.index ?? null,
      якорьDomSuffix: firstUnread ? messageRowDomSuffix(firstUnread.msg) : null,
      лентаСообщений: tapeRows,
    });

    if (!firstUnread) {
      operatorUnreadDebug(
        'First-unread scroll: нет якоря (findFirstUnread пусто), сбрасываем флаги',
        {
          sessionId,
          feedDialogId,
          лентаСообщений: tapeRows,
        },
      );
      expandScrollPendingRef.current = false;
      needsScrollToFirstUnreadRef.current = false;
      freezeAutoBottomUntilUserScrollRef.current = false;
      return;
    }

    const domSuffix = messageRowDomSuffix(firstUnread.msg);
    if (!domSuffix) {
      operatorUnreadDebug('Scroll skip: first unread has no id/uuid for DOM', {
        sessionId,
        feedDialogId,
        якорьСообщение: tapeRows[firstUnread.index] ?? null,
        лентаСообщений: tapeRows,
      });
      expandScrollPendingRef.current = false;
      needsScrollToFirstUnreadRef.current = false;
      freezeAutoBottomUntilUserScrollRef.current = false;
      return;
    }

    operatorUnreadDebug('First-unread scroll: ищем DOM и прокручиваем', {
      sessionId,
      feedDialogId,
      domSuffix,
      якорьИндекс: firstUnread.index,
      якорьСтрока: tapeRows[firstUnread.index] ?? null,
    });

    let cancelled = false;
    const maxAttempts = 20;

    const scrollToMessage = (attempt: number) => {
      if (cancelled) return;
      const targetElement = document.getElementById(`message-${domSuffix}`);
      const container = scrollRef.current;

      if (attempt === 0 || attempt === 5 || attempt === 10 || attempt === maxAttempts - 1) {
        operatorUnreadDebug('First-unread scroll: попытка DOM', {
          sessionId,
          attempt,
          ищемId: `message-${domSuffix}`,
          domНайден: !!targetElement,
          контейнерНайден: !!container,
          idsВЛенте: collectDomMessageIdsInFeed(container),
        });
      }

      if (targetElement && container) {
        programmaticScrollLockRef.current = true;
        const elementRect = targetElement.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const offsetBottom = 20;
        const scrollToPosition =
          container.scrollTop + (elementRect.bottom - containerRect.bottom) + offsetBottom;
        const appliedTop = Math.max(0, scrollToPosition);
        container.scrollTo({
          top: appliedTop,
          behavior: attempt === 0 ? 'auto' : 'smooth',
        });

        setTimeout(() => {
          programmaticScrollLockRef.current = false;
        }, 400);

        hasScrolledToFirstUnreadRef.current = true;
        needsScrollToFirstUnreadRef.current = false;
        expandScrollPendingRef.current = false;
        freezeAutoBottomUntilUserScrollRef.current = false;

        operatorUnreadDebug('Scroll to first unread COMPLETED (сразу после scrollTo)', {
          sessionId,
          feedDialogId,
          domSuffix,
          attempt,
          scrollToPositionRequested: appliedTop,
          scrollTopФакт: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
          цельОтносительноВьюпортаBottom: containerRect.bottom - elementRect.bottom,
        });

        window.setTimeout(() => {
          const c = scrollRef.current;
          if (!c) return;
          const topVis = findTopVisibleMessageIdInContainer(c);
          const targetAfter = document.getElementById(`message-${domSuffix}`);
          let targetTopAfter: number | null = null;
          if (targetAfter) {
            const cr = c.getBoundingClientRect();
            const tr = targetAfter.getBoundingClientRect();
            targetTopAfter = tr.top - cr.top;
          }
          operatorUnreadDebug('Scroll to first unread: замер после кадра', {
            sessionId,
            feedDialogId,
            domSuffix,
            scrollTop: c.scrollTop,
            scrollHeight: c.scrollHeight,
            первоеВидимоеСообщениеId: topVis,
            якорьОтносительноКонтейнераTop: targetTopAfter,
            совпадениеВерхСЯкорем: topVis === domSuffix || topVis === String(firstUnread.msg.id),
          });
          updateVisibleMessages();
          sendReadStatusForVisibleMessages();
        }, 80);

        return;
      }

      if (attempt < maxAttempts) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToMessage(attempt + 1));
        });
      } else {
        operatorUnreadDebug('Scroll to first unread FAILED after rAF retries', {
          sessionId,
          feedDialogId,
          domSuffix,
          attempts: attempt,
          idsВЛенте: collectDomMessageIdsInFeed(scrollRef.current),
          лентаСообщений: tapeRows,
        });
        expandScrollPendingRef.current = false;
        needsScrollToFirstUnreadRef.current = false;
        freezeAutoBottomUntilUserScrollRef.current = false;
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollToMessage(0));
    });

    return () => {
      cancelled = true;
    };
  }, [
    messagesInActiveDialog,
    scrollToBottomOnExpand,
    sessionId,
    feedDialogId,
    expandUnreadHintCount,
    messages.length,
    updateVisibleMessages,
    sendReadStatusForVisibleMessages,
  ]);

  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) clearTimeout(scrollDebounceRef.current);
    };
  }, []);

  const scrollToBottom = (forceLoadFirstPage: boolean = false) => {
    suppressBottomScrollAfterExpandUnreadRef.current = false;
    const session = getSession(sessionId);
    const dialogId = session?.selectedDialog?.id;
    if (forceLoadFirstPage || (dialogId && dialogId !== '0' && pagination?.currentPage !== 0)) {
      handleLoadFirstPage();
    } else {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        if (messagesInActiveDialog.length > 0) {
          const lastMessage = messagesInActiveDialog[messagesInActiveDialog.length - 1];
          setLastSeenMessageId(lastMessage.id);
          setInternalUnreadCount(0);
        }
        setIsAtBottom(true);
      }
    }
  };

  const markAllUnreadAsReadByJumpToLast = useCallback(() => {
    if (!onMarkMessagesAsRead) return;

    const liveSession = getSession(sessionId);
    const activeDialogId =
      liveSession?.selectedDialog?.id && String(liveSession.selectedDialog.id) !== '0'
        ? String(liveSession.selectedDialog.id)
        : liveSession?.assignedDialogId &&
            String(liveSession.assignedDialogId) !== '' &&
            String(liveSession.assignedDialogId) !== '0' &&
            String(liveSession.assignedDialogId) !== 'assigned'
          ? String(liveSession.assignedDialogId)
          : feedDialogId
            ? String(feedDialogId)
            : null;
    if (!activeDialogId) return;

    const sourceMessages = (liveSession?.messages || []).filter(
      (msg: any) => String(msg.dialogId ?? msg.dialog?.id ?? '') === activeDialogId,
    );

    const now = Date.now();
    const readSendTtlMs = 3500;
    const idsToMark: string[] = [];
    const seenIds = new Set<string>();

    sourceMessages.forEach((msg: any) => {
      if (msg.messageStatus !== 'TO_OPERATOR') return;
      if (msg.is_read) return;

      const cs = String(msg.confirmStatus ?? '')
        .trim()
        .toUpperCase();
      if (cs === 'READ') return;
      if (cs !== 'DELIVERED' && cs !== 'SENT') return;

      const callbackId =
        msg.uuid != null && String(msg.uuid).trim() !== ''
          ? String(msg.uuid)
          : msg.id != null
            ? String(msg.id)
            : '';
      if (!callbackId || seenIds.has(callbackId)) return;

      const trackKeys = readSentTrackingKeys(msg);
      const alreadySent = trackKeys.some((k) => {
        const ts = sentReadStatusesRef.current.get(k);
        return ts != null && now - ts < readSendTtlMs;
      });
      if (alreadySent) return;

      seenIds.add(callbackId);
      idsToMark.push(callbackId);
      trackKeys.forEach((k) => sentReadStatusesRef.current.set(k, now));
    });

    if (idsToMark.length === 0) return;

    operatorUnreadDebug('Jump-to-last: mark ALL unread as READ', {
      sessionId,
      dialogId: feedDialogId,
      ids: idsToMark,
    });
    onMarkMessagesAsRead(idsToMark);
    setInternalUnreadCount(0);
  }, [onMarkMessagesAsRead, getSession, sessionId, feedDialogId, readSentTrackingKeys]);

  const getLiveUnreadInActiveDialog = useCallback((): number => {
    const liveSession = getSession(sessionId);
    const activeDialogId =
      liveSession?.selectedDialog?.id && String(liveSession.selectedDialog.id) !== '0'
        ? String(liveSession.selectedDialog.id)
        : liveSession?.assignedDialogId &&
            String(liveSession.assignedDialogId) !== '' &&
            String(liveSession.assignedDialogId) !== '0' &&
            String(liveSession.assignedDialogId) !== 'assigned'
          ? String(liveSession.assignedDialogId)
          : feedDialogId
            ? String(feedDialogId)
            : null;
    if (!activeDialogId) return 0;

    const sourceMessages = (liveSession?.messages || []).filter(
      (msg: any) => String(msg.dialogId ?? msg.dialog?.id ?? '') === activeDialogId,
    );
    return sourceMessages.reduce((acc: number, msg: any) => {
      if (msg.messageStatus !== 'TO_OPERATOR') return acc;
      if (msg.is_read) return acc;
      const cs = String(msg.confirmStatus ?? '')
        .trim()
        .toUpperCase();
      if (cs === 'READ') return acc;
      if (cs !== 'DELIVERED' && cs !== 'SENT') return acc;
      return acc + 1;
    }, 0);
  }, [getSession, sessionId, feedDialogId]);

  const handleScrollToLastClick = useCallback(async () => {
    const shouldLoadFirstPage = Boolean(pagination?.currentPage && pagination.currentPage !== 0);
    if (shouldLoadFirstPage) {
      await handleLoadFirstPage();
    } else {
      scrollToBottom();
    }
    // Специальное правило только для клика по кнопке "к последнему сообщению":
    // считаем все непрочитанные в текущем диалоге прочитанными.
    if (!shouldLoadFirstPage) {
      markAllUnreadAsReadByJumpToLast();
      return;
    }

    // Для сценария page != 0 ждём фактическую догрузку page=0 и добиваем READ ретраями.
    const startedAt = Date.now();
    const timeoutMs = 3500;
    const stepMs = 140;

    const tryMark = () => {
      markAllUnreadAsReadByJumpToLast();
      const unreadLeft = getLiveUnreadInActiveDialog();
      if (unreadLeft <= 0) return;
      if (Date.now() - startedAt >= timeoutMs) return;
      window.setTimeout(tryMark, stepMs);
    };

    window.setTimeout(tryMark, stepMs);
  }, [
    pagination?.currentPage,
    handleLoadFirstPage,
    scrollToBottom,
    markAllUnreadAsReadByJumpToLast,
    getLiveUnreadInActiveDialog,
  ]);

  const handleReplyClick = (message: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onReplyToMessage) onReplyToMessage(message);
  };

  const handleDeleteClick = (message: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (message.id && canEditOrDelete(message)) {
      setDeletedMessages((prev) => new Set(prev).add(message.id));
      if (onDeleteMessage) onDeleteMessage(message.id);
    }
  };

  const handleEditClick = (message: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (message.id && message.sender === 'user' && canEditOrDelete(message)) {
      setEditingMessageId(message.id);
      setEditText(message.text || '');
    }
  };

  const handleSaveEdit = (messageId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const message = messages.find((m) => m.id === messageId);
    if (onEditMessage && editText.trim() && message && canEditOrDelete(message)) {
      onEditMessage(messageId, editText.trim());
      setEditingMessageId(null);
      setEditText('');
    }
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingMessageId(null);
    setEditText('');
  };

  const findOriginalMessage = (replyToId: string) => {
    const message = messages.find((m) => m.id === replyToId || m.uuid === replyToId);
    if (!message) {
      for (const msg of messages) {
        if (
          msg.replyToMessage &&
          (msg.replyToMessage.id === replyToId || msg.replyToMessage.uuid === replyToId)
        ) {
          return msg.replyToMessage;
        }
      }
    }
    return message;
  };

  const handleQuoteClick = useCallback(
    async (quoteMessage: any, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!quoteMessage) return;
      const session = getSession(sessionId);
      if (!session || !session.selectedDialog?.id) return;
      const dialogId = session.selectedDialog.id;
      const messageCreatedAt = quoteMessage.created_at || quoteMessage.createdAt;
      if (!messageCreatedAt) {
        console.error('No created_at field in quoted message');
        return;
      }
      try {
        await navigateToQuotedMessage(sessionId, dialogId, quoteMessage, 50);
      } catch (error) {
        console.error('Error navigating to quoted message:', error);
      }
    },
    [sessionId, getSession, navigateToQuotedMessage],
  );

  const canEditOrDelete = (message: any): boolean => {
    if (!message.created_at) return false;
    try {
      const messageTime = dayjs(message.created_at);
      const now = dayjs();
      const minutesDiff = now.diff(messageTime, 'minute');
      return minutesDiff < 1;
    } catch (error) {
      return false;
    }
  };

  const handleRemoveAttachment = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onRemoveAttachment) onRemoveAttachment(index);
  };

  const getSenderName = (message: any): string => {
    if (message.messageStatus === 'TO_USER') {
      return (
        message.senderInfo?.fullName ||
        message.senderInfo?.displayName ||
        message.createdBy?.fullName ||
        'You'
      );
    } else if (message.messageStatus === 'TO_OPERATOR') {
      return (
        message.senderInfo?.fullName ||
        message.senderInfo?.displayName ||
        message.createdBy?.fullName ||
        selectedUserName ||
        'Client'
      );
    }
    return message.sender === 'user'
      ? message.senderInfo?.fullName || message.senderInfo?.displayName || 'You'
      : selectedUserName || 'Client';
  };

  const getMessageStyle = (message: any) => {
    if (message.messageStatus === 'TO_USER') return styles.supportMessage;
    if (message.messageStatus === 'TO_OPERATOR') return styles.userMessage;
    return message.sender === 'user' ? styles.supportMessage : styles.userMessage;
  };

  const getStatusIcon = (message: any) => {
    if (message.messageStatus === 'TO_USER') {
      if (message.confirmStatus === 'READ')
        return <BsCheck2All className={styles.delivered} title={t('chat.statusRead')} />;
      if (message.confirmStatus === 'DELIVERED')
        return <BsCheck2All className={styles.sent} title={t('chat.statusDelivered')} />;
      return <BsCheck2 className={styles.sent} title={t('chat.statusSent')} />;
    }
    return null;
  };

  const lastMessagesRef = useRef<any[]>([]);

  useEffect(() => {
    if (!session || !pagination) return;
    const currentPage = pagination.currentPage || 0;
    const prevMessages = lastMessagesRef.current;
    const currentMessages = messagesInActiveDialog;
    if (currentMessages.length > prevMessages.length) {
      const newMessages = currentMessages.slice(prevMessages.length);
      const hasNewInboundUnread = newMessages.some((msg) => isInboundUnread(msg));
      if (hasNewInboundUnread && !isAtBottom) {
        // Оператор просматривает историю: не автоскроллим вниз при новых входящих.
        // Непрочитанное показывается бейджом на кнопке "вниз", переход — только по клику.
        setShowScrollButton(true);
        lastMessagesRef.current = [...currentMessages];
        return;
      }
      const hasNewOperatorMessage = newMessages.some(
        (msg) => msg.messageStatus === 'TO_USER' && msg.confirmStatus === 'SENT',
      );
      if (hasNewOperatorMessage) {
        if (currentPage > 0) {
          handleLoadFirstPage();
        } else {
          setTimeout(() => {
            if (scrollRef.current) {
              const container = scrollRef.current;
              const isAtBottomNow =
                container.scrollHeight - container.scrollTop - container.clientHeight < 50;
              if (!isAtBottomNow)
                container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
              else container.scrollTop = container.scrollHeight;
              if (currentMessages.length > 0) {
                const lastMessage = currentMessages[currentMessages.length - 1];
                setLastSeenMessageId(lastMessage.id);
                setInternalUnreadCount(0);
              }
              setIsAtBottom(true);
            }
          }, 50);
        }
      }
    }
    lastMessagesRef.current = [...currentMessages];
  }, [messagesInActiveDialog, session, pagination, handleLoadFirstPage, isAtBottom]);

  useEffect(() => {
    messages.forEach((msg) => {
      const isRead = String(msg.confirmStatus ?? '').toUpperCase() === 'READ' || msg.is_read;
      if (!isRead) return;
      readSentTrackingKeys(msg).forEach((k) => sentReadStatusesRef.current.delete(k));
    });
  }, [messages, readSentTrackingKeys]);

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const readSendTtlMs = 3500;
      sentReadStatusesRef.current.forEach((ts, key) => {
        if (now - ts >= readSendTtlMs) {
          sentReadStatusesRef.current.delete(key);
        }
      });
    }, 2000);
    return () => clearInterval(cleanupInterval);
  }, []);

  return (
    <>
      <div
        ref={scrollRef}
        className={styles.feed}
        onScroll={handleScroll}
        data-session-id={sessionId}>
        {pagination?.isLoadingMore && (
          <div className={styles.loadingIndicator}>
            <CircularProgress size={20} />
            <p>Loading older messages...</p>
          </div>
        )}

        {messagesInActiveDialog.map((msg, index) => {
          const originalMessage = msg.replyTo
            ? findOriginalMessage(msg.replyTo)
            : msg.replyToMessage;
          const isDeleted = msg.id && deletedMessages.has(msg.id);
          const isEditing = msg.id === editingMessageId;
          const isOperatorMessage = msg.messageStatus === 'TO_USER';
          const canEditDelete = canEditOrDelete(msg) && canInteractWithMessages;
          const showReplyControl = canInteractWithMessages && !!onReplyToMessage;
          const showEditDeleteBar = canEditDelete;
          const showMessageActionsRow = showReplyControl || showEditDeleteBar;
          const senderName = getSenderName(msg);
          const messageStyle = getMessageStyle(msg);
          const statusIcon = getStatusIcon(msg);

          const firstUnread = findFirstUnreadMessage(messagesInActiveDialog);
          const isFirstUnread = firstUnread && String(firstUnread.msg.id) === String(msg.id);

          const isUnread =
            isInboundUnread(msg) &&
            (!lastSeenMessageId ||
              messagesInActiveDialog.findIndex((m) => m.id === msg.id) >
                messagesInActiveDialog.findIndex((m) => m.id === lastSeenMessageId));

          const messageKey = msg.id || msg.uuid || `index-${index}`;

          return (
            <div
              key={messageKey}
              id={`message-${msg.id || msg.uuid || index}`}
              data-message-uuid={msg.uuid}
              data-message-id={msg.id}
              className={`${styles.message} ${messageStyle} ${isDeleted ? styles.deletedMessage : ''} ${isUnread ? styles.unreadMessage : ''} ${isFirstUnread ? styles.firstUnreadMessage : ''}`}>
              <div className={styles.senderName}>{senderName}</div>

              {!isDeleted && (msg.replyTo || msg.replyToMessage) && originalMessage && (
                <div
                  className={styles.replyIndicator}
                  onClick={(e) => handleQuoteClick(originalMessage, e)}
                  style={{ cursor: 'pointer' }}
                  title={t('chat.jumpToQuotedMessage')}>
                  <div className={styles.replyAuthor}>
                    Reply to{' '}
                    {originalMessage.messageStatus === 'TO_USER' ? 'user message' : 'your message'}
                  </div>
                  <div className={styles.replyText}>
                    {originalMessage.text?.substring(0, 50) || 'Message'}
                    {originalMessage.text?.length > 50 ? '...' : ''}
                  </div>
                </div>
              )}

              {!isDeleted && msg.text && !isEditing && (
                <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 4px 0', wordWrap: 'break-word' }}>
                  {msg.text}
                </p>
              )}

              {!isDeleted && isEditing && (
                <div style={{ marginBottom: '8px' }}>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    style={{
                      width: '100%',
                      minHeight: '60px',
                      padding: '8px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      resize: 'vertical',
                      outline: 'none',
                    }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <button
                      onClick={(e) => handleSaveEdit(msg.id, e)}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#1976d2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}>
                      {t('common.save')}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#999',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              )}

              {!isDeleted && msg.attachments && msg.attachments.length > 0 && (
                <div style={{ margin: '4px 0' }}>
                  {msg.attachments.map((attachment: any, attIndex: number) => {
                    const isImage =
                      attachment.type === 'image' ||
                      (attachment.extension &&
                        ['jpg', 'jpeg', 'png', 'bmp', 'gif'].includes(
                          attachment.extension.toLowerCase(),
                        )) ||
                      (attachment.name && /\.(jpg|jpeg|png|bmp|gif)$/i.test(attachment.name));
                    return (
                      <div key={attIndex} style={{ marginBottom: '8px' }}>
                        {isImage && attachment.url ? (
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <img
                              src={attachment.url}
                              alt={attachment.name || 'Attachment'}
                              style={{
                                maxWidth: '200px',
                                maxHeight: '200px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                border: '1px solid #ddd',
                              }}
                              onClick={() => {
                                if (attachment.url) window.open(attachment.url, '_blank');
                              }}
                            />
                            <div className={styles.attachmentCaption}>
                              {attachment.name || attachment.fileName || 'Image'}
                              {attachment.size && ` (${Math.round(attachment.size / 1024)} KB)`}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={styles.attachmentPlaceholder}
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              if (attachment.url) window.open(attachment.url, '_blank');
                              else if (attachment.blob) {
                                const url = URL.createObjectURL(attachment.blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = attachment.name || 'file';
                                a.click();
                                URL.revokeObjectURL(url);
                              }
                            }}>
                            <p style={{ margin: '0 0 4px 0', fontWeight: 'bold' }}>
                              {attachment.name || attachment.fileName || 'File'}
                            </p>
                            <p
                              className={styles.attachmentCaption}
                              style={{ margin: '0', fontSize: '0.9em' }}>
                              {attachment.extension &&
                                `Type: ${attachment.extension.toUpperCase()} `}
                              {attachment.size && `(${Math.round(attachment.size / 1024)} KB)`}
                              {!attachment.size &&
                                attachment.extension &&
                                ` (${attachment.extension.toUpperCase()})`}
                            </p>
                            {attachment.error && (
                              <p
                                style={{
                                  margin: '4px 0 0 0',
                                  color: '#d32f2f',
                                  fontSize: '0.8em',
                                }}>
                                Upload error
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {isDeleted && (
                <div className={styles.deletedContent}>
                  <p style={{ fontStyle: 'italic', color: '#999', margin: '0 0 4px 0' }}>
                    Message deleted
                  </p>
                </div>
              )}

              <div
                className={`${styles.messageFooter} ${isDeleted ? styles.messageFooterDeleted : ''}`}
                style={{
                  opacity: isDeleted ? 0.5 : 0.6,
                }}>
                <span className={styles.messageTime}>
                  {dayjs(msg.edited_at || msg.created_at).format('DD.MM.YYYY HH:mm')}
                </span>
                {msg.edited_at && (
                  <span style={{ fontStyle: 'italic', marginLeft: '4px' }}>(edited)</span>
                )}
                {!isDeleted && statusIcon && (
                  <span className={styles.statusIcons} style={{ marginLeft: '4px' }}>
                    {statusIcon}
                  </span>
                )}
              </div>

              {!isDeleted && showMessageActionsRow && (
                <div className={styles.messageActions}>
                  {showReplyControl && (
                    <button onClick={(e) => handleReplyClick(msg, e)} title={t('chat.replyAction')}>
                      <FaReply size={12} />
                    </button>
                  )}
                  {showEditDeleteBar && (
                    <>
                      {isOperatorMessage && (
                        <button
                          onClick={(e) => handleEditClick(msg, e)}
                          title={t('common.edit')}
                          disabled={!canEditDelete}>
                          <BsPencil size={12} />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDeleteClick(msg, e)}
                        title={t('chat.deleteMessage')}
                        disabled={!canEditDelete}>
                        <FaTrash size={12} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {pagination?.isLoadingNext && (
          <div className={styles.loadingIndicator} style={{ marginTop: '20px' }}>
            <CircularProgress size={20} />
            <p>Loading newer messages...</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div className={`${styles.message} ${styles.supportMessage}`}>
            <p style={{ margin: '0 0 8px 0', color: '#777', fontSize: '0.9em' }}>
              Attached files (not sent):
            </p>
            {attachments.map((file, index) => (
              <div key={index} className={styles.attachmentPreview}>
                {file.type.startsWith('image/') ? (
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      style={{ maxWidth: '200px', maxHeight: '200px' }}
                    />
                    <button
                      className={styles.removeAttachment}
                      onClick={(e) => handleRemoveAttachment(index, e)}
                      title={t('chat.deleteFile')}
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        background: 'rgba(0,0,0,0.7)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}>
                      <FaTimes size={12} />
                    </button>
                  </div>
                ) : (
                  <div className={styles.attachmentPlaceholder} style={{ position: 'relative' }}>
                    <p>{file.name}</p>
                    <p>({Math.round(file.size / 1024)} KB)</p>
                    <button
                      className={styles.removeAttachment}
                      onClick={(e) => handleRemoveAttachment(index, e)}
                      title={t('chat.deleteFile')}
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        background: 'rgba(0,0,0,0.7)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}>
                      <FaTimes size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showScrollButton && !isAtBottom && (
        <button
          className={styles.scrollToBottomBtn}
          onClick={handleScrollToLastClick}
          title={
            unreadCount > 0
              ? t('chat.newMessagesCount', { count: unreadCount })
              : t('chat.scrollToLastMessage')
          }>
          <BsArrowDown />
          {unreadCount > 0 && (
            <span className={styles.unreadCountBadge}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}
    </>
  );
}

export default MessageFeed;
