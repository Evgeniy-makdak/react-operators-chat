import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BsArrowDown, BsCheck2, BsCheck2All, BsPencil } from 'react-icons/bs';
import { FaReply, FaTimes, FaTrash } from 'react-icons/fa';

import dayjs from 'dayjs';

import { CircularProgress } from '@mui/material';

import { useChat } from '../contexts/ChatContext';
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
  scrollToBottomOnExpand?: boolean;
  onScrollToBottomDone?: () => void;
  dialogStatus?: string;
  isDialogBlockedByOtherOperator?: boolean;
  isDialogEnded?: boolean;
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
  scrollToBottomOnExpand,
  onScrollToBottomDone,
  dialogStatus = '',
  isDialogBlockedByOtherOperator = false,
  isDialogEnded = false,
}: MessageFeedProps) {
  const { t } = useTranslation();
  const renderCountRef = useRef(0);
  renderCountRef.current++;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [isAtTop, setIsAtTop] = useState(false);
  const [deletedMessages, setDeletedMessages] = useState<Set<string>>(new Set());
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [internalUnreadCount, setInternalUnreadCount] = useState<number>(0);
  const [lastSeenMessageId, setLastSeenMessageId] = useState<string | null>(null);
  const visibleMessagesIds = useRef<Set<string>>(new Set());
  const sentReadStatusesRef = useRef<Set<string>>(new Set());
  const firstUnreadMessageRef = useRef<{ id: string; index: number } | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const needsScrollToBottomRef = useRef(false);
  const scrollDoneCallbackRef = useRef<(() => void) | undefined>(undefined);
  const prevMessageLenRef = useRef(messages.length);

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

  /** Как в MessageInput: ответ/редактирование только если диалог «забран» и можно писать. */
  const canInteractWithMessages =
    dialogStatus === 'CLOSED' && !isDialogBlockedByOtherOperator && !isDialogEnded;

  const feedDialogId =
    session?.selectedDialog?.id && String(session.selectedDialog.id) !== '0'
      ? String(session.selectedDialog.id)
      : session?.assignedDialogId &&
          String(session.assignedDialogId) !== '0' &&
          String(session.assignedDialogId) !== 'assigned'
        ? String(session.assignedDialogId)
        : null;

  /** Не показывать в основной ленте сообщения «чужих» диалогов (превью в той же сессии). */
  const messagesInActiveDialog = useMemo(() => {
    if (!feedDialogId) return [];
    return messages.filter((msg) => String(msg.dialogId ?? msg.dialog?.id ?? '') === feedDialogId);
  }, [messages, feedDialogId]);

  const calculateUnreadMessages = useCallback(() => {
    let count = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (
        msg.messageStatus === 'TO_OPERATOR' &&
        (msg.confirmStatus === 'SENT' || msg.confirmStatus === 'DELIVERED') &&
        !msg.is_read
      ) {
        count++;
      }

      if (lastSeenMessageId && msg.id === lastSeenMessageId) {
        break;
      }
    }

    return count;
  }, [messages, lastSeenMessageId]);

  const sendReadStatusForVisibleMessages = useCallback(() => {
    if (!onMarkMessagesAsRead) {
      return;
    }

    if (visibleMessagesIds.current.size === 0) {
      return;
    }

    const messagesToMarkAsRead: string[] = [];

    messages.forEach((msg) => {
      const messageIdentifier = msg.id ? String(msg.id) : null;
      const msgKey = msg.uuid || msg.id;

      if (!msgKey) return;

      const isVisible = messageIdentifier
        ? visibleMessagesIds.current.has(messageIdentifier)
        : false;
      const alreadySent = sentReadStatusesRef.current.has(msgKey);

      const canSendRead =
        (msg.confirmStatus === 'DELIVERED' || msg.confirmStatus === 'SENT') && !alreadySent;
      const shouldSend = isVisible && msg.messageStatus === 'TO_OPERATOR' && canSendRead;

      if (shouldSend) {
        messagesToMarkAsRead.push(msgKey);
        sentReadStatusesRef.current.add(msgKey);
      }
    });

    if (messagesToMarkAsRead.length > 0) {
      messagesToMarkAsRead.forEach((messageId, index) => {
        setTimeout(() => {
          onMarkMessagesAsRead([messageId]);
        }, index * 500);
      });
    }
  }, [messages, onMarkMessagesAsRead]);

  useEffect(() => {
    const count = calculateUnreadMessages();
    setInternalUnreadCount(count);

    if (isAtBottom && count > 0 && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      setLastSeenMessageId(lastMessage.id);
      setInternalUnreadCount(0);
    }
  }, [messages, isAtBottom, calculateUnreadMessages]);

  const unreadCount = externalUnreadCount !== undefined ? externalUnreadCount : internalUnreadCount;

  const messagesJustLoaded = messages.length > 0 && prevMessageLenRef.current === 0;
  prevMessageLenRef.current = messages.length;

  if (scrollToBottomOnExpand || (messages.length > 0 && isInitialLoad) || messagesJustLoaded) {
    needsScrollToBottomRef.current = true;
  }

  useEffect(() => {
    scrollDoneCallbackRef.current = onScrollToBottomDone;
  });

  useEffect(() => {
    if (messages.length > 0 && isInitialLoad) {
      setIsInitialLoad(false);
      needsScrollToBottomRef.current = true;

      const lastReadMessage = [...messages]
        .reverse()
        .find((msg) => msg.messageStatus === 'TO_OPERATOR' && msg.confirmStatus === 'READ');

      if (lastReadMessage) {
        setLastSeenMessageId(lastReadMessage.id);
      } else if (messages.length > 0) {
        setLastSeenMessageId(messages[messages.length - 1].id);
      }

      let firstUnreadIndex = -1;
      let firstUnreadId = null;

      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        if (
          msg.messageStatus === 'TO_OPERATOR' &&
          (msg.confirmStatus === 'SENT' || msg.confirmStatus === 'DELIVERED') &&
          !msg.is_read
        ) {
          firstUnreadIndex = i;
          firstUnreadId = msg.id;
          break;
        }
      }

      if (firstUnreadId) {
        firstUnreadMessageRef.current = {
          id: firstUnreadId,
          index: firstUnreadIndex,
        };
      } else {
        firstUnreadMessageRef.current = null;
      }
    }
  }, [messages, isInitialLoad]);

  useLayoutEffect(() => {
    if (!needsScrollToBottomRef.current) return;
    const container = scrollRef.current;
    if (!container || messages.length === 0) return;
    container.scrollTop = container.scrollHeight;
  });

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
    ) {
      return;
    }

    const container = scrollRef.current;
    const newScrollHeight = container.scrollHeight;
    const heightDifference = newScrollHeight - scrollHeightBeforeLoadRef.current;

    if (heightDifference > 0 && firstVisibleMessageIdRef.current) {
      const targetElement = document.getElementById(`message-${firstVisibleMessageIdRef.current}`);

      if (targetElement) {
        setTimeout(() => {
          targetElement.scrollIntoView({ block: 'start', behavior: 'auto' });
        }, 50);
      } else {
        setTimeout(() => {
          container.scrollTop = container.scrollTop + heightDifference;
        }, 50);
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

      const isVisible = rect.top < containerRect.bottom && rect.bottom > containerRect.top;

      if (isVisible) {
        if (messageIdentifier) {
          newVisibleIds.add(messageIdentifier);
        } else if (messageUuid) {
          newVisibleIds.add(messageUuid);
        }
      }
    });

    visibleMessagesIds.current = newVisibleIds;
  }, []);

  const handleLoadPreviousMessages = useCallback(async () => {
    if (isLoadInProgressRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastLoadTimeRef.current < 500) {
      return;
    }

    if (!pagination?.hasMoreMessages || pagination?.isLoadingMore || loadingMoreRef.current) {
      return;
    }

    saveScrollState();

    isLoadInProgressRef.current = true;
    lastLoadTimeRef.current = now;
    loadingMoreRef.current = true;

    try {
      await loadPreviousMessages(sessionId);
    } catch (error) {
      console.error('❌ Ошибка загрузки предыдущих сообщений:', error);
    } finally {
      setTimeout(() => {
        isLoadInProgressRef.current = false;
      }, 1000);
    }
  }, [pagination, sessionId, loadPreviousMessages, saveScrollState]);

  const handleLoadNextMessages = useCallback(async () => {
    if (isLoadInProgressRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastLoadTimeRef.current < 500) {
      return;
    }

    if (!pagination?.hasNextMessages || pagination?.isLoadingNext || loadingNextRef.current) {
      return;
    }

    saveScrollState();

    isLoadInProgressRef.current = true;
    lastLoadTimeRef.current = now;
    loadingNextRef.current = true;

    try {
      await loadNextMessages(sessionId);
    } catch (error) {
      console.error('❌ Ошибка загрузки следующих сообщений:', error);
    } finally {
      setTimeout(() => {
        isLoadInProgressRef.current = false;
      }, 1000);
    }
  }, [pagination, sessionId, loadNextMessages, saveScrollState]);

  const handleLoadFirstPage = useCallback(async () => {
    if (isLoadInProgressRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastLoadTimeRef.current < 500) {
      return;
    }

    if (!session?.selectedDialog?.id || session.selectedDialog.id === '0') {
      return;
    }

    isLoadInProgressRef.current = true;
    lastLoadTimeRef.current = now;
    loadFirstPageRef.current = true;

    try {
      await loadFirstPageMessages(sessionId, session.selectedDialog.id);
    } catch (error) {
      console.error('❌ Ошибка загрузки первой страницы:', error);
    } finally {
      setTimeout(() => {
        isLoadInProgressRef.current = false;
        loadFirstPageRef.current = false;

        setTimeout(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTo({
              top: scrollRef.current.scrollHeight,
              behavior: 'smooth',
            });
            setIsAtBottom(true);
            setIsAtTop(false);

            if (messages.length > 0) {
              const lastMessage = messages[messages.length - 1];
              setLastSeenMessageId(lastMessage.id);
              setInternalUnreadCount(0);
            }
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
    if (scrollDebounceRef.current) {
      clearTimeout(scrollDebounceRef.current);
    }

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
      const isTop = scrollTop < 100;

      setIsAtBottom(isBottom);
      setIsAtTop(isTop);

      updateVisibleMessages();

      const shouldShowButton = !isBottom;
      setShowScrollButton(shouldShowButton);
      if (isTop && scrollDirectionRef.current === 'up') {
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

      if (!isTop && !isBottom) {
        scrollTriggerHistoryRef.current.up = false;
        scrollTriggerHistoryRef.current.down = false;
      } else if (isTop && scrollDirectionRef.current === 'down') {
        scrollTriggerHistoryRef.current.up = false;
      } else if (isBottom && scrollDirectionRef.current === 'up') {
        scrollTriggerHistoryRef.current.down = false;
      }

      if (isBottom && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage.id !== lastSeenMessageId) {
          setLastSeenMessageId(lastMessage.id);
          setInternalUnreadCount(0);
        }
      }

      sendReadStatusForVisibleMessages();
    }, 200);
  }, [
    messages,
    isAtBottom,
    isAtTop,
    pagination,
    handleLoadPreviousMessages,
    handleLoadNextMessages,
    updateVisibleMessages,
    lastSeenMessageId,
    sendReadStatusForVisibleMessages,
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
    if (!needsScrollToBottomRef.current || messages.length === 0) return;

    let stopped = false;
    let attempts = 0;
    const maxAttempts = 30;

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
        setIsAtTop(false);
        scrollDoneCallbackRef.current?.();
      }
    };

    const intervalId = setInterval(tryScroll, 50);
    tryScroll();

    return () => {
      stopped = true;
      clearInterval(intervalId);
    };
  }, [messages]);

  useEffect(() => {
    if (unreadCount > 0 && messages.length > 0) {
      const unreadMessages = messages.filter(
        (msg) =>
          msg.messageStatus === 'TO_OPERATOR' &&
          (msg.confirmStatus === 'SENT' || msg.confirmStatus === 'DELIVERED') &&
          !msg.is_read,
      );

      if (unreadMessages.length > 0) {
        const visibleUnread = unreadMessages.filter((msg) => {
          const messageIdentifier = msg.id ? String(msg.id) : null;
          return messageIdentifier && visibleMessagesIds.current.has(messageIdentifier);
        });

        if (visibleUnread.length > 0 && onMarkMessagesAsRead) {
          const messageIds = visibleUnread.map((m) => m.uuid || m.id);
          onMarkMessagesAsRead(messageIds);
        }
      }
    }
  }, [unreadCount, messages, onMarkMessagesAsRead, visibleMessagesIds]);

  useEffect(() => {
    return () => {
      if (scrollDebounceRef.current) {
        clearTimeout(scrollDebounceRef.current);
      }
    };
  }, []);

  const scrollToBottom = (forceLoadFirstPage: boolean = false) => {
    const session = getSession(sessionId);
    const dialogId = session?.selectedDialog?.id;

    if (forceLoadFirstPage || (dialogId && dialogId !== '0' && pagination?.currentPage !== 0)) {
      handleLoadFirstPage();
    } else {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth',
        });

        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          setLastSeenMessageId(lastMessage.id);
          setInternalUnreadCount(0);
        }

        setIsAtBottom(true);
        setIsAtTop(false);
      }
    }
  };

  const handleReplyClick = (message: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onReplyToMessage) {
      onReplyToMessage(message);
    }
  };

  const handleDeleteClick = (message: any, e: React.MouseEvent) => {
    e.stopPropagation();

    if (message.id && canEditOrDelete(message)) {
      setDeletedMessages((prev) => {
        const newSet = new Set(prev);
        newSet.add(message.id);
        return newSet;
      });

      if (onDeleteMessage) {
        onDeleteMessage(message.id);
      }
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
        console.error('❌ Нет поля created_at в цитируемом сообщении:', {
          messageId: quoteMessage.id,
          messageUuid: quoteMessage.uuid,
          availableKeys: Object.keys(quoteMessage),
        });
        return;
      }

      try {
        await navigateToQuotedMessage(sessionId, dialogId, quoteMessage, 50);
      } catch (error) {
        console.error('❌ Ошибка навигации к цитируемому сообщению:', error);
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
      console.error('Error calculating time difference:', error);
      return false;
    }
  };

  const handleRemoveAttachment = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (onRemoveAttachment) {
      onRemoveAttachment(index);
    }
  };

  const getSenderName = (message: any): string => {
    if (message.messageStatus === 'TO_USER') {
      return (
        message.senderInfo?.fullName ||
        message.senderInfo?.displayName ||
        message.createdBy?.fullName ||
        'Вы'
      );
    } else if (message.messageStatus === 'TO_OPERATOR') {
      return (
        message.senderInfo?.fullName ||
        message.senderInfo?.displayName ||
        message.createdBy?.fullName ||
        selectedUserName ||
        'Клиент'
      );
    }

    return message.sender === 'user'
      ? message.senderInfo?.fullName || message.senderInfo?.displayName || 'Вы'
      : selectedUserName || 'Клиент';
  };

  const getMessageStyle = (message: any) => {
    if (message.messageStatus === 'TO_USER') {
      return styles.supportMessage;
    } else if (message.messageStatus === 'TO_OPERATOR') {
      return styles.userMessage;
    }

    return message.sender === 'user' ? styles.supportMessage : styles.userMessage;
  };

  const getStatusIcon = (message: any) => {
    if (message.messageStatus === 'TO_USER') {
      if (message.confirmStatus === 'READ') {
        return <BsCheck2All className={styles.delivered} title={t('chat.statusRead')} />;
      } else if (message.confirmStatus === 'DELIVERED') {
        return <BsCheck2All className={styles.sent} title={t('chat.statusDelivered')} />;
      } else if (message.confirmStatus === 'SENT') {
        return <BsCheck2 className={styles.sent} title={t('chat.statusSent')} />;
      } else {
        return <BsCheck2 className={styles.sent} title={t('chat.statusSent')} />;
      }
    }
    return null;
  };

  const lastMessagesRef = useRef<any[]>([]);

  useEffect(() => {
    if (!session || !pagination) return;

    const currentPage = pagination.currentPage || 0;
    const prevMessages = lastMessagesRef.current;
    const currentMessages = messages;

    if (currentMessages.length > prevMessages.length) {
      const newMessages = currentMessages.slice(prevMessages.length);
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

              if (!isAtBottomNow) {
                container.scrollTo({
                  top: container.scrollHeight,
                  behavior: 'smooth',
                });
              } else {
                container.scrollTop = container.scrollHeight;
              }

              if (currentMessages.length > 0) {
                const lastMessage = currentMessages[currentMessages.length - 1];
                setLastSeenMessageId(lastMessage.id);
                setInternalUnreadCount(0);
              }

              setIsAtBottom(true);
              setIsAtTop(false);
            }
          }, 50);
        }
      }
    }

    lastMessagesRef.current = [...currentMessages];
  }, [messages, session, pagination, handleLoadFirstPage]);

  useEffect(() => {
    messages.forEach((msg) => {
      const msgKey = msg.id ?? msg.uuid;
      if (msg.confirmStatus === 'READ' && sentReadStatusesRef.current.has(msgKey)) {
        sentReadStatusesRef.current.delete(msgKey);
      }
    });
  }, [messages]);

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
            <p>Загрузка более старых сообщений...</p>
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
          const isUnread =
            msg.messageStatus === 'TO_OPERATOR' &&
            (msg.confirmStatus === 'SENT' || msg.confirmStatus === 'DELIVERED') &&
            !msg.is_read &&
            (!lastSeenMessageId ||
              messagesInActiveDialog.findIndex((m) => m.id === msg.id) >
                messagesInActiveDialog.findIndex((m) => m.id === lastSeenMessageId));

          const isFirstUnread =
            msg.messageStatus === 'TO_OPERATOR' &&
            (msg.confirmStatus === 'SENT' || msg.confirmStatus === 'DELIVERED') &&
            !msg.is_read &&
            firstUnreadMessageRef.current?.id === msg.id;

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
                    Ответ на{' '}
                    {originalMessage.messageStatus === 'TO_USER'
                      ? 'сообщение пользователя'
                      : 'ваше сообщение'}
                  </div>
                  <div className={styles.replyText}>
                    {originalMessage.text?.substring(0, 50) || 'Сообщение'}
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
                              alt={attachment.name || 'Вложение'}
                              style={{
                                maxWidth: '200px',
                                maxHeight: '200px',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                border: '1px solid #ddd',
                              }}
                              onClick={() => {
                                if (attachment.url) {
                                  window.open(attachment.url, '_blank');
                                }
                              }}
                            />
                            <div
                              style={{
                                fontSize: '0.8em',
                                color: '#777',
                                marginTop: '2px',
                                wordBreak: 'break-all',
                              }}>
                              {attachment.name || attachment.fileName || 'Изображение'}
                              {attachment.size && ` (${Math.round(attachment.size / 1024)} KB)`}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={styles.attachmentPlaceholder}
                            style={{
                              padding: '8px',
                              border: '1px solid #ddd',
                              borderRadius: '4px',
                              backgroundColor: '#f5f5f5',
                              cursor: 'pointer',
                            }}
                            onClick={() => {
                              if (attachment.url) {
                                window.open(attachment.url, '_blank');
                              } else if (attachment.blob) {
                                const url = URL.createObjectURL(attachment.blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = attachment.name || 'file';
                                a.click();
                                URL.revokeObjectURL(url);
                              }
                            }}>
                            <p style={{ margin: '0 0 4px 0', fontWeight: 'bold' }}>
                              {attachment.name || attachment.fileName || 'Файл'}
                            </p>
                            <p style={{ margin: '0', fontSize: '0.9em', color: '#777' }}>
                              {attachment.extension &&
                                `Тип: ${attachment.extension.toUpperCase()} `}
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
                                Ошибка загрузки
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
                    Сообщение удалено
                  </p>
                </div>
              )}

              <div
                style={{
                  fontSize: '0.8rem',
                  opacity: isDeleted ? 0.5 : 0.6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: isDeleted ? '#999' : 'inherit',
                  flexWrap: 'wrap',
                }}>
                <span style={{ fontWeight: 'bold', color: '#777' }}>
                  {dayjs(msg.edited_at || msg.created_at).format('DD.MM.YYYY HH:mm')}
                </span>

                {msg.edited_at && (
                  <span style={{ fontStyle: 'italic', marginLeft: '4px' }}>(изменено)</span>
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
            <p>Загрузка более новых сообщений...</p>
          </div>
        )}

        {attachments.length > 0 && (
          <div className={`${styles.message} ${styles.supportMessage}`}>
            <p style={{ margin: '0 0 8px 0', color: '#777', fontSize: '0.9em' }}>
              Прикрепленные файлы (не отправлены):
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
          onClick={() => scrollToBottom()}
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
