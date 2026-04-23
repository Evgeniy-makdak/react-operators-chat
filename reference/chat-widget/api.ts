/* eslint-disable @typescript-eslint/no-explicit-any */
import CryptoJS from 'crypto-js';

import { ChatsApi } from '@shared/api/baseQuerys';
import { appStore } from '@shared/model/app_store/AppStore';

import { configLoader } from '../../config/configLoader';
import { DialogsApi, UnreadDialog } from './api/dialogsApi';
import { processMultipleImages, validateMultipleImages } from './contexts/ImageUtils';

interface PhotoResponseItem {
  id: number;
  fileName: string;
  hash: string;
  createdAt: string;
  userId: number;
  default: boolean;
}

const getChatApiBaseUrl = async (): Promise<string> => {
  try {
    const config = await configLoader.loadConfig();
    return config.apiUrl?.trim() || 'https://alcolock-test.lsystems.ru/';
  } catch (error) {
    console.error('Ошибка инициализации API URL:', error);
    return 'https://alcolock-test.lsystems.ru/';
  }
};

const getToken = (): string | null => {
  const token = localStorage.getItem('authToken') || sessionStorage.getItem('authToken');
  if (token) return token;

  const cookie = document.cookie
    .split('; ')
    .find((row) => row.startsWith('bearer=') || row.startsWith('Bearer='));
  return cookie ? cookie.split('=')[1] : null;
};

/** База из конфига может быть с /api или с /api/; пути вроде chat/... — без ведущего /. Иначе получается .../apichat/... */
const joinApiUrl = (base: string, path: string) => {
  const trimmedBase = base.replace(/\/+$/, '');
  const trimmedPath = path.replace(/^\/+/, '');
  return `${trimmedBase}/${trimmedPath}`;
};

const createRequest = async (url: string, options: RequestInit = {}, useCredentials = true) => {
  const currentApiUrl = await getChatApiBaseUrl();
  const token = getToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers as Record<string, string>),
  };

  const fetchOptions: RequestInit = {
    ...options,
    headers,
    mode: 'cors',
  };

  if (useCredentials) {
    fetchOptions.credentials = 'include';
  }

  try {
    const response = await fetch(joinApiUrl(currentApiUrl, url), fetchOptions);

    if (!response.ok) {
      if (response.status === 401) {
        const errorText = await response.text();
        throw new Error(`401 Unauthorized: ${errorText || 'Token may be expired'}`);
      }

      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return null;
    }

    return response.json();
  } catch (error) {
    console.error(`API request failed for ${url}:`, error);
    throw error;
  }
};

const request = (url: string, options: RequestInit = {}) => createRequest(url, options, true);
const simpleRequest = (url: string, options: RequestInit = {}) =>
  createRequest(url, options, false);

const generateFileHash = async (file: File): Promise<string> => {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const wordArray = CryptoJS.lib.WordArray.create(new Uint8Array(arrayBuffer));
    const hash = CryptoJS.MD5(wordArray);
    return CryptoJS.enc.Base64url.stringify(hash);
  } catch (error) {
    console.error('Ошибка при получении хэша файла:', error);
    throw error;
  }
};

const uploadAttachments = async (files: File[]): Promise<{ attachmentIds: string[] }> => {
  try {
    const operatorId = appStore.getState().authId;
    const { validFiles, invalidFiles } = await validateMultipleImages(files);

    if (invalidFiles.length > 0) {
      console.warn('Обнаружены невалидные файлы:');
      invalidFiles.forEach((invalid) => {
        console.warn(`- ${invalid.file.name}: ${invalid.reason}`);
      });

      if (validFiles.length === 0) {
        const errorMessages = invalidFiles.map((f) => `${f.file.name}: ${f.reason}`).join('\n');
        throw new Error(
          `Все файлы не прошли валидацию:\n${errorMessages}\n\n` +
            `Пожалуйста, убедитесь что файлы имеют правильный формат (JPG, PNG, BMP) и не превышают 1 МБ.`,
        );
      }

      console.warn(
        `Продолжаем загрузку только ${validFiles.length} валидных файлов из ${files.length}`,
      );
    }

    if (validFiles.length === 0) {
      throw new Error(
        'Не удалось загрузить ни одного файла. Проверьте форматы файлов (JPG, PNG, BMP).',
      );
    }

    const processedFiles = await processMultipleImages(validFiles);
    if (processedFiles.length === 0) {
      throw new Error('Не удалось обработать файлы для загрузки.');
    }

    const attachmentIds: string[] = [];

    for (const file of processedFiles) {
      try {
        const hash = await generateFileHash(file);
        const formData = new FormData();
        formData.append('hash', hash);
        formData.append('image', file);

        const response = await ChatsApi.addPhoto(formData, operatorId);

        if (response?.data?.[0]) {
          const firstImage = response.data[0] as PhotoResponseItem;
          attachmentIds.push(firstImage.fileName);
        } else if (response?.data === null) {
          console.warn(`Сервер вернул null data для файла ${file.name}`);
          continue;
        } else {
          console.warn(`Неожиданный формат ответа для файла ${file.name}:`, response);
          continue;
        }
      } catch (error: any) {
        console.error(`Ошибка загрузки файла ${file.name}:`, error);

        if (error.message?.includes('Не валидный формат фото')) {
          console.warn(`Пропускаем файл ${file.name}: недопустимый формат`);
          continue;
        }

        console.warn(`Пропускаем файл ${file.name} из-за ошибки:`, error.message);
        continue;
      }
    }

    if (attachmentIds.length === 0) {
      throw new Error('Не удалось загрузить ни одного файла.');
    }

    return { attachmentIds };
  } catch (error) {
    console.error('Attachments upload failed:', error);
    throw error;
  }
};

