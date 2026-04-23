# Contributing

Thanks for your interest in improving `react-operators-chat`.

## Scope

This repository is a documentation-first, reference implementation of the operator chat widget extracted from a larger production system.

Good contributions:
- Contract clarifications in `README.md`
- Bug fixes in `reference/chat-widget/`
- Portability improvements (fewer host-coupled assumptions)
- Better developer onboarding docs

## Workflow

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused and atomic.
3. Update docs when behavior or API expectations change.
4. Update `CHANGELOG.md` under `Unreleased`.
5. Open a Pull Request using the template.

## Commit style

- Use clear, imperative commit messages.
- Prefer "why" over "what".
- Example: `Improve unread sync handling for branch-scoped dialogs`

## Pull Request checklist

- [ ] Changes are scoped and easy to review
- [ ] README/contract docs updated if needed
- [ ] `CHANGELOG.md` updated
- [ ] No secrets or environment-specific values committed

## Code of conduct

Please keep communication respectful and constructive in all discussions and reviews.
