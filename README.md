# DevField Web

Next.js 16 App Router / TypeScript Web BFF for DevField authentication. Email signup, verification, login, server-side session checks, logout, and OAuth handoff routes are implemented. Provider buttons remain unavailable until credentials and actual provider browser flows are verified.

## Local run

1. npm ci
2. npm run typecheck
3. npm run build
4. npm run dev
5. GET http://localhost:13000/api/health
6. With the Web dev server running, run `npm run test:bff` for Origin, CSRF, request-size, and anonymous-session HTTP checks.

Stop with Ctrl+C. Keep service credentials in ignored local environment variables; never put them in NEXT_PUBLIC_ variables or browser responses.

For local Auth integration, open Web at `http://localhost:13000` and Auth at `http://127.0.0.1:18080`. The separate hostnames keep the Web session cookie off browser navigations to Auth. Copy `.env.example` to an ignored `.env.local` and load the Auth BFF raw key into `DEVFIELD_BFF_SERVICE_KEY` without printing or committing it. Keep `WEB_ENABLED_OAUTH_PROVIDERS` empty until the corresponding provider credentials and real browser flow have been verified. The email verification URL in Auth must be `http://localhost:13000/verify-email`.
