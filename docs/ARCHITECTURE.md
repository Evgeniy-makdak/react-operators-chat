# Architecture Overview

This document describes the reference operator chat architecture and the expected backend contract.

## System context

- Frontend: React widget (`reference/chat-widget`)
- Transport: REST + STOMP over WebSocket
- Auth: Bearer JWT on HTTP and `?token=` on WebSocket connection
- Scope: Branch-aware routing (`branchId`) for dialogs and unread counters

## High-level flow

```mermaid
flowchart LR
  OP[Operator UI\nReact chat widget] -->|REST| API[Backend API]
  OP -->|WS + STOMP| WS[STOMP Broker Endpoint]
  WS --> API
  API --> DB[(Dialogs + Messages)]
  MOB[Mobile app / other client] --> API
  MOB -->|RT events| WS
```

## Event lifecycle (message send and confirmations)

```mermaid
sequenceDiagram
  participant O as Operator Widget
  participant B as Backend
  participant S as STOMP Broker
  participant U as User Client

  O->>B: POST message via REST / chat upload
  B-->>O: Persisted message payload
  B->>S: Publish MESSAGE event
  S-->>O: /topic/operator/messages/{branchId}
  S-->>U: /user/queue/messages (or mobile equivalent)
  O->>B: POST chat/delivery/confirm (DELIVERED/READ)
  O->>S: SEND /app/chat.delivery.confirm
  B-->>S: Update unread counters
  S-->>O: /queue/unread/{branchId}, /user/queue/unread
```

## Reference module boundaries

- `api.ts`, `api/dialogsApi.ts`: HTTP contract + query composition
- `contexts/SocketContext.tsx`: STOMP connect/reconnect, subscriptions, dispatch
- `contexts/ChatContext.tsx`: state orchestration, commands, side effects
- `components/*`: UI concerns (feed, input, transfer, selectors)
- `chatFooter/*`: permissions-aware controls and operator actions

## Key integration constraints

1. Keep payload semantics aligned with `SocketContext.tsx` parsing behavior.
2. Preserve branch scoping in REST filters and STOMP destinations.
3. Ensure delivery/read confirmations stay consistent across web and mobile clients.
4. Enforce attachment limits and content validation on backend side.

## Reliability notes

- Reconnect and idempotency matter more than visual latency in real-time operator tools.
- Unread counters should be treated as eventual-consistency signals, not single source of truth.
- Keep legacy endpoints available during migration if old clients still consume them.
