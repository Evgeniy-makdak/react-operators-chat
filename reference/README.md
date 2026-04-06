# Reference UI snapshot (`chat-widget/`)

This tree is a **verbatim copy** of the operator chat module from the parent monolith (`src/widgets/chat`). It is **not** a standalone npm build by itself: imports still point to the host application (`@shared/...`, `@widgets/chat/...`, `../../../config/...`, `../../../i18n`, etc.).

Use it to:

- diff or port the UI into your product;
- align your backend with the contracts described in the root **README.md** (REST + STOMP).

To compile inside **another** repo you must provide path aliases or refactor imports to your HTTP client, store, i18n, and config loader.
