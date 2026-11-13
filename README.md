# Four in a Row

A browser game of four-in-a-row for two players. It runs in Safari on iPhone and in desktop browsers, with nothing to install. Players sign in with an email link or a passkey, start a game by inviting the other player by email, and take turns at their own pace. Four in a Row is a generic name: the app has no Hasbro branding.

- Requirements: [#1](https://github.com/activescott/four-in-a-row/issues/1)
- Design: [#2](https://github.com/activescott/four-in-a-row/issues/2)

## Development

```sh
npm ci
npx prisma generate   # writes the Prisma client to app/generated/
npm run dev           # PGlite database in ./pglite-data, migrated at startup
npm test              # each test file gets a fresh in-memory PGlite database
```

With `DATABASE_URL` set, the app uses Postgres instead of PGlite. Health checks are at `/healthz` (liveness) and `/readyz` (readiness, with `db.size` in bytes).

Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint with `@commitlint/config-conventional`.
