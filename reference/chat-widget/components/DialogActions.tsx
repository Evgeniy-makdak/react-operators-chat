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
      const loId = dialogData?.lastOperator?.id ?? dialogData?.last_operator?.id;
      if (loId != null && Number(loId) === Number(currentUserId)) {
        lastValidDialogDataRef.current = dialogData;
        justAssignedRef.current = false;
      }

      setLastOperatorId(currentUserId);
      setIsDialogOwner(true);
      return;
    }

    const dataToUse = dialogData || lastValidDialogDataRef.current;

    const rootLo = dataToUse?.lastOperator ?? dataToUse?.last_operator;
    if (dataToUse && rootLo) {
      const operatorId = rootLo.id;
      setLastOperatorId(operatorId);
      setIsDialogOwner(Number(operatorId) === Number(currentUserId));

      if (Number(operatorId) === Number(currentUserId)) {
        lastValidDialogDataRef.current = dataToUse;
      }
    } else if (dataToUse) {
      const nestedLo = dataToUse.dialog?.lastOperator ?? dataToUse.dialog?.last_operator;
      if (nestedLo) {
        const operatorId = nestedLo.id;
        setLastOperatorId(operatorId);
        setIsDialogOwner(Number(operatorId) === Number(currentUserId));

        if (Number(operatorId) === Number(currentUserId)) {
          lastValidDialogDataRef.current = dataToUse;
        }
      } else if (dialogStatus === 'CLOSED') {
        fetchDialogDetails();
      } else {
        setLastOperatorId(null);
        setIsDialogOwner(false);
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
      const detailsLo = dialogDetails?.lastOperator ?? dialogDetails?.last_operator;
      if (detailsLo) {
        const operatorId = detailsLo.id;
        setLastOperatorId(operatorId);
        setIsDialogOwner(operatorId === currentUserId);

        if (operatorId === currentUserId) {
          lastValidDialogDataRef.current = {
            ...dialogDetails,
            lastOperator: detailsLo,
          };
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
      const meName = appStore.getState().fullName;
      const normalizedResponse =
        response && typeof response === 'object'
          ? {
              ...response,
              lastOperator:
                (response as any).lastOperator ??
                (response as any).last_operator ??
                (currentUserId
                  ? {
                      id: currentUserId,
                      ...(meName ? { fullName: meName } : {}),
                    }
                  : undefined),
            }
          : response;

      const session = getSession(sessionId);
      if (session) {
        updateSession(sessionId, {
          selectedDialog: normalizedResponse,
          assignedDialogId: normalizedResponse?.id || null,
          hasLoadedDialogs: true,
          lastSendError: null,
          transferRecipientFullName: null,
        });

        if (onDialogStatusChange) {
          onDialogStatusChange('CLOSED');
        }

        lastValidDialogDataRef.current = normalizedResponse;
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
            const meName409 = appStore.getState().fullName;
            const ud = userDialog as any;
            const normalized409 = {
              ...ud,
              lastOperator:
                ud.lastOperator ??
                ud.last_operator ??
                (currentUserId
                  ? {
                      id: currentUserId,
                      ...(meName409 ? { fullName: meName409 } : {}),
                    }
                  : undefined),
            };
            updateSession(sessionId, {
              selectedDialog: normalized409,
              assignedDialogId: userDialog.id,
              hasLoadedDialogs: true,
              lastSendError: null,
              transferRecipientFullName: null,
            });

            if (onDialogStatusChange) {
              onDialogStatusChange('CLOSED');
            }

            lastValidDialogDataRef.current = normalized409;
          } else {
            updateSession(sessionId, {
              assignedDialogId: 'assigned',
              lastSendError: null,
              transferRecipientFullName: null,
            });

            if (onDialogStatusChange) {
              onDialogStatusChange('CLOSED');
            }
          }
        } catch (dialogError) {
          updateSession(sessionId, {
            assignedDialogId: 'assigned',
            lastSendError: null,
            transferRecipientFullName: null,
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
        transferRecipientFullName: null,
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

  const blockerLo = dialogData?.lastOperator ?? dialogData?.dialog?.lastOperator;
  const blockerNameForTooltip =
    blockerLo?.fullName ||
    [blockerLo?.firstName, blockerLo?.surname].filter(Boolean).join(' ').trim() ||
    '';

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
        <Tooltip
          title={
            blockerNameForTooltip
              ? t('chat.dialogLockedByOperatorNamed', { fullName: blockerNameForTooltip })
              : t('chat.dialogLockedByOperator', { id: lastOperatorId })
          }>
          <span>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Lock />}
              disabled
              sx={{ fontSize: '0.75rem' }}>
              {t('chat.take')}
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
              {session?.transferRecipientFullName
                ? t('chat.dialogTransferredToOperator', {
                    fullName: session.transferRecipientFullName,
                  })
                : t('chat.dialogUnlocked')}
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
        </>
      )}
    </Box>
  );
};
