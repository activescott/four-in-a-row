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

With `DATABASE_URL` set, the app uses Postgres instead of PGlite. Health checks are at `/ops/health/liveness` (liveness) and `/ops/health/readiness` (readiness, with `db.size` in bytes).

## Sign-in

Sign-in uses [`@activescott/auth`](https://github.com/activescott/auth): an email link or code at `/login`, and passkeys added from `/profile`. Only an address that already has an account, has a pending invite, or is listed in `SIGNUP_EMAILS` is sent a sign-in email.

| Variable                                                          | Purpose                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `JWT_SECRET`                                                      | Signs session cookies. Required in production; dev uses a random one per run.              |
| `PASSKEY_CHALLENGE_SECRET`                                        | Signs passkey challenge cookies. Required in production.                                   |
| `APP_URL`                                                         | Canonical URL in production, which passkeys are bound to.                                  |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Outgoing mail. In dev without `SMTP_HOST`, the link is printed to the console.             |
| `FROM_EMAIL`                                                      | Sender address.                                                                            |
| `SIGNUP_EMAILS`                                                   | Addresses that may sign up without an invite, separated by commas or spaces.               |
| `E2E_TEST_MODE`                                                   | `true` captures sign-in mail instead of sending it. Never set in production.               |
| `E2E_CAPTURE_SECRET`                                              | Required with `E2E_TEST_MODE`; the `x-e2e-secret` header for `/e2e/captured-email?email=`. |

Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint with `@commitlint/config-conventional`.
