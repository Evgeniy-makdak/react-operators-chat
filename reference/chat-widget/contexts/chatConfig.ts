/* eslint-disable @typescript-eslint/no-explicit-any */

// Конфигурация чата
export const ChatConfig = {
  // Временный флаг для отключения пагинации сообщений
  // Когда true - пагинация отключена, загружаются все сообщения сразу
  // Когда false - работает обычная пагинация
  DISABLE_PAGINATION: false,

  // Дефолтные настройки пагинации
  DEFAULT_PAGE_SIZE: 50,

  // Дефолтный размер страницы для истории
  HISTORY_PAGE_SIZE: 50,

  // Интервал синхронизации истории при отключенной пагинации (мс)
  HISTORY_SYNC_INTERVAL: 2000,
};

// Тип для конфигурации
export type ChatConfigType = typeof ChatConfig;
