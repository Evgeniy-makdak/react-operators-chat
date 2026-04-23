# Integration Quickstart

Use this guide to connect the reference chat widget to your own backend in minimal time.

## 1) Copy sources

Copy `reference/chat-widget/` into your host frontend project.

## 2) Provide host dependencies

The reference assumes host-level modules and state:

- `@shared/*` aliases
- app store values: `authId`, `selectedBranchState.id`, `permissions`
- i18n keys under `chat.*`

If your project differs, create a small adapter layer rather than editing core widget files first.

## 3) Configure runtime endpoints

Provide:

- `apiUrl` (HTTP base)
- `wsUrl` (full STOMP WebSocket endpoint, e.g. `wss://host/ws/websocket`)

JWT must be sent:

- as `Authorization: Bearer <token>` for HTTP
- as `?token=<url-encoded-token>` for WebSocket connection

## 4) Implement required backend routes

At minimum:

- Dialogs: `api/v1/dialogs/*`
- Messages: `api/v1/messages*`
- Confirmations: `chat/delivery/confirm`, `chat/request/confirm`
- STOMP subscriptions and `/app/chat.*` sends

See `README.md` for exact route list.

## 5) Verify transport behavior

Checklist:

- STOMP connect and subscriptions succeed
- Incoming message payloads map correctly in `SocketContext.tsx`
- Unread counters update on both branch and global channels
- Delivery/read confirmations are reflected in UI state

## 6) Production hardening

- Enforce upload size and MIME checks server-side
- Add retry/backoff policy for transient failures
- Monitor WebSocket disconnect reasons and auth expiry patterns
