import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import { appStore } from '@shared/model/app_store/AppStore';

import { configLoader } from '../../../config/configLoader';
import {
  setStompDebugFromRuntimeConfig,
  stompDebugLog,
  stompDebugMaskWsUrl,
  websocketReadyStateLabel,
} from '../lib/stompDebugLog';
import { chatUnreadTrace, unreadMapToRecord } from './chatUnreadTrace';

interface SocketContextType {
  lastMessage: any;
  stompClient: any;
  isConnected: boolean;
  connectionStatus: string;
  currentBranchId: string | null;
  unreadCount: number;
  dialogsUnreadCounts: Map<number, number>;
  setUnreadCount: (count: number) => void;
  updateDialogUnreadCount: (dialogId: number, count: number) => void;
  /** Слияние снимка из REST: не затираем локальный счётчик нулём, пока агрегат по WS больше нуля (устаревший API). */
  mergeDialogUnreadFromApi: (dialogId: number, apiCount: number) => void;
  incrementDialogUnreadCount: (dialogId: number, amount?: number, dedupeKey?: string) => void;
  calculateTotalUnread: () => number;
  resetDialogCounts: () => void;
  /** Снимает и очищает очередь входящих сообщений чата (OPERATOR / user queue), чтобы не терять их при перезаписи lastMessage. */
  flushIncomingChatMessages: () => any[];
}

const SocketContext = createContext<SocketContextType | null>(null);

