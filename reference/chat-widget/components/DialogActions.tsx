import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// import { Lock, LockOpen, TransferWithinAStation } from '@mui/icons-material';
import { Lock, LockOpen } from '@mui/icons-material';
import { Box, Button, Tooltip } from '@mui/material';

import { appStore } from '@shared/model/app_store/AppStore';

import api from '../api';
import { useChat } from '../contexts/ChatContext';

interface DialogActionsProps {
  sessionId: string;
  userId: number;
  dialogId: string;
  hasExistingDialog: boolean;
  onDialogStatusChange?: (status: string) => void;
  dialogData?: any;
  onBlockedStateChange?: (isBlocked: boolean) => void;
}

export const DialogActions: React.FC<DialogActionsProps> = ({
  sessionId,
  userId,
  dialogId,
  hasExistingDialog,
  onDialogStatusChange,
  dialogData,
  onBlockedStateChange,
}) => {
  const { t } = useTranslation();
  const { getSession, updateSession } = useChat();
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOwner, setIsDialogOwner] = useState(false);
  const [lastOperatorId, setLastOperatorId] = useState<number | null>(null);
  const [forceCheckOwner, setForceCheckOwner] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const justAssignedRef = useRef(false);
  const assignedDialogIdRef = useRef<string | null>(null);
  const lastValidDialogDataRef = useRef<any>(null);

  const session = getSession(sessionId);
  const dialogStatus = session?.selectedDialog?.status || '';

  useEffect(() => {
    const updateCurrentUserId = () => {
      const authId = appStore.getState().authId;
      setCurrentUserId(authId as any);
    };

    updateCurrentUserId();

    const unsubscribe = appStore.subscribe(updateCurrentUserId);

    return () => unsubscribe();
  }, []);

  const checkDialogOwner = useCallback(() => {
    if (!currentUserId) {
      setLastOperatorId(null);
      setIsDialogOwner(false);
      return;
    }

    if (dialogStatus !== 'CLOSED') {
      setLastOperatorId(null);
      setIsDialogOwner(false);
      return;
    }

    if (justAssignedRef.current && assignedDialogIdRef.current === dialogId) {
      if (dialogData?.lastOperator?.id === currentUserId) {
        lastValidDialogDataRef.current = dialogData;
        justAssignedRef.current = false;
      }

      setLastOperatorId(currentUserId);
      setIsDialogOwner(true);
      return;
    }

    const dataToUse = dialogData || lastValidDialogDataRef.current;

    if (dataToUse && dataToUse.lastOperator) {
      const operatorId = dataToUse.lastOperator.id;
      setLastOperatorId(operatorId);
      setIsDialogOwner(operatorId === currentUserId);

      if (operatorId === currentUserId) {
        lastValidDialogDataRef.current = dataToUse;
      }
    } else if (dataToUse && dataToUse.dialog?.lastOperator) {
      const operatorId = dataToUse.dialog.lastOperator.id;
      setLastOperatorId(operatorId);
      setIsDialogOwner(operatorId === currentUserId);

      if (operatorId === currentUserId) {
        lastValidDialogDataRef.current = dataToUse;
      }
    } else if (dialogStatus === 'CLOSED') {
      fetchDialogDetails();
    } else {
      setLastOperatorId(null);
      setIsDialogOwner(false);
    }
  }, [dialogData, dialogStatus, currentUserId, dialogId]);

  useEffect(() => {
    if (currentUserId !== null) {
      checkDialogOwner();
    }
  }, [checkDialogOwner, currentUserId]);

  useEffect(() => {
    if (forceCheckOwner) {
      const timer = setTimeout(() => {
        checkDialogOwner();
        setForceCheckOwner(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [forceCheckOwner, checkDialogOwner]);

  const fetchDialogDetails = async () => {
    if (!dialogId || dialogId === '0' || !currentUserId) {
      return;
    }

    try {
      const dialogDetails = await api.getDialogDetails(dialogId);
      if (dialogDetails.lastOperator) {
        const operatorId = dialogDetails.lastOperator.id;
        setLastOperatorId(operatorId);
        setIsDialogOwner(operatorId === currentUserId);

        if (operatorId === currentUserId) {
          lastValidDialogDataRef.current = dialogDetails;
        }
      } else {
        setLastOperatorId(null);
        setIsDialogOwner(false);
      }
    } catch (error) {
      setLastOperatorId(null);
      setIsDialogOwner(false);
    }
  };

  // const isAssigned = dialogStatus === 'CLOSED' || !!session?.assignedDialogId;

  const handleAssignDialog = async () => {
    if (isLoading || !currentUserId) {
      return;
    }

    setIsLoading(true);
    justAssignedRef.current = true;
    assignedDialogIdRef.current = dialogId;

    setLastOperatorId(currentUserId);
    setIsDialogOwner(true);

    try {
      const response = await api.assignDialog(userId.toString());

      const session = getSession(sessionId);
      if (session) {
        updateSession(sessionId, {
          selectedDialog: response,
          assignedDialogId: response?.id || null,
          hasLoadedDialogs: true,
          lastSendError: null,
        });

        if (onDialogStatusChange) {
          onDialogStatusChange('CLOSED');
        }

        lastValidDialogDataRef.current = response;
      }
    } catch (error: any) {
      justAssignedRef.current = false;

      if (error?.status === 409) {
        try {
          const dialogs = await api.getAllDialogs();
          const userDialog = dialogs?.find(
            (d: any) => d.owner?.id === userId || d.userId === userId,
          );

          if (userDialog) {
            updateSession(sessionId, {
              selectedDialog: userDialog,
              assignedDialogId: userDialog.id,
              hasLoadedDialogs: true,
              lastSendError: null,
            });

            if (onDialogStatusChange) {
              onDialogStatusChange('CLOSED');
            }

            lastValidDialogDataRef.current = userDialog;
          } else {
            updateSession(sessionId, {
              assignedDialogId: 'assigned',
              lastSendError: null,
            });

            if (onDialogStatusChange) {
              onDialogStatusChange('CLOSED');
            }
          }
        } catch (dialogError) {
          updateSession(sessionId, {
            assignedDialogId: 'assigned',
            lastSendError: null,
          });

          if (onDialogStatusChange) {
            onDialogStatusChange('CLOSED');
          }
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteDialog = async () => {
    if (isLoading || !hasExistingDialog || !isDialogOwner || !currentUserId) return;

    setIsLoading(true);
    try {
      await api.completeDialog(dialogId);
      updateSession(sessionId, {
        assignedDialogId: null,
        lastSendError: null,
        selectedDialog: {
          ...session?.selectedDialog,
          status: 'OPEN',
        },
      });

      if (onDialogStatusChange) {
        onDialogStatusChange('OPEN');
      }

      justAssignedRef.current = false;
      lastValidDialogDataRef.current = null;
    } catch (error) {
      console.error('Ошибка разблокировки диалога:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // const handleTransferDialog = async () => {
  //   if (isLoading || !hasExistingDialog || !isAssigned || !isDialogOwner || !currentUserId) return;

  //   setIsLoading(true);
  //   try {
  //     await api.transferDialog({
  //       dialogId: dialogId,
  //       targetOperatorId: userId.toString(),
  //     });
  //   } catch (error) {
  //     console.error('Ошибка передачи диалога:', error);
  //   } finally {
  //     setIsLoading(false);
  //   }
  // };

  const showAssignButton =
    // Либо есть существующий диалог с подходящим статусом
    (hasExistingDialog &&
      (dialogStatus === 'OPEN' ||
        dialogStatus === 'ACTIVE' ||
        !dialogStatus ||
        dialogStatus === '')) ||
    // Либо диалога ещё нет (нужно создать новый)
    !hasExistingDialog;
  const showClosedDialogButtons = dialogStatus === 'CLOSED';
  const showManagementButtons = showClosedDialogButtons && hasExistingDialog && isDialogOwner;
  const showBlockedButton = showClosedDialogButtons;

  const shouldShowBlockedByOther =
    showBlockedButton &&
    currentUserId &&
    lastOperatorId &&
    lastOperatorId !== currentUserId &&
    !justAssignedRef.current;

  useEffect(() => {
    if (onBlockedStateChange) {
      onBlockedStateChange(shouldShowBlockedByOther);
    }
  }, [shouldShowBlockedByOther, onBlockedStateChange]);

  const showUnlockedMessage = hasExistingDialog && dialogStatus !== 'CLOSED' && dialogId !== '0';

  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
      {showAssignButton && (
        <Tooltip title={t('chat.lockDialog')}>
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Lock />}
              onClick={handleAssignDialog}
              disabled={isLoading}
              sx={{ fontSize: '0.75rem' }}>
              {t('chat.take')}
            </Button>
          </span>
        </Tooltip>
      )}

      {shouldShowBlockedByOther && (
        <Tooltip title={t('chat.dialogLockedByOperator', { id: lastOperatorId })}>
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Lock />}
              disabled
              sx={{
                fontSize: '0.75rem',
                backgroundColor: '#ffebee',
                color: '#d32f2f',
              }}>
              {t('chat.blockedByOtherButton')}
            </Button>
          </span>
        </Tooltip>
      )}

      {showUnlockedMessage && !showAssignButton && (
        <Tooltip title={t('chat.unlockToSendHint')}>
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<LockOpen />}
              disabled
              sx={{
                fontSize: '0.75rem',
                backgroundColor: '#e3f2fd',
                color: '#1976d2',
                borderColor: '#90caf9',
              }}>
              {t('chat.dialogUnlocked')}
            </Button>
          </span>
        </Tooltip>
      )}

      {showManagementButtons && (
        <>
          <Tooltip title={t('chat.unlockDialog')}>
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<LockOpen />}
                onClick={handleCompleteDialog}
                disabled={isLoading}
                sx={{ fontSize: '0.75rem' }}>
                {t('chat.completeDialog')}
              </Button>
            </span>
          </Tooltip>

          <Tooltip title={t('chat.transferDialog')}>
            <span>
              {/* <Button
                variant="outlined"
                size="small"
                startIcon={<TransferWithinAStation />}
                onClick={handleTransferDialog}
                disabled={isLoading}
                sx={{ fontSize: '0.75rem' }}>
                Передать
              </Button> */}
            </span>
          </Tooltip>
        </>
      )}
    </Box>
  );
};
