import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Add as AddIcon,
  Chat as ChatIcon,
  Close as CloseIcon,
  ViewList as ViewListIcon,
} from '@mui/icons-material';
import {
  Box,
  Card,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';

import { appStore } from '@shared/model/app_store/AppStore';

import { DialogsApi, type UnreadDialog } from '../api/dialogsApi';
import ChatPanel from '../components/ChatPanel';
import { ChatProvider, useChat } from '../contexts/ChatContext';
import { SocketProvider, useSocket } from '../contexts/SocketContext';
import { chatUnreadTrace, unreadMapToRecord } from '../contexts/chatUnreadTrace';
import { resolveSessionDialogIdForUnread } from '../lib/resolveSessionDialogIdForUnread';
import styles from './ChatFooter.module.scss';

/** Должно совпадать с медиазапросом скрытия `.minimizedChats` в ChatFooter.module.scss */
const CHAT_COMPACT_MINIMIZED_QUERY = '(max-width: 1024px)';

function normalizeSessionDialogId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === 'assigned') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Диалог уже открыт/привязан к какой‑либо сессии — не показывать его второй раз в превью «непрочитанных». */
function sessionListAlreadyCoversDialog(
  sessions: Array<{ selectedDialog?: { id?: unknown }; assignedDialogId?: unknown }>,
  dialogId: number,
): boolean {
  return sessions.some((session) => {
    const fromSelected = normalizeSessionDialogId(session.selectedDialog?.id);
    const fromAssigned = normalizeSessionDialogId(session.assignedDialogId);
    return fromSelected === dialogId || fromAssigned === dialogId;
  });
}

/**
 * Список непрочитанных с API кладётся в unreadDialogs у каждой сессии (loadUnreadDialogs).
 * Без дедупликации один dialog.id даёт по строке превью на каждую сессию — на мобильном список и счётчик врут.
 */
function collectDedupedUnreadDialogsForPreview(
  sessions: Array<{
    id: string;
    unreadDialogs?: UnreadDialog[];
    selectedDialog?: { id?: unknown };
    assignedDialogId?: unknown;
  }>,
  hasSessionWithUser: (userId: number) => boolean,
): { dialog: UnreadDialog; sessionId: string }[] {
  const seenDialogIds = new Set<number>();
  const rows: { dialog: UnreadDialog; sessionId: string }[] = [];

  for (const session of sessions) {
    const unreadList =
      session.unreadDialogs?.filter((dialog) => {
        const dialogUserId = dialog.owner?.id;
        if (dialogUserId && hasSessionWithUser(dialogUserId)) return false;
        if (sessionListAlreadyCoversDialog(sessions, dialog.id)) return false;
        return true;
      }) ?? [];

    for (const dialog of unreadList) {
      if (seenDialogIds.has(dialog.id)) continue;
      seenDialogIds.add(dialog.id);
      rows.push({ dialog, sessionId: session.id });
    }
  }

  return rows;
}

function previewLineFromMessagePayload(msg: unknown, attachmentLabel: string): string {
  if (!msg || typeof msg !== 'object') return '';
  const m = msg as { text?: string; attachments?: unknown[] };
  const text = (m.text || '').trim();
  if (text.length > 0) return text;
  if (Array.isArray(m.attachments) && m.attachments.length > 0) return attachmentLabel;
  return '';
}

function truncatePreviewLine(text: string, maxLen: number): string {
  const s = text.trim();
  if (!s) return '';
  return s.length <= maxLen ? s : `${s.slice(0, maxLen)}…`;
}

function unreadCountForPreviewEntry(
  dialog: UnreadDialog,
  dialogsUnreadCounts: Map<number, number> | undefined,
  /** Только если для dialogId ещё нет ключа в карте: прежний обходной путь, когда карта отстаёт. */
  solePreviewSocketTotalHint: number = 0,
): number {
  const map = dialogsUnreadCounts || new Map();
  // Есть явная запись по этому диалогу — только она (иначе при ровно одной строке превью
  // solePreviewSocketTotalHint = общий агрегат и «чужой» +1 заливает бейдж другого dialogId).
  if (map.has(dialog.id)) {
    return map.get(dialog.id)!;
  }
  const fromApi = Number(dialog.countUnMessages ?? dialog.countUnreadMess ?? 0);
  const base = Number.isFinite(fromApi) ? fromApi : 0;
  if (solePreviewSocketTotalHint <= 0) return base;
  return Math.max(base, solePreviewSocketTotalHint);
}

/**
 * Счётчик на превью свёрнутой сессии: dialogId из ленты (если однозначен), иначе метаданные;
 * если в WS-карте есть запись для этого id — она приоритетнее session.unreadCount.
 */
