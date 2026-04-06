/* eslint-disable @typescript-eslint/no-explicit-any */

// Максимальный размер файла в байтах (1 МБ)
export const MAX_FILE_SIZE_BYTES = 1024 * 1024;
export const MAX_FILE_SIZE_MB = 1;

// Magic numbers для проверки реального типа файла (ТОЛЬКО JPG, PNG, BMP)
const MAGIC_NUMBERS: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/jpg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/bmp': [0x42, 0x4d],
  'image/x-ms-bmp': [0x42, 0x4d],
};

/**
 * Проверяет реальный тип файла по первым байтам (magic numbers)
 * @param file Файл для проверки
 * @returns Promise с реальным MIME-типом или null если не удалось определить
 */
export const checkFileMagicNumbers = async (file: File): Promise<string | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      const view = new Uint8Array(buffer.slice(0, 8)); // Берем первые 8 байт

      // Проверяем каждый известный тип (ТОЛЬКО JPG, PNG, BMP)
      for (const [mimeType, magic] of Object.entries(MAGIC_NUMBERS)) {
        const matches = magic.every((byte, index) => view[index] === byte);
        if (matches) {
          resolve(mimeType);
          return;
        }
      }

      resolve(null); // Неизвестный тип (не JPG, PNG, BMP)
    };

    reader.onerror = () => {
      resolve(null);
    };

    // Читаем только первые 8 байт
    reader.readAsArrayBuffer(file.slice(0, 8));
  });
};

/**
 * Проверяет, является ли файл валидным изображением по реальному типу (ТОЛЬКО JPG, PNG, BMP)
 * @param file Файл для проверки
 * @returns Promise<boolean> true если файл действительно является JPG, PNG или BMP
 */
export const validateImageFile = async (
  file: File,
): Promise<{ isValid: boolean; error?: string }> => {
  // 1. Проверяем расширение и MIME-тип из свойств файла (ТОЛЬКО JPG, PNG, BMP)
  const hasValidExtensionAndMime = isAllowedImageType(file);

  if (!hasValidExtensionAndMime) {
    const error = `Файл "${file.name}" имеет недопустимое расширение или MIME-тип: ${file.type}. Разрешены только JPG, PNG, BMP`;
    console.warn(`❌ ${error}`);
    return { isValid: false, error };
  }

  // 2. Проверяем реальный тип файла по magic numbers
  const realMimeType = await checkFileMagicNumbers(file);

  if (!realMimeType) {
    const error = `Не удалось определить реальный тип файла "${file.name}". Возможно, файл поврежден или не является изображением JPG/PNG/BMP`;
    console.warn(`❌ ${error}`);
    return { isValid: false, error };
  }

  // 3. Сравниваем заявленный тип и реальный (ТОЛЬКО JPG, PNG, BMP)
  const claimedMimeType = file.type.toLowerCase();

  // Допускаемые соответствия типов (ТОЛЬКО JPG, PNG, BMP)
  const mimeTypeMap: Record<string, string[]> = {
    'image/jpeg': ['image/jpeg', 'image/jpg'],
    'image/jpg': ['image/jpeg', 'image/jpg'],
    'image/png': ['image/png'],
    'image/bmp': ['image/bmp', 'image/x-ms-bmp'],
    'image/x-ms-bmp': ['image/bmp', 'image/x-ms-bmp'],
  };

  // Проверяем, соответствует ли реальный тип заявленному
  const allowedTypes = mimeTypeMap[realMimeType] || [];
  const isValid = allowedTypes.includes(claimedMimeType);

  if (!isValid) {
    const error = `Файл "${file.name}" имеет несоответствие типов: заявлен "${claimedMimeType}", а реальный "${realMimeType}". Разрешены только JPG, PNG, BMP`;
    console.warn(`❌ ${error}`);
    return { isValid: false, error };
  }

  // 4. Проверяем размер файла
  if (!checkFileSize(file)) {
    const error = `Файл "${file.name}" слишком большой: ${formatFileSize(file.size)}. Максимальный размер: ${MAX_FILE_SIZE_MB}MB`;
    console.warn(`❌ ${error}`);
    return { isValid: false, error };
  }

  return { isValid: true };
};