const uploadFile = async (
  file: File,
): Promise<{ id: string; type: string; name: string; size: number; url?: string }> => {
  const currentApiUrl = await getChatApiBaseUrl();
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(joinApiUrl(currentApiUrl, 'chat/upload'), {
    method: 'POST',
    body: formData,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
};

const getUserMessages = async (userId: number, page = 0, size = 20): Promise<any> => {
  try {
    const response = await DialogsApi.getMessages({ userId, page, size });
    return response?.data;
  } catch (error) {
    console.error('Ошибка загрузки сообщений пользователя:', error);
    throw error;
  }
};

const assignDialog = async (userId: string) => {
  const response = await DialogsApi.assignDialog(userId);
  return response?.data;
};

const completeDialog = async (dialogId: string) => {
  const response = await DialogsApi.completeDialog(dialogId);
  return response?.data;
};

const transferDialog = async (
  dialogId: string | number,
  operatorId: number,
  dialogStatus: string,
) => {
  const d = typeof dialogId === 'string' ? parseInt(dialogId, 10) : Number(dialogId);
  const o = Number(operatorId);
  const status = String(dialogStatus ?? '').trim() || 'ACTIVE';
  if (!Number.isFinite(d) || !Number.isFinite(o)) {
    throw new Error('transferDialog: invalid dialogId or operatorId');
  }
  const response = await DialogsApi.transferDialog({
    dialogId: d,
    operatorId: o,
    dialogStatus: status,
  });
  return response?.data;
};

const deleteDialog = async (dialogId: string) => {
  const response = await DialogsApi.deleteDialog(dialogId);
  return response?.data;
};

const getAllDialogs = async () => {
  const response = await DialogsApi.getAllDialogs();
  return response?.data;
};

const createDialog = async (dialogData: any) => {
  const response = await DialogsApi.createDialog(dialogData);
  return response?.data;
};

const getDialogById = async (dialogId: string) => {
  const response = await DialogsApi.getDialogById(dialogId);
  return response?.data;
};

const getDialogsCount = async () => {
  const response = await DialogsApi.getDialogsCount();
  return response?.data;
};

const getUnreadDialogs = async (): Promise<UnreadDialog[]> => {
  try {
    const response = await DialogsApi.getUnreadDialogs();
    return response?.data?.content || [];
  } catch (error) {
    return [];
  }
};

const getDialogDetails = async (dialogId: string): Promise<any> => {
  const response = await DialogsApi.getMessages({ dialogId });
  return response?.data;
};

const sendDeliveryConfirm = async (uuidMessage: string, status: 'DELIVERED' | 'READ') => {
  const message = { uuidMessage, status };
  return request('chat/delivery/confirm', {
    method: 'POST',
    body: JSON.stringify(message),
  });
};

const requestMessageStatus = async (messageUUIDs: string[]) => {
  return request('chat/request/confirm', {
    method: 'POST',
    body: JSON.stringify(messageUUIDs),
  });
};

const sendDeliveryConfirmWS = (
  stompClient: any,
  uuidMessage: string,
  status: 'DELIVERED' | 'READ',
): boolean => {
  if (!stompClient?.connected) return false;

  const message = { uuidMessage, status };
  stompClient.publish({
    destination: '/app/chat.delivery.confirm',
    body: JSON.stringify(message),
    headers: { 'content-type': 'application/json' },
  });
  // @stomp/stompjs Client.publish возвращает void; иначе вызывающий код считает отправку неудачной
  return true;
};

const requestMessageStatusWS = (stompClient: any, messageUUIDs: string[]) => {
  if (!stompClient?.connected) return false;

  stompClient.publish({
    destination: '/app/chat.request.confirm',
    body: JSON.stringify(messageUUIDs),
    headers: { 'content-type': 'application/json' },
  });
  return true;
};

const getDialogs = async (userId?: number) => {
  const url = userId ? `chat/dialogs?user_id=${userId}` : 'chat/dialogs';
  return request(url, { method: 'GET' });
};

const getMessages = async (dialogId: string) => {
  return request(`chat/messages/${dialogId}`, { method: 'GET' });
};

const getDialogInfo = async (dialogId: string): Promise<{ totalElements: number }> => {
  try {
    const response = await DialogsApi.getMessages({
      dialogId,
      page: 0,
      size: 1,
      sort: 'createdAt,asc',
    });

    const totalElements = response?.data?.totalElements || 0;
    return { totalElements };
  } catch (error) {
    console.error('Ошибка получения информации о диалоге:', error);
    return { totalElements: 0 };
  }
};

const getDialogMessagesWithPagination = async (
  dialogId: string,
  page = 0,
  size = 50,
  sort = 'createdAt,desc',
): Promise<any> => {
  try {
    const response = await DialogsApi.getMessages({ dialogId, page, size, sort });
    return response?.data || { content: [], totalElements: 0, pageable: { pageNumber: page } };
  } catch (error) {
    console.error('Ошибка получения сообщений с пагинацией:', error);
    throw error;
  }
};

const getFirstPageMessages = async (
  dialogId: string,
  size = 50,
  sort = 'createdAt,desc',
): Promise<any> => {
  try {
    const response = await DialogsApi.getMessages({ dialogId, page: 0, size, sort });
    return response?.data || { content: [], totalElements: 0, pageable: { pageNumber: 0 } };
  } catch (error) {
    console.error('Ошибка получения первой страницы сообщений:', error);
    throw error;
  }
};

const getMessagePositionInDialog = async (
  dialogId: string,
  messageCreatedAt: string,
  sort = 'createdAt,desc',
): Promise<number> => {
  try {
    const encodedDate = encodeURIComponent(messageCreatedAt);
    const url = `api/v1/messages/count?all.dialog.id.equals=${dialogId}&all.createdAt.greaterThan=${encodedDate}&sort=${sort}`;
    const response = await simpleRequest(url);
    return response || 0;
  } catch (error) {
    console.error('Ошибка получения позиции сообщения:', error);
    return 0;
  }
};

const getMessagePageByPosition = async (
  dialogId: string,
  messageCreatedAt: string,
  pageSize = 50,
  sort = 'createdAt,desc',
): Promise<{ page: number; messages: any[] }> => {
  try {
    const position = await getMessagePositionInDialog(dialogId, messageCreatedAt);
    if (position === 0) return { page: 0, messages: [] };

    const page = Math.floor(position / pageSize);
    const response = await getDialogMessagesWithPagination(dialogId, page, pageSize, sort);

    return { page, messages: response?.content || [] };
  } catch (error) {
    console.error('Ошибка получения страницы сообщения:', error);
    throw error;
  }
};

const getLastPageMessages = async (
  dialogId: string,
  pageSize = 50,
  sort = 'createdAt,asc',
): Promise<{
  content: any[];
  totalElements: number;
  currentPage: number;
  totalPages: number;
  isLastPage: boolean;
}> => {
  try {
    const info = await getDialogInfo(dialogId);
    const totalElements = info.totalElements;

    if (totalElements === 0) {
      return {
        content: [],
        totalElements: 0,
        currentPage: 0,
        totalPages: 0,
        isLastPage: true,
      };
    }

    const totalPages = Math.ceil(totalElements / pageSize);
    const lastPage = Math.max(0, totalPages - 1);

    if (lastPage === 0) {
      const response = await getDialogMessagesWithPagination(dialogId, 0, pageSize, sort);
      return {
        content: response?.content || [],
        totalElements,
        currentPage: 0,
        totalPages,
        isLastPage: true,
      };
    }

    const response = await getDialogMessagesWithPagination(dialogId, lastPage, pageSize, sort);
    return {
      content: response?.content || [],
      totalElements,
      currentPage: lastPage,
      totalPages,
      isLastPage: true,
    };
  } catch (error) {
    console.error('Ошибка получения последней страницы сообщений:', error);
    throw error;
  }
};

const loadPreviousPage = async (
  dialogId: string,
  currentPage: number,
  pageSize = 50,
  sort = 'createdAt,asc',
): Promise<{
  content: any[];
  currentPage: number;
  totalElements?: number;
  totalPages?: number;
}> => {
  try {
    if (currentPage <= 0) return { content: [], currentPage: 0 };

    const previousPage = currentPage - 1;
    const response = await getDialogMessagesWithPagination(dialogId, previousPage, pageSize, sort);

    return {
      content: response?.content || [],
      currentPage: previousPage,
      totalElements: response?.totalElements,
      totalPages: response?.totalPages,
    };
  } catch (error) {
    console.error('Ошибка загрузки предыдущей страницы:', error);
    throw error;
  }
};

const api = {
  assignDialog,
  completeDialog,
  transferDialog,
  deleteDialog,
  uploadAttachments,
  uploadFile,
  getAllDialogs,
  createDialog,
  getDialogById,
  getDialogsCount,
  getUnreadDialogs,
  getDialogDetails,
  getUserMessages,
  getDialogMessagesWithPagination,
  getDialogInfo,
  getLastPageMessages,
  loadPreviousPage,
  getFirstPageMessages,
  getMessagePositionInDialog,
  getMessagePageByPosition,
  sendDeliveryConfirm,
  requestMessageStatus,
  sendDeliveryConfirmWS,
  requestMessageStatusWS,
  request,
  simpleRequest,
  dialogs: getDialogs,
  messages: getMessages,
  read: (data: any) =>
    request('chat/read', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

export default api;