function effectiveMinimizedSessionUnread(
  session: {
    selectedDialog?: { id?: unknown };
    assignedDialogId?: unknown;
    unreadCount?: number;
    messages?: any[];
  },
  dialogsUnreadCounts: Map<number, number> | undefined,
): number {
  const dialogId = resolveSessionDialogIdForUnread(session);
  const map = dialogsUnreadCounts;
  if (dialogId != null && map != null && map.has(dialogId)) {
    return map.get(dialogId)!;
  }
  return session.unreadCount ?? 0;
}

function minimizedSessionPreviewRaw(
  session: {
    messages?: any[];
    selectedDialog?: { id?: unknown };
    assignedDialogId?: unknown;
  },
  fetchedByDialogId: Record<number, string>,
  attachmentLabel: string,
): string {
  if (session.messages?.length) {
    const last = session.messages[session.messages.length - 1];
    const local = previewLineFromMessagePayload(last, attachmentLabel);
    if (local) return local;
  }
  const did = normalizeSessionDialogId(session.selectedDialog?.id ?? session.assignedDialogId);
  if (did !== null) {
    const fetched = (fetchedByDialogId[did] || '').trim();
    if (fetched) return fetched;
  }
  return '';
}

const UnreadMessagesBadge = ({ count }: { count: number }) => {
  return <span className={styles.notifications}>{count > 99 ? '99+' : count}</span>;
};

const useOperatorPermissions = () => {
  const [hasChatPermissions, setHasChatPermissions] = useState(false);

  useEffect(() => {
    const unsubscribe = appStore.subscribe(() => {
      const permissions = appStore.getState().permissions || [];

      const hasPermissions = permissions.some((permission: string) =>
        permission.includes('PERMISSION_OPERATOR_CHATS'),
      );

      setHasChatPermissions(hasPermissions);
    });

    const initialPermissions = appStore.getState().permissions || [];
    const hasInitialPermissions = initialPermissions.some((permission: string) =>
      permission.includes('PERMISSION_OPERATOR_CHATS'),
    );
    setHasChatPermissions(hasInitialPermissions);

    return unsubscribe;
  }, []);

  return hasChatPermissions;
};

const ChatToggleButton = () => {
  const { t } = useTranslation();
  const { isChatOpen, setIsChatOpen, sessions, closeSession, createNewSession } = useChat();
  const { calculateTotalUnread } = useSocket();
  const iconUnreadTotal = calculateTotalUnread();

  const handleToggle = () => {
    if (isChatOpen) {
      sessions.forEach((session) => {
        closeSession(session.id);
      });
      setIsChatOpen(false);
    } else {
      setIsChatOpen(true);
      createNewSession();
    }
  };

  const tooltipTitle = t('chat.toggleTooltip', { count: iconUnreadTotal });

  return (
    <Tooltip title={tooltipTitle} placement="left">
      <div className={styles.toggleButtonWrapper}>
        <IconButton
          className={styles.toggleButton}
          onClick={handleToggle}
          color="primary"
          size="large">
          {isChatOpen ? <CloseIcon /> : <ChatIcon />}
        </IconButton>
        <UnreadMessagesBadge count={iconUnreadTotal} />
      </div>
    </Tooltip>
  );
};

const NewChatButton = () => {
  const { t } = useTranslation();
  const { createNewSession, sessions, toggleSessionMinimize, setActiveSessionId } = useChat();

  const handleNewChat = () => {
    sessions.forEach((session) => {
      if (!session.isMinimized) {
        toggleSessionMinimize(session.id);
      }
    });

    const newSessionId = createNewSession();
    setActiveSessionId(newSessionId);
  };

  if (sessions.length === 0) return null;

  return (
    <Tooltip title={t('chat.openNewChat')} placement="left">
      <div className={styles.newChatButtonWrapper}>
        <IconButton
          className={styles.newChatButton}
          onClick={handleNewChat}
          color="primary"
          size="large">
          <AddIcon />
        </IconButton>
      </div>
    </Tooltip>
  );
};