/**
 * Проверяет размер файла
 * @param file Файл для проверки
 * @returns true если файл не превышает лимит
 */
export const checkFileSize = (file: File): boolean => {
  const fileSizeMB = file.size / 1024 / 1024;
  return fileSizeMB <= MAX_FILE_SIZE_MB;
};

/**
 * Форматирует размер файла в читаемый вид
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Сжимает изображение с использованием Canvas
 * @param file Файл изображения
 * @param maxWidth Максимальная ширина
 * @param maxHeight Максимальная высота
 * @param quality Качество (0-1)
 * @returns Сжатый файл или null при ошибке
 */
export const compressImage = async (
  file: File,
  maxWidth: number = 1920,
  maxHeight: number = 1080,
  quality: number = 0.7,
): Promise<File | null> => {
  return new Promise((resolve) => {
    // Проверяем тип файла
    if (!file.type.startsWith('image/')) {
      console.warn('Файл не является изображением:', file.type);
      resolve(null);
      return;
    }

    const reader = new FileReader();

    reader.onload = (e) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          console.error('Не удалось получить контекст Canvas');
          resolve(null);
          return;
        }

        // Рассчитываем новые размеры с сохранением пропорций
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        // Устанавливаем размеры canvas
        canvas.width = width;
        canvas.height = height;

        // Очищаем canvas и рисуем изображение
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        // Конвертируем в blob
        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Создаем новый файл
              const compressedFile = new File(
                [blob],
                file.name.replace(/\.[^/.]+$/, '') + '_compressed.jpg',
                {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                },
              );

              resolve(compressedFile);
            } else {
              console.error('Не удалось создать blob из canvas');
              resolve(null);
            }
          },
          'image/jpeg',
          quality,
        );
      };

      img.onerror = () => {
        console.error('Ошибка загрузки изображения');
        resolve(null);
      };

      img.src = e.target?.result as string;
    };

    reader.onerror = () => {
      console.error('Ошибка чтения файла');
      resolve(null);
    };

    reader.readAsDataURL(file);
  });
};

/**
 * Создает превью изображения для отображения
 */
export const createImagePreview = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      resolve(e.target?.result as string);
    };

    reader.onerror = () => {
      reject(new Error('Ошибка создания превью'));
    };

    reader.readAsDataURL(file);
  });
};

/**
 * Проверяет тип файла (разрешены только изображения JPG, PNG, BMP)
 */
export const isAllowedImageType = (file: File): boolean => {
  // ТОЛЬКО JPG, PNG, BMP (как указано в требованиях)
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp', 'image/x-ms-bmp'];

  // Проверяем MIME-тип
  const mimeType = file.type.toLowerCase();

  // Также проверяем расширение файла для дополнительной безопасности
  const fileName = file.name.toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.bmp'];
  const hasValidExtension = allowedExtensions.some((ext) => fileName.endsWith(ext));

  // Файл считается валидным если проходит обе проверки
  return allowedTypes.includes(mimeType) && hasValidExtension;
};

/**
 * Основная функция обработки изображения перед отправкой
 */
