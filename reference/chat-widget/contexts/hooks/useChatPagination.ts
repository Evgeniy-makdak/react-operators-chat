import { useCallback, useRef } from 'react';

import { useChat } from '../ChatContext';
import { ChatConfig } from '../chatConfig';

export const useChatPagination = (sessionId: string) => {
  const { getSession, loadPreviousMessages } = useChat(); // ИСПРАВЛЕНО: loadMoreMessages -> loadPreviousMessages

  const loadingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const topMessageRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionRef = useRef<{
    scrollTop: number;
    scrollHeight: number;
    firstVisibleMessageId: string | null;
  }>({
    scrollTop: 0,
    scrollHeight: 0,
    firstVisibleMessageId: null,
  });

  const session = getSession(sessionId);
  const pagination = session?.pagination;

  // Проверяем, отключена ли пагинация
  const isPaginationDisabled = ChatConfig.DISABLE_PAGINATION;

  // Функция для получения ID первого видимого сообщения
  const getFirstVisibleMessageId = useCallback((): string | null => {
    if (!session?.messages || session.messages.length === 0) return null;

    const container = topMessageRef.current?.closest('[class*="feed"]');
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();
    const messagesElements = container.querySelectorAll('[id^="message-"]');

    for (let i = 0; i < messagesElements.length; i++) {
      const element = messagesElements[i] as HTMLElement;
      const rect = element.getBoundingClientRect();

      // Проверяем, виден ли элемент в контейнере (хотя бы частично)
      if (rect.top < containerRect.bottom && rect.bottom > containerRect.top) {
        const messageId = element.id.replace('message-', '');
        return messageId || null;
      }
    }

    return session.messages[0]?.id || null;
  }, [session?.messages]);

  // Функция для проверки нужно ли загружать предыдущие сообщения
  const shouldLoadMore = useCallback(() => {
    if (!session || !pagination || isPaginationDisabled) return false;

    return !pagination.isLoadingMore && pagination.hasMoreMessages && !loadingRef.current;
  }, [session, pagination, isPaginationDisabled]);

  // Функция для загрузки предыдущих сообщений
  const handleLoadMore = useCallback(async (): Promise<boolean> => {
    // Если пагинация отключена, ничего не делаем
    if (isPaginationDisabled) {
      return false;
    }

    if (!shouldLoadMore() || loadingRef.current) {
      return false;
    }

    loadingRef.current = true;

    try {
      // Сохраняем текущую позицию прокрутки перед загрузкой
      const container = topMessageRef.current?.closest('[class*="feed"]');
      if (container) {
        scrollPositionRef.current = {
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          firstVisibleMessageId: getFirstVisibleMessageId(),
        };
      }

      const result = await loadPreviousMessages(sessionId);
      return result;
    } catch (error) {
      console.error('❌ Ошибка загрузки предыдущих сообщений:', error);
      return false;
    } finally {
      loadingRef.current = false;
    }
  }, [
    sessionId,
    loadPreviousMessages,
    shouldLoadMore,
    getFirstVisibleMessageId,
    isPaginationDisabled,
  ]);

  // Функция для восстановления позиции прокрутки
  const restoreScrollPosition = useCallback(() => {
    const container = topMessageRef.current?.closest('[class*="feed"]');
    if (!container || !scrollPositionRef.current.firstVisibleMessageId) {
      return;
    }

    const { scrollTop, scrollHeight, firstVisibleMessageId } = scrollPositionRef.current;

    // Ищем элемент с сохраненным ID
    const targetElement = document.getElementById(`message-${firstVisibleMessageId}`);
    if (targetElement) {
      // Прокручиваем к сохраненному сообщению
      targetElement.scrollIntoView({ block: 'start', behavior: 'auto' });
    } else {
      // Если элемент не найден, восстанавливаем позицию по scrollTop
      const newScrollHeight = container.scrollHeight;
      const scrollDifference = newScrollHeight - scrollHeight;
      container.scrollTop = scrollTop + scrollDifference;
    }

    // Сбрасываем сохраненную позицию
    scrollPositionRef.current = {
      scrollTop: 0,
      scrollHeight: 0,
      firstVisibleMessageId: null,
    };
  }, []);

  // Функция для настройки Intersection Observer (отключаем если пагинация отключена)
  const setupTopMessageObserver = useCallback(
    (element: HTMLDivElement | null) => {
      topMessageRef.current = element;

      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      // Если пагинация отключена, не настраиваем observer
      if (isPaginationDisabled || !element || !shouldLoadMore()) {
        return;
      }

      observerRef.current = new IntersectionObserver(
        (entries) => {
          const firstEntry = entries[0];
          if (firstEntry.isIntersecting && shouldLoadMore()) {
            handleLoadMore();
          }
        },
        {
          root: null,
          rootMargin: '100px', // Загружать когда до верха осталось 100px
          threshold: 0.1,
        },
      );

      observerRef.current.observe(element);
    },
    [shouldLoadMore, handleLoadMore, isPaginationDisabled],
  );

  // Очистка при размонтировании
  const cleanup = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  return {
    pagination,
    setupTopMessageObserver,
    handleLoadMore,
    restoreScrollPosition,
    cleanup,
    isLoadingMore: pagination?.isLoadingMore || false,
    hasMoreMessages: isPaginationDisabled ? false : pagination?.hasMoreMessages || false,
    isPaginationDisabled,
  };
};
