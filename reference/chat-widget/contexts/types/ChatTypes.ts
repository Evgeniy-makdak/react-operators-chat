/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnreadDialog } from '../../api/dialogsApi';

export interface ChatPagination {
  currentPage: number;
  totalPages: number;
  totalElements: number;
  isLoadingMore: boolean;
  isLoadingNext: boolean;
  hasMoreMessages: boolean;
  hasNextMessages: boolean;
}

export interface ChatSession {
  id: string;
  dialogs: any[];
  messages: any[];
  selectedDialog: any;
  isMinimized: boolean;
  selectedUsers: number[];
  selectedUserName: string;
  messageText: string;
  usersCache: Map<number, any>;
  isDialogEnded: boolean;
  isUsersTouched: boolean;
  hasSentMessage: boolean;
  clearMessageInput: boolean;
  uploadedAttachments: Array<{
    id: string;
    type: string;
    name: string;
    size: number;
    url?: string;
  }>;
  hasLoadedDialogs: boolean;
  pendingAttachments: File[];
  isSendingMessage: boolean;
  lastSendError: string | null;
  assignedDialogId: string | null;
  unreadDialogs: UnreadDialog[];
  isLoadingUnreadDialogs: boolean;
  hasHistoryLoaded?: boolean;
  pagination?: ChatPagination;
  unreadCount?: number;
  totalUnreadCount?: number;
}

export interface ChatContextType {
  sessions: ChatSession[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  sendMessage: (
    sessionId: string,
    value: any,
    onSuccess: () => void,
    onError: (err: any) => void,
  ) => void;
  isChatOpen: boolean;
  setIsChatOpen: (isOpen: boolean) => void;
  clearMessages: (sessionId: string) => void;
  createNewSession: () => string;
  closeSession: (sessionId: string) => void;
  toggleSessionMinimize: (sessionId: string) => void;
  expandSession: (sessionId: string) => void;
  updateSession: (sessionId: string, updates: Partial<ChatSession>) => void;
  getSession: (sessionId: string) => ChatSession | undefined;
  findSessionByUserId: (userId: number) => ChatSession | undefined;
  removeEmptySessions: (excludeSessionId?: string) => void;
  uploadAttachments: (
    sessionId: string,
    files: File[],
  ) => Promise<Array<{ id: string; type: string; name: string; size: number; url?: string }>>;
  refreshDialogs: (sessionId: string) => void;
  addPendingAttachments: (sessionId: string, files: File[]) => void;
  setPendingAttachments: (sessionId: string, files: File[]) => void;
  clearPendingAttachments: (sessionId: string) => void;
  getPendingAttachments: (sessionId: string) => File[];
  assignDialog: (sessionId: string, userId: number) => Promise<any>;
  loadUnreadDialogs: (sessionId: string) => Promise<void>;
  loadDialogDetails: (dialogId: number) => Promise<any>;
  openUnreadDialog: (sessionId: string, dialog: UnreadDialog) => Promise<void>;
  setDialogsUnreadCounts: (counts: Map<number, number>) => void;
  forceLoadUnreadDialogs: (sessionId: string) => Promise<void>;
  sendDeliveredStatusesForSession: (sessionId: string) => void;
  sendReadStatusesForSession: (sessionId: string) => void;
  sendDeliveredStatusForNewMessage: (sessionId: string, messageUuid: string) => boolean; // ДОБАВЬТЕ ЭТУ СТРОКУ
  refreshUserMessages: (sessionId: string) => void;
  refreshSessionMessages: (sessionId: string, force?: boolean) => Promise<void>;
  refreshUserMessagesAfterSend: (sessionId: string) => void;
  hasSessionWithUser: (userId: number) => boolean;
  getSessionByUserId: (userId: number) => ChatSession | undefined;
  removeDuplicateSessions: () => void;
  forceRefreshSessionMessages: (sessionId: string, retryCount?: number) => Promise<void>;
  addMessageFromWebSocket: (sessionId: string, messageData: any) => void;
  loadDialogHistory: (sessionId: string, dialogId: string) => Promise<void>;
  sendReadStatusForMessageId: (sessionId: string, messageId: string) => void;
  loadMessagesByUserId: (sessionId: string, userId: number) => Promise<void>;
  autoRefreshOpenSessionMessages?: (sessionId: string) => Promise<void>;
  debouncedRefreshMessages?: (sessionId: string) => void;
  refreshAllOpenSessions?: () => void;
  refreshMessagesForUserId?: (sessionId: string, userId: number) => Promise<void>;
  loadPreviousMessages: (sessionId: string) => Promise<boolean>;
  loadNextMessages: (sessionId: string) => Promise<boolean>;
  loadFirstPageMessages: (sessionId: string, dialogId: string) => Promise<boolean>;
  refreshDialogHistory: (sessionId: string, dialogId: string) => Promise<boolean>;
  debouncedSyncDialogHistory: (sessionId: string, dialogId: string) => void;
  addNewMessageToSession: (sessionId: string, messageData: any) => void;
  navigateToQuotedMessage: (
    sessionId: string,
    dialogId: string,
    quotedMessage: any,
    pageSize?: number,
  ) => Promise<boolean>;
}