export const processImageBeforeUpload = async (
  file: File,
  options: {
    maxSizeMB?: number;
    compressIfNeeded?: boolean;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  } = {},
): Promise<File | null> => {
  const {
    maxSizeMB = MAX_FILE_SIZE_MB,
    compressIfNeeded = true,
    maxWidth = 1920,
    maxHeight = 1080,
    quality = 0.7,
  } = options;

  const maxSizeBytes = maxSizeMB * 1024 * 1024;

  // 1. Проверяем файл по всем параметрам (ТОЛЬКО JPG, PNG, BMP)
  const validationResult = await validateImageFile(file);
  if (!validationResult.isValid) {
    console.warn(`❌ Файл "${file.name}" не прошел валидацию: ${validationResult.error}`);
    return null;
  }

  // 2. Проверяем размер файла
  if (file.size <= maxSizeBytes) {
    return file;
  }

  // 3. Если сжатие разрешено - сжимаем
  if (compressIfNeeded) {
    try {
      const compressedFile = await compressImage(file, maxWidth, maxHeight, quality);

      if (compressedFile) {
        // Проверяем размер после сжатия
        if (compressedFile.size <= maxSizeBytes) {
          return compressedFile;
        } else {
          console.warn(
            `❌ После сжатия размер все еще превышает лимит: ${formatFileSize(compressedFile.size)}`,
          );
          return null;
        }
      }
    } catch (error) {
      console.error('❌ Ошибка сжатия изображения:', error);
    }
  }

  // 4. Если сжатие не помогло или не разрешено
  console.error(`❌ Файл слишком большой и не может быть сжат: ${file.name}`);
  return null;
};

/**
 * Обрабатывает массив файлов
 */
export const processMultipleImages = async (files: File[], options?: any): Promise<File[]> => {
  const results = await Promise.all(files.map((file) => processImageBeforeUpload(file, options)));

  return results.filter((file): file is File => file !== null);
};

/**
 * Валидирует массив файлов перед загрузкой (ТОЛЬКО JPG, PNG, BMP)
 * @param files Массив файлов
 * @returns Promise с результатами валидации
 */
export const validateMultipleImages = async (
  files: File[],
): Promise<{
  validFiles: File[];
  invalidFiles: { file: File; reason: string }[];
}> => {
  const validationResults = await Promise.all(
    files.map(async (file) => {
      // Проверяем базовые свойства (ТОЛЬКО JPG, PNG, BMP)
      if (!isAllowedImageType(file)) {
        return {
          valid: false,
          file,
          reason: `Недопустимый тип файла: ${file.type}. Разрешены только JPG, PNG, BMP`,
        };
      }

      // Проверяем размер
      if (!checkFileSize(file)) {
        return {
          valid: false,
          file,
          reason: `Файл слишком большой: ${formatFileSize(file.size)}. Максимальный размер: ${MAX_FILE_SIZE_MB}MB`,
        };
      }

      // Проверяем magic numbers (ТОЛЬКО JPG, PNG, BMP)
      const realMimeType = await checkFileMagicNumbers(file);
      if (!realMimeType) {
        return {
          valid: false,
          file,
          reason:
            'Не удалось определить тип файла. Возможно, файл поврежден или не является изображением JPG/PNG/BMP',
        };
      }

      // Проверяем соответствие типов (ТОЛЬКО JPG, PNG, BMP)
      const claimedMimeType = file.type.toLowerCase();
      const allowedTypesForRealMime =
        {
          'image/jpeg': ['image/jpeg', 'image/jpg'],
          'image/jpg': ['image/jpeg', 'image/jpg'],
          'image/png': ['image/png'],
          'image/bmp': ['image/bmp', 'image/x-ms-bmp'],
          'image/x-ms-bmp': ['image/bmp', 'image/x-ms-bmp'],
        }[realMimeType] || [];

      if (!allowedTypesForRealMime.includes(claimedMimeType)) {
        return {
          valid: false,
          file,
          reason: `Несоответствие типов: файл имеет расширение "${claimedMimeType}", но реальный формат "${realMimeType}". Разрешены только JPG, PNG, BMP`,
        };
      }

      return { valid: true, file, reason: '' };
    }),
  );

  const validFiles: File[] = [];
  const invalidFiles: { file: File; reason: string }[] = [];

  validationResults.forEach((result) => {
    if (result.valid) {
      validFiles.push(result.file);
    } else {
      invalidFiles.push({ file: result.file, reason: result.reason });
    }
  });

  return { validFiles, invalidFiles };
};
