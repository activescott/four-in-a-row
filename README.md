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

To start a game, sign in and enter the other player's email under "New game" on `/games`. In dev without `SMTP_HOST`, the invite link is printed to the console. To skip the invite, stop the dev server and seed two players and a game between them, then sign in as each player (in two browsers) and open `/games`:

```sh
node scripts/seed-game.mts first@example.com second@example.com
```

With `DATABASE_URL` set, the app uses Postgres instead of PGlite. Health checks are at `/ops/health/liveness` (liveness) and `/ops/health/readiness` (readiness, with `db.size` in bytes).

## Sign-in

Sign-in uses [`@activescott/auth`](https://github.com/activescott/auth): an email link or code at `/login`, and passkeys added from `/profile`. Only an address that already has an account, has a pending invite, or is listed in `SIGNUP_EMAILS` is sent a sign-in email; every other address gets the same answer, so the form never says which addresses can sign in. The library still stores a code for that address, so a correct guess reaches verify, where the gate refuses to create the account and deletes the row the verify made.

## Invites

"New game" emails the other player a link to `/invite/:token`. The token is random, works once, expires after 7 days and is tied to the game and the inviter. It is not a sign-in credential: the invite page starts the normal email sign-in for the invited address in the invitee's own browser, showing the address only masked, which returns to `/invite/:gameId` and seats them. Each player can have at most 5 invites pending, one per address, and the response never says whether the address already has an account. After each move, the player whose turn it is gets a "your turn" email unless they have the board open.

| Variable                                                          | Purpose                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `JWT_SECRET`                                                      | Signs session cookies. Required in production; dev uses a random one per run.              |
| `PASSKEY_CHALLENGE_SECRET`                                        | Signs passkey challenge cookies. Required in production.                                   |
| `APP_URL`                                                         | Canonical URL for passkeys and email links. Required in production.                        |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Outgoing mail. In dev without `SMTP_HOST`, the link is printed to the console.             |
| `FROM_EMAIL`                                                      | Sender address.                                                                            |
| `SIGNUP_EMAILS`                                                   | Addresses that may sign up without an invite, separated by commas or spaces.               |
| `E2E_TEST_MODE`                                                   | `true` captures all mail instead of sending it. Never set in production.                   |
| `E2E_CAPTURE_SECRET`                                              | Required with `E2E_TEST_MODE`; the `x-e2e-secret` header for `/e2e/captured-email?email=`. |

Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint with `@commitlint/config-conventional`.
