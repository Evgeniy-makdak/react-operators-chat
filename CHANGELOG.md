# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows semantic versioning where applicable.

## [Unreleased]

### Added
- `reference/chat-widget/components/TransferOperatorSelect.tsx` for dialog transfer UI.
- `reference/chat-widget/lib/operatorUnreadDebugLog.ts` for unread-state debug logging.
- Initial changelog file for tracking standalone sync history.
- `CONTRIBUTING.md`, `SECURITY.md`, and `ROADMAP.md` for stronger open-source onboarding.
- GitHub collaboration templates: bug report, feature request, and pull request template.
- `docs/ARCHITECTURE.md` with system and event-flow diagrams.
- `docs/INTEGRATION_QUICKSTART.md` for faster partner onboarding.
- `docs/CASE_STUDY.md` with problem/decisions/trade-offs/results format for technical review.
- `PORTFOLIO.md` and `CODE_OF_CONDUCT.md` for project presentation and community norms.
- Issue template config to route security and integration questions.

### Changed
- Synced `reference/chat-widget/` with the current monolith chat implementation.
- Updated core chat modules, including `ChatPanel`, `MessageFeed`, `ChatContext`, `SocketContext`, and related hooks/styles.
- Expanded `README.md` (RU + EN) with a "latest sync" summary section.
- Improved README positioning with quick start and hiring-manager oriented project highlights.
- Extended `package.json` metadata (homepage, issues URL, broader keywords).

## [1.0.0] - 2026-04-23

### Added
- Initial public release of the React operators chat reference package.