export const SocketProvider = ({ children }: { children: ReactNode }) => {
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [dialogsUnreadCounts, setDialogsUnreadCounts] = useState<Map<number, number>>(new Map());

  const stompClientRef = useRef<any>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const socketRef = useRef<WebSocket | null>(null);
  const isConnectingRef = useRef<boolean>(false);
  const subscriptionsRef = useRef<Set<string>>(new Set());
  const processedMessagesRef = useRef<Set<string>>(new Set());
  const useDetailedCountsRef = useRef<boolean>(false);
  const hasDetailedDataRef = useRef<boolean>(false);
  const unreadAggregateRef = useRef<number>(0);
  const incomingChatMessagesQueueRef = useRef<any[]>([]);
  /** Предотвращает повторный +1 при двойном вызове handleIncomingMessage на одно сообщение. */
  const incrementDedupeByMessageRef = useRef<Set<string>>(new Set());

  const [apiConfig, setApiConfig] = useState<{ apiUrl: string; wsUrl: string } | null>(null);

  useEffect(() => {
    unreadAggregateRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await configLoader.loadConfig();
        stompDebugLog('config loaded', {
          apiUrl: config?.apiUrl,
          wsUrl: config?.wsUrl,
        });
        setApiConfig(config);
      } catch (error) {
        console.error('Ошибка загрузки конфигурации WebSocket:', error);
        setStompDebugFromRuntimeConfig(undefined);
        stompDebugLog('config load failed, using fallback URLs', { error: String(error) });
        setApiConfig({
          apiUrl: 'https://alcolock-test.lsystems.ru/',
          wsUrl: 'wss://alcolock-test.lsystems.ru/ws/websocket',
        });
      }
    };

    loadConfig();
  }, []);

  const getAuthToken = (): string | null => {
    const tokenFromLocalStorage = localStorage.getItem('authToken');
    const tokenFromSessionStorage = sessionStorage.getItem('authToken');
    const tokenFromCookie = document.cookie
      .split('; ')
      .find((row) => row.startsWith('bearer='))
      ?.split('=')[1];

    return tokenFromLocalStorage || tokenFromSessionStorage || tokenFromCookie || null;
  };

  const getBranchId = (): string | null => {
    const branchState = appStore.getState().selectedBranchState;
    return branchState?.id ? branchState.id.toString() : null;
  };

  const resetDialogCounts = useCallback(() => {
    setDialogsUnreadCounts(new Map());
    useDetailedCountsRef.current = false;
    hasDetailedDataRef.current = false;
    incrementDedupeByMessageRef.current.clear();
  }, []);

  const flushIncomingChatMessages = useCallback((): any[] => {
    const q = incomingChatMessagesQueueRef.current;
    incomingChatMessagesQueueRef.current = [];
    return q;
  }, []);

  const calculateTotalUnread = useCallback((): number => {
    let mapSum = 0;
    dialogsUnreadCounts.forEach((count, dialogId) => {
      if (dialogId > 0 && count > 0) {
        mapSum += count;
      }
    });

    if (!useDetailedCountsRef.current || !hasDetailedDataRef.current) {
      return unreadCount;
    }

    // Агрегат /user/queue/unread и per-dialog карта иногда расходятся по таймингу; не показывать 0,
    // пока сумма по карте или общий кадр говорит о непрочитанном.
    return Math.max(unreadCount, mapSum);
  }, [dialogsUnreadCounts, unreadCount]);

  const updateDialogUnreadCount = useCallback((dialogId: number, count: number) => {
    setDialogsUnreadCounts((prev) => {
      const newMap = new Map(prev);
      if (useDetailedCountsRef.current || dialogId > 0) {
        newMap.set(dialogId, count);
      }
      chatUnreadTrace('socket.setDialogUnread (absolute)', {
        dialogId,
        count,
        useDetailed: useDetailedCountsRef.current,
        hasDetailedData: hasDetailedDataRef.current,
        mapAfter: unreadMapToRecord(newMap),
      });
      return newMap;
    });
  }, []);

  const incrementDialogUnreadCount = useCallback(
    (dialogId: number, amount = 1, dedupeKey?: string) => {
      if (dedupeKey) {
        if (incrementDedupeByMessageRef.current.has(dedupeKey)) {
          chatUnreadTrace('socket.incrementDialogUnread (skip duplicate)', { dialogId, dedupeKey });
          return;
        }
        incrementDedupeByMessageRef.current.add(dedupeKey);
        setTimeout(() => incrementDedupeByMessageRef.current.delete(dedupeKey), 120_000);
      }
      // Кадры /queue/unread/{branch} задают абсолют; +1 здесь при том же сообщении даёт «1→2» (OPEN/ACTIVE).
      if (hasDetailedDataRef.current) {
        chatUnreadTrace('socket.incrementDialogUnread (skip +1, WS per-dialog authoritative)', {
          dialogId,
          dedupeKey,
        });
        return;
      }
      useDetailedCountsRef.current = true;
      hasDetailedDataRef.current = true;
      setDialogsUnreadCounts((prev) => {
        const newMap = new Map(prev);
        const current = newMap.get(dialogId) || 0;
        const newCount = current + amount;
        newMap.set(dialogId, newCount);
        chatUnreadTrace('socket.incrementDialogUnread', {
          dialogId,
          amount,
          prev: current,
          next: newCount,
          mapAfter: unreadMapToRecord(newMap),
        });
        return newMap;
      });
    },
    [],
  );

  const mergeDialogUnreadFromApi = useCallback((dialogId: number, apiCount: number) => {
    setDialogsUnreadCounts((prev) => {
      const prevCount = prev.get(dialogId) ?? 0;
      // REST-список «непрочитанных» часто отстаёт от WS; в detailed-режиме не затирать уже известный >0 нулём с API
      if (apiCount === 0 && prevCount > 0 && hasDetailedDataRef.current) {
        chatUnreadTrace('socket.mergeDialogUnreadFromApi (skip stale API zero, hasDetailedData)', {
          dialogId,
          apiCount,
          preserved: prevCount,
          aggregateUnread: unreadAggregateRef.current,
          mapAfter: unreadMapToRecord(prev),
        });
        return prev;
      }
      if (apiCount === 0 && prevCount > 0 && unreadAggregateRef.current > 0) {
        const cap = unreadAggregateRef.current;
        const positiveIds: number[] = [];
        prev.forEach((c, id) => {
          if (id > 0 && c > 0) positiveIds.push(id);
        });
        const onlyThisDialog = positiveIds.length === 1 && positiveIds[0] === dialogId;
        const nextVal = onlyThisDialog ? Math.min(prevCount, cap) : prevCount;
        if (nextVal === prevCount) {
          chatUnreadTrace('socket.mergeDialogUnreadFromApi (skip stale API zero)', {
            dialogId,
            apiCount,
            preserved: prevCount,
            aggregateUnread: cap,
            mapAfter: unreadMapToRecord(prev),
          });
          return prev;
        }
        const cappedMap = new Map(prev);
        cappedMap.set(dialogId, nextVal);
        chatUnreadTrace('socket.mergeDialogUnreadFromApi (cap to aggregate, stale API zero)', {
          dialogId,
          prevCount,
          nextVal,
          aggregateUnread: cap,
          mapAfter: unreadMapToRecord(cappedMap),
        });
        return cappedMap;
      }
      const newMap = new Map(prev);
      if (useDetailedCountsRef.current || dialogId > 0) {
        newMap.set(dialogId, apiCount);
      }
      chatUnreadTrace('socket.mergeDialogUnreadFromApi (applied)', {
        dialogId,
        apiCount,
        prevCount,
        aggregateUnread: unreadAggregateRef.current,
        mapAfter: unreadMapToRecord(newMap),
      });
      return newMap;
    });
  }, []);

  const updateUnreadCountDirect = useCallback((count: number) => {
    chatUnreadTrace('socket.setTotalUnread (branch/user aggregate)', {
      count,
      useDetailed: useDetailedCountsRef.current,
      hasDetailedData: hasDetailedDataRef.current,
    });
    unreadAggregateRef.current = count;
    setUnreadCount(count);
    setDialogsUnreadCounts((prev) => {
      const positive: { id: number; c: number }[] = [];
      prev.forEach((c, id) => {
        if (id > 0 && c > 0) positive.push({ id, c });
      });
      if (positive.length !== 1) return prev;
      const { id: onlyId, c: onlyC } = positive[0]!;
      // Агрегат 0 после STATUS_UPDATE может опережать снимок по филиалу; не обнулять карту
      // только по нему — нулевой per-dialog придёт с /queue/unread/{branch} или updateDialogUnread.
      if (count <= 0) return prev;
      if (onlyC <= count) return prev;
      const nextMap = new Map(prev);
      nextMap.set(onlyId, count);
      chatUnreadTrace('socket.reconcileSingleDialogMapToUserAggregate', {
        dialogId: onlyId,
        mapWas: onlyC,
        aggregate: count,
        mapAfter: unreadMapToRecord(nextMap),
      });
      return nextMap;
    });
  }, []);

  const sendStompFrame = (command: string, headers: any = {}, body: string = '') => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      if (command === 'SEND') {
        stompDebugLog('sendStompFrame skipped (cannot send)', {
          command,
          hasSocket: Boolean(socketRef.current),
          readyState: socketRef.current?.readyState,
          readyStateLabel: websocketReadyStateLabel(socketRef.current?.readyState),
        });
      }
      return false;
    }

    let frame = `${command}\n`;
    Object.keys(headers).forEach((key) => {
      frame += `${key}:${headers[key]}\n`;
    });
    frame += `\n${body}\x00`;

    try {
      socketRef.current.send(frame);
      return true;
    } catch (error) {
      stompDebugLog('sendStompFrame WebSocket.send threw', {
        command,
        error: String(error),
      });
      return false;
    }
  };

  const disconnectWebSocket = () => {
    stompDebugLog('disconnectWebSocket called', {
      hadSocket: Boolean(socketRef.current),
      hadStompClient: Boolean(stompClientRef.current),
      stompConnected: stompClientRef.current?.connected === true,
    });
    if (socketRef.current) {
      sendStompFrame('DISCONNECT');
      socketRef.current.close(1000, 'Смена филиала');
      socketRef.current = null;
    }

    if (stompClientRef.current) {
      stompClientRef.current.connected = false;
      stompClientRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    setIsConnected(false);
    setConnectionStatus('disconnected');
    isConnectingRef.current = false;
    subscriptionsRef.current.clear();
    processedMessagesRef.current.clear();
    incomingChatMessagesQueueRef.current = [];
    incrementDedupeByMessageRef.current.clear();
    unreadAggregateRef.current = 0;
    setUnreadCount(0);
    resetDialogCounts();
  };

  const parseStompFrame = (data: string) => {
    const lines = data.split('\n');
    const command = lines[0];
    const headers: any = {};
    let body = '';
    let i = 1;

    while (i < lines.length && lines[i] !== '') {
      const headerLine = lines[i];
      const separatorIndex = headerLine.indexOf(':');
      if (separatorIndex !== -1) {
        headers[headerLine.substring(0, separatorIndex)] = headerLine.substring(separatorIndex + 1);
      }
      i++;
    }

    i++;
    while (i < lines.length) {
      if (lines[i] === '\x00' || lines[i].endsWith('\x00')) {
        if (lines[i].length > 1) {
          body += lines[i].substring(0, lines[i].length - 1);
        }
        break;
      }
      body += lines[i];
      i++;
    }

    if (!body && data.includes('\x00')) {
      const bodyStart = data.indexOf('\n\n');
      if (bodyStart !== -1) {
        const bodyEnd = data.indexOf('\x00');
        if (bodyEnd !== -1) {
          body = data.substring(bodyStart + 2, bodyEnd);
        }
      }
    }

    return { command, headers, body };
  };

  const subscribeToTopics = (currentBranchId: string) => {
    const topics = [
      `/topic/operator/messages/${currentBranchId}`,
      '/user/queue/messages',
      `/queue/unread/${currentBranchId}`,
      '/user/queue/unread',
      `/topic/dialog/status/${currentBranchId}`,
      '/user/queue/errors',
      '/user/queue/status',
    ];

    subscriptionsRef.current.clear();
    topics.forEach((topic) => {
      const subscribeHeaders = {
        id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        destination: topic,
      };
      sendStompFrame('SUBSCRIBE', subscribeHeaders);
      subscriptionsRef.current.add(topic);
    });
    chatUnreadTrace('socket.subscribe.topics', {
      branchId: currentBranchId,
      topics,
      note: '/user/queue/unread — общий счётчик; /queue/unread/{branchId} — разбивка по dialogId',
    });
    stompDebugLog('STOMP subscribed to topics', {
      branchId: currentBranchId,
      count: topics.length,
    });
  };

  const connectWebSocket = (branchId: string) => {
    if (isConnectingRef.current || !apiConfig) {
      stompDebugLog('connectWebSocket bail', {
        isConnecting: isConnectingRef.current,
        hasApiConfig: Boolean(apiConfig),
      });
      return;
    }

    const branchIdNorm = String(branchId).trim();

    disconnectWebSocket();
    setConnectionStatus('connecting');
    setCurrentBranchId(branchIdNorm);
    isConnectingRef.current = true;

    const { apiUrl, wsUrl: configWsUrl } = apiConfig;
    let wsUrl = configWsUrl;

    if (!wsUrl && apiUrl) {
      wsUrl = apiUrl.replace('http', 'ws').replace('https', 'wss') + 'ws/websocket';
    }

    if (!wsUrl) {
      stompDebugLog('connectWebSocket no wsUrl after config', { apiUrl, configWsUrl });
      setConnectionStatus('error');
      isConnectingRef.current = false;
      return;
    }

    const token = getAuthToken();
    if (!token) {
      stompDebugLog('connectWebSocket no auth token', { branchId: branchIdNorm });
      setConnectionStatus('error');
      isConnectingRef.current = false;
      return;
    }

    try {
      const finalWsUrl = `${wsUrl}?token=${encodeURIComponent(token)}`;
      stompDebugLog('WebSocket connecting', {
        branchId: branchIdNorm,
        wsUrlMasked: stompDebugMaskWsUrl(finalWsUrl),
      });
      const socket = new WebSocket(finalWsUrl);
      socketRef.current = socket;

      const stompClient = {
        connected: false,
        webSocket: socket,
        subscribe: (destination: string) => {
          const subscribeHeaders = {
            id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            destination,
          };
          sendStompFrame('SUBSCRIBE', subscribeHeaders);
          subscriptionsRef.current.add(destination);
        },
        publish: ({
          destination,
          body,
          headers = {},
        }: {
          destination: string;
          body: string;
          headers?: any;
        }) => {
          if (!stompClient.connected) return false;
          const sendHeaders = { destination, ...headers };
          return sendStompFrame('SEND', sendHeaders, body);
        },
        deactivate: () => {
          disconnectWebSocket();
        },
      };

      stompClientRef.current = stompClient;

      socket.onopen = () => {
        stompDebugLog('WebSocket onopen, sending STOMP CONNECT', {
          branchId: branchIdNorm,
          urlMasked: stompDebugMaskWsUrl(finalWsUrl),
        });
        sendStompFrame('CONNECT', {
          'accept-version': '1.1,1.0',
          'heart-beat': '10000,10000',
        });
      };

      socket.onmessage = (event) => {
        try {
          const frame = parseStompFrame(event.data);

          if (frame.command === 'CONNECTED') {
            stompDebugLog('STOMP CONNECTED received', {
              branchId: branchIdNorm,
              headers: frame.headers,
            });
            setIsConnected(true);
            setConnectionStatus('connected');
            stompClient.connected = true;
            isConnectingRef.current = false;

            setTimeout(() => {
              subscribeToTopics(branchIdNorm);
            }, 100);
            return;
          }

          if (frame.command === 'MESSAGE') {
            const cleanedBody = frame.body.replace(/\0/g, '').trim();
            if (!cleanedBody) return;

            const messageId = `${frame.headers.destination}_${cleanedBody}`;
            if (processedMessagesRef.current.has(messageId)) return;
            processedMessagesRef.current.add(messageId);

            setTimeout(() => {
              processedMessagesRef.current.delete(messageId);
            }, 10000);

            try {
              const parsedBody = JSON.parse(cleanedBody);
              const destination = String(
                frame.headers.destination || frame.headers.Destination || '',
              ).trim();

              if (destination === '/user/queue/errors') {
                setLastMessage({
                  data: parsedBody,
                  type: 'error',
                  rawBody: cleanedBody,
                  destination: destination,
                });
                return;
              }

              if (destination === '/user/queue/unread') {
                chatUnreadTrace('socket.frame /user/queue/unread', {
                  countUnMessages: parsedBody?.countUnMessages,
                  rawKeys:
                    parsedBody && typeof parsedBody === 'object' ? Object.keys(parsedBody) : [],
                });
                // Всегда применяем агрегат по пользователю — иначе при hasDetailedData глобальный бейдж
                // залипает на 0 (раньше пропускали кадр из‑за per-dialog режима).
                if (parsedBody && typeof parsedBody.countUnMessages === 'number') {
                  updateUnreadCountDirect(parsedBody.countUnMessages);
                }
              } else if (destination === `/queue/unread/${branchIdNorm}`) {
                if (Array.isArray(parsedBody)) {
                  const hasRealDialogs = parsedBody.some(
                    (item: any) =>
                      item.dialogId && item.dialogId > 0 && item.countUnMessages !== undefined,
                  );

                  if (hasRealDialogs) {
                    useDetailedCountsRef.current = true;
                    hasDetailedDataRef.current = true;
                    const dialogCount = parsedBody.filter(
                      (d: any) => d.dialogId && typeof d.countUnMessages === 'number',
                    ).length;
                    chatUnreadTrace('socket.frame /queue/unread/{branch} array(per-dialog)', {
                      branchId: branchIdNorm,
                      dialogRows: dialogCount,
                      snapshot: parsedBody.map((d: any) => ({
                        dialogId: d.dialogId,
                        countUnMessages: d.countUnMessages,
                      })),
                    });
                    parsedBody.forEach((dialogData: any) => {
                      if (dialogData.dialogId && typeof dialogData.countUnMessages === 'number') {
                        updateDialogUnreadCount(dialogData.dialogId, dialogData.countUnMessages);
                      }
                    });
                  } else {
                    const firstItem = parsedBody[0];
                    chatUnreadTrace('socket.frame /queue/unread/{branch} array(fallback total)', {
                      branchId: branchIdNorm,
                      length: parsedBody.length,
                      firstCountUnMessages: firstItem?.countUnMessages,
                    });
                    if (firstItem && typeof firstItem.countUnMessages === 'number') {
                      useDetailedCountsRef.current = false;
                      hasDetailedDataRef.current = false;
                      updateUnreadCountDirect(firstItem.countUnMessages);
                    }
                  }
                } else if (parsedBody?.dialogId && typeof parsedBody.countUnMessages === 'number') {
                  if (parsedBody.dialogId > 0) {
                    chatUnreadTrace('socket.frame /queue/unread/{branch} single dialog object', {
                      branchId: branchIdNorm,
                      dialogId: parsedBody.dialogId,
                      countUnMessages: parsedBody.countUnMessages,
                    });
                    useDetailedCountsRef.current = true;
                    hasDetailedDataRef.current = true;
                    updateDialogUnreadCount(parsedBody.dialogId, parsedBody.countUnMessages);
                  }
                } else if (
                  parsedBody &&
                  typeof parsedBody.countUnMessages === 'number' &&
                  !parsedBody.dialogId
                ) {
                  chatUnreadTrace('socket.frame /queue/unread/{branch} aggregate object', {
                    branchId: branchIdNorm,
                    countUnMessages: parsedBody.countUnMessages,
                    skippedBecausePerDialogMode: Boolean(
                      useDetailedCountsRef.current && hasDetailedDataRef.current,
                    ),
                  });
                  if (!(useDetailedCountsRef.current && hasDetailedDataRef.current)) {
                    useDetailedCountsRef.current = false;
                    hasDetailedDataRef.current = false;
                    updateUnreadCountDirect(parsedBody.countUnMessages);
                  }
                }

                chatUnreadTrace('socket.lastMessage emit', {
                  type: 'DIALOGS_UPDATE',
                  destination,
                  note: 'ChatContext обрабатывает DIALOGS_UPDATE как no-op для счётчиков (см. лог context)',
                });
                setLastMessage({
                  data: parsedBody,
                  type: 'DIALOGS_UPDATE',
                  rawBody: cleanedBody,
                  destination: destination,
                  forceRefresh: true,
                });
              } else if (destination === '/user/queue/messages') {
                if (parsedBody?.dialog?.id && parsedBody.messageStatus === 'TO_OPERATOR') {
                  useDetailedCountsRef.current = true;
                  hasDetailedDataRef.current = true;
                }

                incomingChatMessagesQueueRef.current.push(parsedBody);
                setLastMessage({
                  data: parsedBody,
                  type: destination,
                  rawBody: cleanedBody,
                  destination: destination,
                });
              } else if (destination === '/user/queue/status') {
                setLastMessage({
                  data: parsedBody,
                  type: 'STATUS_UPDATE',
                  rawBody: cleanedBody,
                  destination: destination,
                });
              } else if (destination === `/topic/dialog/status/${branchIdNorm}`) {
                setLastMessage({
                  data: parsedBody,
                  type: 'DIALOG_STATUS_UPDATE',
                  rawBody: cleanedBody,
                  destination: destination,
                });
              } else if (destination === `/topic/operator/messages/${branchIdNorm}`) {
                incomingChatMessagesQueueRef.current.push(parsedBody);
                setLastMessage({
                  data: parsedBody,
                  type: 'OPERATOR_MESSAGE',
                  rawBody: cleanedBody,
                  destination: destination,
                });
              } else {
                setLastMessage({
                  data: parsedBody,
                  type: destination,
                  rawBody: cleanedBody,
                  destination: destination,
                });
              }
            } catch (parseError) {
              if (frame.headers.destination === '/user/queue/errors') {
                setLastMessage({
                  data: { message: cleanedBody, type: 'PARSE_ERROR' },
                  type: 'error',
                  rawBody: cleanedBody,
                });
              } else {
                setLastMessage({
                  data: cleanedBody,
                  type: frame.headers.destination,
                  rawBody: cleanedBody,
                });
              }
            }
          } else if (frame.command === 'ERROR') {
            stompDebugLog('STOMP ERROR frame', {
              branchId: branchIdNorm,
              headers: frame.headers,
              bodyPreview:
                typeof frame.body === 'string' ? frame.body.slice(0, 500) : String(frame.body),
            });
            setLastMessage({ type: 'error', data: frame });
            setConnectionStatus('error');
            isConnectingRef.current = false;
          }
        } catch (error) {
          console.error('Ошибка парсинга сообщения WebSocket:', error);
        }
      };

      socket.onerror = (error) => {
        stompDebugLog('WebSocket onerror', {
          branchId: branchIdNorm,
          wsUrlMasked: stompDebugMaskWsUrl(finalWsUrl),
          event: error && typeof error === 'object' ? String(error.type) : String(error),
        });
        setIsConnected(false);
        setConnectionStatus('error');
        stompClient.connected = false;
        isConnectingRef.current = false;
        setLastMessage({ type: 'connection_error', data: error });

        if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = setTimeout(() => {
          const currentBranch = getBranchId();
          if (currentBranch) connectWebSocket(currentBranch);
        }, 5000);
      };

      socket.onclose = (event) => {
        stompDebugLog('WebSocket onclose', {
          branchId: branchIdNorm,
          code: event.code,
          reason: event.reason || '',
          wasClean: event.wasClean,
          wsUrlMasked: stompDebugMaskWsUrl(finalWsUrl),
        });
        setIsConnected(false);
        setConnectionStatus('disconnected');
        stompClient.connected = false;
        isConnectingRef.current = false;
        subscriptionsRef.current.clear();
        processedMessagesRef.current.clear();
        incomingChatMessagesQueueRef.current = [];
        incrementDedupeByMessageRef.current.clear();
        setLastMessage({
          type: 'connection_closed',
          data: { code: event.code, reason: event.reason, branchId: branchIdNorm },
        });

        if (event.code !== 1000 && event.reason !== 'Смена филиала') {
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            const currentBranch = getBranchId();
            if (currentBranch) connectWebSocket(currentBranch);
          }, 5000);
        }
      };
    } catch (error) {
      console.error('Ошибка создания WebSocket:', error);
      stompDebugLog('connectWebSocket constructor threw', {
        branchId: branchIdNorm,
        error: String(error),
      });
      setConnectionStatus('error');
      isConnectingRef.current = false;
    }
  };

  useEffect(() => {
    const unsubscribe = appStore.subscribe(() => {
      const newBranchId = getBranchId();
      if (newBranchId && newBranchId !== currentBranchId && apiConfig) {
        connectWebSocket(newBranchId);
      }
    });

    const initializeWithRetry = (attempt = 0) => {
      if (attempt > 5) return;
      const initialBranchId = getBranchId();
      if (initialBranchId && apiConfig) {
        connectWebSocket(initialBranchId);
      } else if (!apiConfig) {
        setTimeout(() => initializeWithRetry(attempt), 500);
      } else {
        setTimeout(() => initializeWithRetry(attempt + 1), 500);
      }
    };

    const initTimeout = setTimeout(() => {
      if (apiConfig) initializeWithRetry();
    }, 1000);

    return () => {
      clearTimeout(initTimeout);
      unsubscribe();
      disconnectWebSocket();
    };
  }, [apiConfig]);

  return (
    <SocketContext.Provider
      value={{
        lastMessage,
        stompClient: stompClientRef.current,
        isConnected,
        connectionStatus,
        currentBranchId,
        unreadCount,
        dialogsUnreadCounts,
        setUnreadCount: updateUnreadCountDirect,
        updateDialogUnreadCount,
        mergeDialogUnreadFromApi,
        incrementDialogUnreadCount,
        calculateTotalUnread,
        resetDialogCounts,
        flushIncomingChatMessages,
      }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useSocket must be used within SocketProvider');
  return ctx;
};
