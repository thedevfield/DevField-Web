# DevField Web

Next.js 16 App Router / TypeScript Phase 1 scaffold for a future thin BFF. No login, OAuth, JWT, Cookie or backend proxy is implemented yet.

## Local run

1. npm ci
2. npm run typecheck
3. npm run build
4. npm run dev
5. GET http://localhost:13000/api/health

Stop with Ctrl+C. Keep service credentials in ignored local environment variables; never put them in NEXT_PUBLIC_ variables or browser responses.
