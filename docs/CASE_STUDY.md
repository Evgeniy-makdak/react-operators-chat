# Case Study: Extracting and Hardening a Real-Time Operator Chat

## Context

The operator chat started as part of a larger monolith.  
The goal was to turn it into a standalone, reusable reference that external teams can integrate with their own backend.

## Problem

Teams integrating real-time chats often hit the same issues:

- Contract mismatch between frontend and backend (REST vs STOMP payloads)
- Unclear ownership of delivery/read semantics
- Weak documentation around branch-scoped routing and unread counters
- High onboarding cost for new developers

For hiring/technical review, this also creates a portfolio problem: impactful engineering work is hidden inside a monolith and hard to evaluate independently.

## Goals

1. Make integration behavior explicit and reproducible.
2. Preserve production-grade operator workflows (assign, transfer, complete).
3. Keep architecture understandable for both engineers and hiring teams.
4. Improve maintainability and external contribution readiness.

## Technical decisions

### 1) Contract-first documentation

- Documented concrete REST endpoints and STOMP destinations.
- Added integration and architecture guides (`docs/INTEGRATION_QUICKSTART.md`, `docs/ARCHITECTURE.md`).
- Kept payload expectations aligned with reference parsing logic in `SocketContext.tsx`.

Why: clear contracts reduce cross-team friction more than code comments alone.

### 2) Branch-scoped real-time model

- Explicit branch-aware channels (`/topic/operator/messages/{branchId}`, `/queue/unread/{branchId}`).
- Separate user-level channels for global counters and personal message queues.

Why: this maps naturally to operational teams where routing and visibility are branch-dependent.

### 3) Reliability over novelty

- Delivery/read confirmations are treated as first-class flows.
- Debug visibility added for unread-state investigation (`operatorUnreadDebugLog`).
- Migration path keeps legacy endpoints documented to avoid breaking older clients.

Why: operations tooling values correctness and traceability over flashy UX.

### 4) Public repo as engineering product

- Added `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, `CODE_OF_CONDUCT.md`.
- Added issue/PR templates and metadata for discoverability.
- Added `PORTFOLIO.md` to make engineering impact scannable in minutes.

Why: repository quality is part of product quality when working with external integrators.

## Trade-offs

- **Token in WebSocket query** is pragmatic and widely compatible, but requires careful security posture and infrastructure controls.
- **Reference-first packaging** speeds adoption now, while delaying fully abstracted npm package ergonomics.
- **Backward-compatible contract notes** increase documentation size, but significantly reduce migration risk.

## Outcomes

- Standalone reference now mirrors current monolith behavior.
- Integration entry barrier is reduced via quickstart + architecture + contract docs.
- Repository is structured for external trust and collaboration.
- Maintainer impact is visible for technical screening and hiring review.

## What I would do next

1. Publish a minimal runnable demo with mocked backend and scripted STOMP events.
2. Add architecture decision records (ADRs) for major protocol and state decisions.
3. Define SLO-style runtime metrics for unread-sync correctness and reconnect stability.

## Hiring summary (30-second read)

This work demonstrates practical frontend leadership in real-time systems:

- Designing and documenting API contracts
- Building resilient UI behavior around asynchronous transports
- Managing migration from monolith internals to reusable external references
- Turning implementation details into a maintainable and collaboration-ready engineering asset
