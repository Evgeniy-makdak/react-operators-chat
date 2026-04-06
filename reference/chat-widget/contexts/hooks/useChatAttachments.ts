import { useCallback } from 'react';

import api from '../../api';

export const useChatAttachments = (
  getSession: (sessionId: string) => any,
  updateSession: (sessionId: string, updates: any) => void,
) => {
  const uploadAttachments = useCallback(
    async (
      sessionId: string,
      files: File[],
    ): Promise<Array<{ id: string; type: string; name: string; size: number; url?: string }>> => {
      try {
        const uploadPromises = files.map((file) => api.uploadFile(file));
        const results = await Promise.all(uploadPromises);

        const session = getSession(sessionId);
        if (session) {
          const newAttachments = [...session.uploadedAttachments, ...results];
          updateSession(sessionId, {
            uploadedAttachments: newAttachments,
          });
        }

        return results;
      } catch (error) {
        console.error('❌ Ошибка загрузки вложений:', error);
        throw error;
      }
    },
    [getSession, updateSession],
  );

  const addPendingAttachments = useCallback(
    (sessionId: string, files: File[]) => {
      const session = getSession(sessionId);
      if (session) {
        const newPendingAttachments = [...session.pendingAttachments, ...files];
        updateSession(sessionId, {
          pendingAttachments: newPendingAttachments,
        });
      }
    },
    [getSession, updateSession],
  );

  const setPendingAttachments = useCallback(
    (sessionId: string, files: File[]) => {
      updateSession(sessionId, {
        pendingAttachments: files,
      });
    },
    [updateSession],
  );

  const clearPendingAttachments = useCallback(
    (sessionId: string) => {
      updateSession(sessionId, {
        pendingAttachments: [],
      });
    },
    [updateSession],
  );

  const getPendingAttachments = useCallback(
    (sessionId: string): File[] => {
      const session = getSession(sessionId);
      return session?.pendingAttachments || [];
    },
    [getSession],
  );

  return {
    uploadAttachments,
    addPendingAttachments,
    setPendingAttachments,
    clearPendingAttachments,
    getPendingAttachments,
  };
};
