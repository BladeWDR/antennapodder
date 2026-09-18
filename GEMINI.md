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
