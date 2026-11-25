# Project Guidelines & Context

## Communication Style
- Be concise and direct.
- Do not use excessive emojis.
- Do not use emdashes.

## Architecture & Dependencies
- Minimal dependencies is a core design goal. Avoid adding external libraries for simple tasks that standard Node.js or browser APIs can accomplish.
- Libraries and packages may be used when clearly justified, but require careful evaluation.
- Backend: Vanilla Node.js HTTP server and standard libraries. Native ES Modules (`type: "module"`).
- Database: SQLite via `better-sqlite3`. Always use parameterized queries. Ensure optional bound values are `null`, never `undefined`.
- Frontend: Vanilla modern JavaScript, HTML5, and CSS3 without build tools or bundlers.

## Verification & Testing
- Always verify changes by running `npm test` before committing.
- Ensure test suites remain fast, isolated, and deterministic.

## Git & Commit Hygiene
- Keep commits focused and atomic.
- Follow the Conventional Commits specification (e.g., `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`).
- Write clear, descriptive commit messages in the imperative mood without a trailing period.

## 6. Lessons Learned & User Corrections

Whenever the user corrects an agent or provides guidance on workflows, conventions, or design decisions, document it here immediately so future agents adhere to it.

### Never use `git reset --hard` (or any destructive git command) when the working tree has uncommitted user work

- 2026-11-25: To undo a version-bump commit, ran `git reset --hard <pre-bump-commit>`. That destroyed the user's uncommitted style changes (player-bar links, vertical title/podcast layout) because they existed only in the working tree, not in any commit. They had to be reconstructed by hand.
- Rule: When undoing a commit, default to `git reset --soft HEAD~1` (keeps working tree + index) or `git reset --mixed HEAD~1` (keeps working tree). Only ever consider `--hard` after explicitly confirming with the user that discarding working-tree changes is intended.
- Rule: Before any destructive git command, run `git status` and stop if the working tree is dirty. Ask the user how to handle uncommitted changes first.
- Rule: After an undo/revert commit, verify the actual result (e.g. `git show HEAD:file`) rather than trusting a diff summary, which can be misleading.
