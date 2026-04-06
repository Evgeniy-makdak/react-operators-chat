/**
 * Диагностика WebSocket/STOMP чата.
 * 1) Рантайм: в public/config.json поле "chatStompDebug": true (или строка "true").
 * 2) Сборка: REACT_APP_CHAT_STOMP_DEBUG=true (если используете .env).
 * 3) В development логи включены всегда (если рантайм явно не выключил — см. ниже).
 */

/** null = не задано в config.json, использовать только env / development */
let stompDebugRuntime: boolean | null = null;

/** Вызывается после загрузки config.json (ConfigLoader). false — принудительно выключить даже в dev. */
export function setStompDebugFromRuntimeConfig(value: unknown): void {
  if (value === true || value === 'true' || value === '1') {
    stompDebugRuntime = true;
    return;
  }
  if (value === false || value === 'false' || value === '0') {
    stompDebugRuntime = false;
    return;
  }
  stompDebugRuntime = null;
}

export function isStompDebugEnabled(): boolean {
  if (stompDebugRuntime === false) return false;
  if (stompDebugRuntime === true) return true;
  if (typeof process === 'undefined') return false;
  return (
    process.env.NODE_ENV === 'development' || process.env.REACT_APP_CHAT_STOMP_DEBUG === 'true'
  );
}

/** URL с query token → token=*** (не светить JWT в консоли) */
export function stompDebugMaskWsUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('token')) {
      u.searchParams.set('token', '***');
    }
    return u.toString();
  } catch {
    return '[Chat/STOMP invalid URL]';
  }
}

export function websocketReadyStateLabel(rs: number | undefined): string {
  if (rs === undefined) return 'NO_SOCKET';
  return ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][rs] ?? `UNKNOWN(${rs})`;
}

export function stompDebugLog(phase: string, payload?: Record<string, unknown>): void {
  if (!isStompDebugEnabled()) return;
  const line = `[Chat/STOMP] ${new Date().toISOString()} ${phase}`;
  if (payload !== undefined && Object.keys(payload).length > 0) {
    // eslint-disable-next-line no-console
    console.log(line, payload);
  } else {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}
