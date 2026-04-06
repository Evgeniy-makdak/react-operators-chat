import { useCallback } from 'react';

import { useSocket } from '../SocketContext';

export const useChatStatusWebSocket = () => {
  const { stompClient } = useSocket();

  const sendStatus = useCallback(
    (uuid: string, status: 'DELIVERED' | 'READ'): boolean => {
      if (!stompClient || !stompClient.connected) return false;

      const message = { uuidMessage: uuid, status };
      return stompClient.publish({
        destination: '/app/chat.delivery.confirm',
        body: JSON.stringify(message),
        headers: { 'content-type': 'application/json' },
      });
    },
    [stompClient],
  );

  const requestStatuses = useCallback(
    (messageUUIDs: string[]): boolean => {
      if (!stompClient || !stompClient.connected) return false;

      return stompClient.publish({
        destination: '/app/chat.request.confirm',
        body: JSON.stringify(messageUUIDs),
        headers: { 'content-type': 'application/json' },
      });
    },
    [stompClient],
  );

  return {
    sendStatus,
    requestStatuses,
  };
};
