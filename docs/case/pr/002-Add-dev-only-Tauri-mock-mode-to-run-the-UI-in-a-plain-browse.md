# #2 Add dev-only Tauri mock mode to run the UI in a plain browser

- Статус: слит, 2026-10-09
- Ветка: `claude/nice-archimedes-g7iicd` → `aid`
- Автор: katanana23
- Исходная ссылка: https://github.com/katanana23/shade/pull/2

## Описание

pnpm dev now opens the full interface without Tauri or Rust. A mock layer built on @tauri-apps/api/mocks intercepts every invoke and event; call sites in components are unchanged.

- frontend/src/dev/mock-tauri: mockIPC/mockWindows setup, handlers for all 149 commands the UI invokes plus store/os/app/path/updater/ process/notification plugins, an in-memory "core" (meetings, summary generation, recording with pause/resume/stop, model downloads)
- Scenarios via ?mock=empty|full|long|recording|error|onboarding with a small floating switcher; error scenario fails commands like the real core, and api_get_auto_generate_setting / builtin_ai_get_models_directory always fail with "command ... not found" as they do in the app
- Fixtures are fully fictional; all 6 summary templates covered
- Enabled only when NODE_ENV=development and window.__TAURI_INTERNALS__ is absent; production build verified to contain no mock code
- Works around an unlisten bug in @tauri-apps/api/mocks 2.11
- docs/case/mock.md (Russian): how to run, add scenarios and fixtures, what is and is not mocked


Claude-Session: https://claude.ai/code/session_01Thg41V2vt9d7prAr41Np8m

## Description
[Provide a detailed description of your changes]

## Related Issue
[Link to the issue this PR addresses (e.g., "Fixes #123")]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring
- [ ] Other (please describe)

## Testing
- [ ] Unit tests added/updated
- [ ] Manual testing performed
- [ ] All tests pass

## Documentation
- [ ] Documentation updated
- [ ] No documentation needed

## Checklist
- [ ] Code follows project style
- [ ] Self-reviewed the code
- [ ] Added comments for complex code
- [ ] Updated README if needed
- [ ] Branch is up to date with devtest
- [ ] No merge conflicts

## Screenshots (if applicable)
[Add screenshots here if your changes affect the UI]

## Additional Notes
[Add any additional information that might be helpful for reviewers] 