const ChatContainer = () => {
  const { t } = useTranslation();
  const {
    isChatOpen,
    sessions,
    setActiveSessionId,
    closeSession,
    expandSession,
    toggleSessionMinimize,
    setIsChatOpen,
    openUnreadDialog,
    hasSessionWithUser,
  } = useChat();
  const {
    lastMessage,
    dialogsUnreadCounts,
    unreadCount: socketUnreadTotal,
    calculateTotalUnread,
  } = useSocket();
  const [isVisible, setIsVisible] = useState(true);
  const [justExpandedSessionId, setJustExpandedSessionId] = useState<string | null>(null);
  const hasChatPermissions = useOperatorPermissions();

  // Агрегат и карта по диалогам ведёт только SocketContext (кадры WS). Ранее здесь
  // вызывался setUnreadCount по любому lastMessage с countUnMessages — в том числе
  // DIALOGS_UPDATE с 0 — это обнуляло бейдж и ломало mergeDialogUnreadFromApi.

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.ctrlKey) {
        const key = event.key.toLowerCase();
        if (key === 'd' || key === 'в') {
          event.preventDefault();
          setIsVisible((prev) => !prev);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (sessions.length === 0 && isChatOpen) {
      setIsChatOpen(false);
    } else if (sessions.length > 0 && !isChatOpen) {
      setIsChatOpen(true);
    }
  }, [sessions, isChatOpen, setIsChatOpen]);

  useEffect(() => {
    const unsubscribe = appStore.subscribe(() => {
      const currentBranchId = appStore.getState().selectedBranchState?.id;

      if (currentBranchId !== undefined) {
        sessions.forEach((session) => {
          closeSession(session.id);
        });
      }
    });

    return () => unsubscribe();
  }, [sessions, closeSession]);

  const handleToggleSessionMinimize = (sessionId: string) => {
    toggleSessionMinimize(sessionId);
    setActiveSessionId(null);
  };

  const handleExpandSession = useCallback(
    (sessionId: string) => {
      setJustExpandedSessionId(sessionId);
      expandSession(sessionId);
    },
    [expandSession, sessions],
  );

  const handleScrollToBottomDone = useCallback(() => {
    setJustExpandedSessionId(null);
  }, []);

  const isCompactMinimizedUi = useMediaQuery(CHAT_COMPACT_MINIMIZED_QUERY);
  const [minimizedListOpen, setMinimizedListOpen] = useState(false);

  type CompactMinimizedEntry =
    | {
        kind: 'session';
        key: string;
        sessionId: string;
        title: string;
        subtitle?: string;
        unread: number;
      }
    | {
        kind: 'unread';
        key: string;
        sessionId: string;
        dialog: UnreadDialog;
        title: string;
        subtitle?: string;
        unread: number;
      };

  const dedupedUnreadPreviewRows = useMemo(
    () => collectDedupedUnreadDialogsForPreview(sessions, hasSessionWithUser),
    [sessions, hasSessionWithUser],
  );

  const solePreviewSocketUnreadHint = useMemo(() => {
    if (dedupedUnreadPreviewRows.length !== 1) return 0;
    return calculateTotalUnread();
  }, [dedupedUnreadPreviewRows, calculateTotalUnread]);

  const dialogIdsToFetch = useMemo(() => {
    const ids = new Set<number>();
    dedupedUnreadPreviewRows.forEach(({ dialog }) => ids.add(dialog.id));
    for (const s of sessions) {
      if (!s.isMinimized) continue;
      if (s.messages?.length) continue;
      const d = normalizeSessionDialogId(s.selectedDialog?.id ?? s.assignedDialogId);
      if (d !== null) ids.add(d);
    }
    return Array.from(ids).sort((a, b) => a - b);
  }, [dedupedUnreadPreviewRows, sessions]);

  const [dialogPreviewLines, setDialogPreviewLines] = useState<Record<number, string>>({});
  const dialogFetchKey = dialogIdsToFetch.join(',');

  useEffect(() => {
    if (dialogIdsToFetch.length === 0) {
      setDialogPreviewLines({});
      return;
    }

    let cancelled = false;
    const attachmentLabel = t('chat.previewAttachment');

    void (async () => {
      const results = await Promise.all(
        dialogIdsToFetch.map(async (dialogId) => {
          try {
            const res = await DialogsApi.getMessages({
              dialogId: String(dialogId),
              page: 0,
              size: 1,
              sort: 'createdAt,desc',
            });
            const msg = res?.data?.content?.[0];
            return [dialogId, previewLineFromMessagePayload(msg, attachmentLabel)] as const;
          } catch {
            return [dialogId, ''] as const;
          }
        }),
      );

      if (cancelled) return;
      setDialogPreviewLines(Object.fromEntries(results) as Record<number, string>);
    })();

    return () => {
      cancelled = true;
    };
  }, [dialogFetchKey, t]);

  const attachmentLabel = t('chat.previewAttachment');

  const compactMinimizedEntries = useMemo((): CompactMinimizedEntry[] => {
    const minimized = sessions.filter((s) => s.isMinimized);
    const items: CompactMinimizedEntry[] = [];

    minimized.forEach((session) => {
      const raw = minimizedSessionPreviewRaw(session, dialogPreviewLines, attachmentLabel);
      const subtitle = truncatePreviewLine(raw, 60);
      items.push({
        kind: 'session',
        key: `minimized-${session.id}`,
        sessionId: session.id,
        title:
          session.selectedUserName ||
          session.selectedDialog?.client_name ||
          t('chat.newChatFallback'),
        subtitle: subtitle || undefined,
        unread: effectiveMinimizedSessionUnread(session, dialogsUnreadCounts),
      });
    });

    dedupedUnreadPreviewRows.forEach(({ dialog, sessionId }) => {
      const unreadCount = unreadCountForPreviewEntry(
        dialog,
        dialogsUnreadCounts,
        solePreviewSocketUnreadHint,
      );
      const raw = (dialogPreviewLines[dialog.id] || '').trim();
      const subtitle = truncatePreviewLine(raw, 60);
      items.push({
        kind: 'unread',
        key: `unread-${dialog.id}`,
        sessionId,
        dialog,
        title: dialog.owner.fullName,
        subtitle: subtitle || undefined,
        unread: unreadCount,
      });
    });

    return items;
  }, [
    sessions,
    dedupedUnreadPreviewRows,
    dialogsUnreadCounts,
    dialogPreviewLines,
    attachmentLabel,
    t,
    solePreviewSocketUnreadHint,
  ]);

  useEffect(() => {
    const previewUnreadBadges = compactMinimizedEntries
      .filter((e): e is Extract<typeof e, { kind: 'unread' }> => e.kind === 'unread')
      .map((e) => ({
        dialogId: e.dialog.id,
        badge: e.unread,
        title: e.title,
      }));
    const listUnreadSum = compactMinimizedEntries.reduce((s, e) => s + e.unread, 0);
    const minimizedListToggleBadge =
      listUnreadSum > 0 ? listUnreadSum : compactMinimizedEntries.length;
    chatUnreadTrace('render.ChatFooter badge snapshot', {
      globalIconBadge: calculateTotalUnread(),
      socketAggregateUnreadOnly: socketUnreadTotal,
      minimizedListToggleBadge,
      socketDialogMapEntries: unreadMapToRecord(dialogsUnreadCounts),
      unreadPreviewRows: previewUnreadBadges,
      minimizedSessionsUnread: sessions
        .filter((s) => s.isMinimized)
        .map((s) => ({
          sessionId: s.id,
          unread: effectiveMinimizedSessionUnread(s, dialogsUnreadCounts),
        })),
      lastMessageType: lastMessage?.type,
      lastMessageDestination: lastMessage?.destination,
    });
  }, [
    compactMinimizedEntries,
    dialogsUnreadCounts,
    socketUnreadTotal,
    sessions,
    lastMessage?.type,
    lastMessage?.destination,
    calculateTotalUnread,
  ]);

  if (!hasChatPermissions) {
    return null;
  }

  if (!isVisible) {
    return null;
  }

  const expandedSessions = sessions.filter((session) => !session.isMinimized);
  const minimizedSessions = sessions.filter((session) => session.isMinimized);

  const hasUnreadInCompactList = compactMinimizedEntries.some((e) => e.unread > 0);
  const compactListUnreadSum = compactMinimizedEntries.reduce((s, e) => s + e.unread, 0);
  const minimizedListToggleBadge =
    compactListUnreadSum > 0 ? compactListUnreadSum : compactMinimizedEntries.length;

  return (
    <div className={styles.chatContainer}>
      <NewChatButton />
      {isCompactMinimizedUi && compactMinimizedEntries.length > 0 && (
        <>
          <Tooltip title={t('chat.minimizedListTooltip')} placement="left">
            <div className={styles.showMinimizedButtonWrapper}>
              <IconButton
                className={styles.showMinimizedButton}
                onClick={() => setMinimizedListOpen(true)}
                color="primary"
                size="large"
                aria-label={t('chat.minimizedListTooltip')}>
                <ViewListIcon />
              </IconButton>
              <span
                className={
                  hasUnreadInCompactList
                    ? styles.minimizedListCountBadgeUnread
                    : styles.minimizedListCountBadge
                }
                aria-hidden>
                {minimizedListToggleBadge > 99 ? '99+' : minimizedListToggleBadge}
              </span>
            </div>
          </Tooltip>
          <Drawer
            anchor="bottom"
            open={minimizedListOpen}
            onClose={() => setMinimizedListOpen(false)}
            slotProps={{
              paper: {
                sx: {
                  maxHeight: '55vh',
                  borderTopLeftRadius: 12,
                  borderTopRightRadius: 12,
                },
              },
            }}>
            <Box sx={{ px: 2, pt: 2, pb: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                {t('chat.minimizedListTitle')}
              </Typography>
            </Box>
            <List dense disablePadding sx={{ pb: 2, px: 0.5 }}>
              {compactMinimizedEntries.map((entry) => (
                <ListItemButton
                  key={entry.key}
                  sx={{ alignItems: 'flex-start', gap: 1, py: 1.25 }}
                  onClick={() => {
                    setMinimizedListOpen(false);
                    if (entry.kind === 'session') {
                      handleExpandSession(entry.sessionId);
                    } else {
                      void openUnreadDialog(entry.sessionId, entry.dialog);
                    }
                  }}>
                  <ListItemText
                    sx={{ flex: '1 1 auto', minWidth: 0, my: 0 }}
                    primary={entry.title}
                    secondary={entry.subtitle}
                    primaryTypographyProps={{ noWrap: true }}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                  <Typography
                    component="span"
                    variant="caption"
                    sx={{
                      flexShrink: 0,
                      bgcolor: entry.unread > 0 ? 'error.main' : 'action.selected',
                      color: entry.unread > 0 ? 'error.contrastText' : 'text.secondary',
                      borderRadius: '10px',
                      px: 0.75,
                      py: 0.25,
                      fontWeight: 600,
                      minWidth: 22,
                      textAlign: 'center',
                      lineHeight: 1.5,
                      mt: 0.25,
                    }}>
                    {entry.unread > 99 ? '99+' : entry.unread}
                  </Typography>
                </ListItemButton>
              ))}
            </List>
          </Drawer>
        </>
      )}
      <ChatToggleButton />

      <div className={styles.minimizedChats}>
        {minimizedSessions.map((session, index) => {
          const previewLine = truncatePreviewLine(
            minimizedSessionPreviewRaw(session, dialogPreviewLines, attachmentLabel),
            30,
          );
          const minimizedUnread = effectiveMinimizedSessionUnread(session, dialogsUnreadCounts);
          return (
            <div
              key={`minimized-${session.id}`}
              className={`${styles.minimizedChat} ${minimizedUnread > 0 ? styles.hasUnread : ''}`}
              style={{
                bottom: `${120 + index * 60}px`,
                right: '540px',
                zIndex: 1000 - index,
              }}
              onClick={() => handleExpandSession(session.id)}>
              <div className={styles.minimizedHeader}>
                <span>
                  {session.selectedUserName ||
                    session.selectedDialog?.client_name ||
                    t('chat.newChatFallback')}
                </span>
                <span className={styles.unreadBadge}>
                  {minimizedUnread > 99 ? '99+' : minimizedUnread}
                </span>
              </div>
              {previewLine ? <div className={styles.lastMessage}>{previewLine}</div> : null}
            </div>
          );
        })}

        {dedupedUnreadPreviewRows.map(({ dialog, sessionId }, index) => {
          const unreadCount = unreadCountForPreviewEntry(
            dialog,
            dialogsUnreadCounts,
            solePreviewSocketUnreadHint,
          );
          const raw = (dialogPreviewLines[dialog.id] || '').trim();
          const line = truncatePreviewLine(raw, 30);

          return (
            <div
              key={`unread-${dialog.id}`}
              className={`${styles.minimizedChat} ${styles.unreadDialog} ${
                unreadCount > 0 ? styles.hasUnread : ''
              }`}
              style={{
                bottom: `${120 + (minimizedSessions.length + index) * 60}px`,
                right: '540px',
                zIndex: 1000 - (minimizedSessions.length + index),
              }}
              onClick={async () => {
                await openUnreadDialog(sessionId, dialog);
              }}>
              <div className={styles.minimizedHeader}>
                <span>{dialog.owner.fullName}</span>
                <span className={styles.unreadBadge}>{unreadCount}</span>
              </div>
              {line ? <div className={styles.lastMessage}>{line}</div> : null}
            </div>
          );
        })}
      </div>

      {expandedSessions.map((session) => (
        <Card key={`expanded-${session.id}`} className={`${styles.chatFooter} ${styles.expanded}`}>
          <ChatPanel
            sessionId={session.id}
            onMinimize={() => handleToggleSessionMinimize(session.id)}
            scrollToBottomOnExpand={justExpandedSessionId === session.id}
            onScrollToBottomDone={handleScrollToBottomDone}
          />
        </Card>
      ))}
    </div>
  );
};

const ChatFooter = () => {
  return (
    <SocketProvider>
      <ChatProvider>
        <ChatContainer />
      </ChatProvider>
    </SocketProvider>
  );
};

export default ChatFooter;
