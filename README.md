# Four in a Row

A browser game of four-in-a-row for two players. It runs in Safari on iPhone and in desktop browsers, with nothing to install. Players sign in with an email link or a passkey, start a game by inviting the other player by email, and take turns at their own pace. Four in a Row is a generic name: the app has no Hasbro branding.

- Requirements: [#1](https://github.com/activescott/four-in-a-row/issues/1)
- Design: [#2](https://github.com/activescott/four-in-a-row/issues/2)

## Development

```sh
npm ci
npm run prisma -- generate   # writes the Prisma client to app/generated/
# Run other Prisma commands as `npm run prisma -- <args>`: it works from any
# subdirectory and keeps the CLI from calling checkpoint.prisma.io. A bare
# `prisma` run outside the repo root skips prisma.config.mts and does call it.
npm run dev                  # PGlite database in ./pglite-data, migrated at startup
npm test              # each test file gets a fresh in-memory PGlite database
```

To start a game, sign in and enter the other player's email under "New game" on `/games`. In dev without `SMTP_HOST`, the invite link is printed to the console. To skip the invite, stop the dev server and seed two players and a game between them, then sign in as each player (in two browsers) and open `/games`:

```sh
node scripts/seed-game.mts first@example.com second@example.com
```

The end-to-end test (`e2e/full-game.spec.mts`) signs two players in by email link, has one invite the other, and plays a game to a win, in mobile WebKit (iPhone 13), desktop Chromium and desktop Firefox. Playwright starts the production build with `E2E_TEST_MODE` behind a local TLS proxy (`e2e/tls-proxy.mts`, which needs `openssl`), so build first:

```sh
npm run build
npx playwright install --with-deps   # once
npx playwright test                  # or --project=desktop-chromium
```

With `DATABASE_URL` set, the app uses Postgres instead of PGlite. Health checks are at `/ops/health/liveness` (liveness) and `/ops/health/readiness` (readiness, with `db.size` in bytes).

## Deploy and migrations

The Dockerfile has two targets. The default target is the app: production dependencies only, with no Prisma CLI, and it starts with `node server.mjs` without touching the schema. The `migrate` target holds the Prisma CLI, `prisma/` and `prisma.config.mts`, and runs `prisma migrate deploy`. Release publishes both images with the same version tag (`four-in-a-row` and `four-in-a-row-migrate`). Run the migrate image as an init container of the app pod, with the same `DATABASE_URL`, so every pod start applies pending migrations (a no-op when there are none) before the app boots. CI fails if `@prisma/studio-core` or the `prisma` CLI is back in the app image.

## Sign-in

Sign-in uses [`@activescott/auth`](https://github.com/activescott/auth): an email link or code at `/login`, and passkeys added from `/profile`. Anyone can sign up: a never-seen address that enters its email at `/login` is sent a sign-in email, and a verified sign-in creates the account. To keep the app from becoming a way to mail strangers, every sign-in, invite and turn email is checked against send limits and recorded in the `email_sends` table (limits in `app/mail/send-limits.server.ts`):

| Limit                                          | Value      | Mail it counts                                                              |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------------- |
| Per address, sign-in                           | 5 an hour  | Sign-in, including the "link" email                                         |
| Per address and client IP, sign-in             | 10 a day   | Sign-in, including the "link" email                                         |
| Per inbox (bucket key), sign-in, any client    | 24 a day   | Sign-in, every `+tag`, Gmail dot variant, `googlemail.com` and IDN spelling |
| Per address, invite                            | 2 a day    | Invites to that address                                                     |
| Per address, turn                              | 10 an hour | "Your turn" mail, its own bucket                                            |
| Per client IP, to any address                  | 30 an hour | Sign-in                                                                     |
| Per client IP, to addresses without an account | 10 a day   | Sign-in and invite                                                          |
| Site-wide, to addresses without an account     | 100 a day  | Sign-in and invite                                                          |

The auth library applies its own limits to `/login` first, kept in memory by each server process (a restart clears them) in fixed windows: **6 an hour and 24 a day per address, from any client**, and **3 a minute and 10 an hour per client IP**, to any address. So the limits that bind in practice are the library's 10 an hour per client and the app's 5 an hour per address, and the app's 30-an-hour cap only applies beyond them: after a restart, behind a second replica, or for requests without a client IP, which the library doesn't count per client. The library lowercases an address but doesn't strip a `+tag`, so it counts `name+1@x` and `name+2@x` apart, each with its own 6 an hour and 24 a day; the app's limits don't. So the most one inbox is sent is **24 sign-in emails a day** (the app's per-inbox daily cap, counted across every `+tag`, Gmail dot variant, `googlemail.com` spelling, quoted spelling and client), however many tags and IPs are used. That holds because addresses with a comment, an escape or a partly quoted local part (`victim(1)@x`, `"v\ictim"@x`, `"vic".tim@x`) are refused, so the address that is counted is the one the mail goes to. The library's counters are in memory, so they reset on a restart and aren't shared between replicas; the app's are in Postgres and don't.

Each kind has its own per-address bucket, so invites and turn mail can't use up a player's sign-in quota. Addresses are counted by a bucket key: lowercased, with a `+tag` removed from the part before the `@`, and for `gmail.com` and `googlemail.com` with dots removed too, so `name+1@gmail.com`, `n.a.m.e@gmail.com` and `name@gmail.com` share one bucket. Domains are keyed in their ASCII (punycode) form after NFKC, so `bücher.de`, `xn--bcher-kva.de` and `bücher。de` share a bucket. Dots are only folded for Gmail; elsewhere `n.a.m.e@x` and `name@x` are different inboxes. Sign-in, invites and every other send refuse an address that contains `(`, `)`, `\`, whitespace, `<>,;:[]`, or a `"` that isn't the whole local part, with the form's invalid-email message, so the mail goes to the address as typed and that is the string that was counted. The app's daily per-address cap counts only sends from the same client IP, so a stranger's requests can't use up the owner's day; the hourly cap counts every client. Because of that, someone who knows an address can keep email sign-in from it for an hour at a time (the app's 5 an hour, the library's 6), or for the rest of the day by using up the library's 24 a day. The app's own per-inbox cap counts sign-in sends in a rolling 24 hours, across every `+tag` alias, `googlemail.com`/`gmail.com` spelling and client. Once 24 have been sent, email sign-in to that inbox is refused until the oldest of them is 24 hours old, then a slot frees up for each send as it ages out. So 24 requests spread over about 5 hours (within the hourly caps) block the inbox for up to 24 hours, and more requests keep it blocked. The count is in Postgres, so a restart or a second replica doesn't clear it; only time does. Refused requests aren't counted, so they don't extend it. Passkey sign-in is unaffected, since it sends no email.

**Guessing a code.** Each emailed code allows 3 tries (`otp.maxAttempts` in `app/auth.server.ts`); the 4th is refused even if it is right, with "Too many tries with that code. Ask for a new one." (the app's own wording for the library's `RATE_LIMITED`). A try needs a challenge, and a challenge needs a request the library's per-address limit let through, so guesses are capped at 6 × 3 = 18 an hour and 72 a day per address, from any number of clients. A request the library refuses creates no challenge at all. One the app's own send limits refuse (after the library) still creates one, but with its 3-try cap and the same per-address request budget.

Over a limit, nothing is sent and the form gives the same answer as for a sent email, so it still says "sent" and the owner of the address gets no email, which is what keeps the form from telling which addresses have an account. The app logs `email.limit` with the reason (`address`, `ip`, `global` or `error`; `global` and `error` at error level) and the client's key, never the address. A database error while checking is a refusal, answered the same. Every send that isn't turn mail does the same database work whatever the address and verdict, and invite and sign-in emails are sent in the background, so how long a request takes doesn't say which addresses have an account. So the form never says which addresses have an account. The client IP is the last `X-Forwarded-For` hop, the one Traefik appends, as for the auth library's own rate limits; a request without one is counted in a shared bucket and logs `email.limit.no_ip`. Rows older than 2 days are deleted by a prune that runs at server start, then every day, and on about 1 send in 20. A send waits up to 10 s for a database connection and may run for 15 s, so a burst queued on the site-wide lock isn't refused for waiting; if it still is, that is logged as `email.limit` with reason `error`.

## Invites

"New game" emails the other player a link to `/invite/:token`. The token is random, works once, expires after 7 days and is tied to the game and the inviter. It is not a sign-in credential: the invite page starts the normal email sign-in for the invited address in the invitee's own browser, showing the address only masked, which returns to `/invite/:gameId` and seats them. Each player can have at most 5 invites pending, one per address, and the response never says whether the address already has an account. If the relay times out but delivers the email anyway, the app has already deleted the game, so the link shows not found; that is accepted, and the invitee can be invited again. After each move, the player whose turn it is gets a "your turn" email unless they have the board open.

## Environment variables

The app reads these variables.

| Variable                                                          | Purpose                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `JWT_SECRET`                                                      | Signs session cookies. Required in production; dev uses a random one per run.              |
| `PASSKEY_CHALLENGE_SECRET`                                        | Signs passkey challenge cookies. Required in production.                                   |
| `APP_URL`                                                         | Canonical URL for passkeys and email links. Required in production.                        |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | Outgoing mail. In dev without `SMTP_HOST`, the link is printed to the console.             |
| `FROM_EMAIL`                                                      | Sender address.                                                                            |
| `E2E_TEST_MODE`                                                   | `true` captures all mail instead of sending it. Never set in production.                   |
| `E2E_CAPTURE_SECRET`                                              | Required with `E2E_TEST_MODE`; the `x-e2e-secret` header for `/e2e/captured-email?email=`. |

Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint with `@commitlint/config-conventional`.
