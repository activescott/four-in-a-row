import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client";
import { createPgliteDb } from "../pglite.server";
import { CookieJar } from "../test/cookie-jar";
import { formPost, get, logCapture, run } from "../test/routes";

// The invite flow through the routes: A invites B from the game list, B
// opens the emailed /invite/:token link signed out, signs in by email from
// that page, and lands in the game. Env comes from vitest.config.mts
// (E2E_TEST_MODE=true, so mail is captured).

const { getDb, log } = vi.hoisted(() => ({
  getDb: vi.fn<() => Promise<PrismaClient>>(),
  log: { capture: undefined as unknown as ReturnType<typeof logCapture> },
}));
vi.mock("../db.server", () => ({ getDb }));
vi.mock("../logger.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../logger.server")>();
  const { logCapture } = await import("../test/routes");
  log.capture = logCapture();
  return {
    ...original,
    logger: original.createLogger(log.capture.destination),
  };
});

const db = await createPgliteDb();
getDb.mockResolvedValue(db);

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(() => {
  log.capture.lines.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

const E2E_SECRET = { "x-e2e-secret": "test-only-e2e-capture-secret" };

const { auth } = await import("../auth.server");
const { captureMailer } = await import("../mail/mailer.server");
const { INVITE_TTL_MS } = await import("../game/invites.server");
const authRoute = await import("./auth.$provider.$action");
const capturedEmail = await import("./e2e.captured-email");
const games = await import("./games");
const invite = await import("./invite.$key");
const moves = await import("./games.$id.moves");
const state = await import("./games.$id.state");

type Player = { id: string; email: string; cookie: string };

let seq = 0;
const address = (name: string) => `${name}-${++seq}@example.com`;

// An existing account with a session cookie.
async function player(name: string): Promise<Player> {
  const email = address(name);
  const user = await db.user.create({
    data: {
      email,
      identities: {
        create: { provider: "email", identifier: email, metadata: {} },
      },
    },
    include: { identities: true },
  });
  const identity = user.identities[0]!;
  const setCookie = await auth.createSessionCookie(
    { id: user.id, metadata: { email, createdAt: user.createdAt } },
    {
      id: identity.id,
      userId: user.id,
      provider: "email",
      identifier: email,
      providerState: {},
      createdAt: identity.createdAt,
    },
  );
  return { id: user.id, email, cookie: setCookie.split(";")[0]! };
}

async function authRequest(request: Request) {
  const [, , provider, action] = new URL(request.url).pathname.split("/");
  const handler =
    request.method === "GET" ? authRoute.loader : authRoute.action;
  return (await run(handler, request, { provider, action })) as Response;
}

// A's "New game" form on /games.
async function sendInvite(from: Player, email: string) {
  return (await run(
    games.action,
    formPost("/games", { email }, { cookie: from.cookie, referer: "/games" }),
  )) as Response;
}

function inviteToken(email: string) {
  const link = captureMailer!.last(email, "invite")!.link;
  return new URL(link).pathname.split("/")[2]!;
}

async function openInvite(key: string, cookie = "", query = "") {
  return run(invite.loader, get(`/invite/${key}${query}`, { cookie }), {
    key,
  });
}

// Status and body of a loader result: a Response, data() or plain data.
async function reply(result: unknown) {
  if (result instanceof Response) {
    return {
      status: result.status,
      location: result.headers.get("location"),
      body: await result.text(),
    };
  }
  if (result && typeof result === "object" && "init" in result) {
    const { init, data } = result as {
      init?: { status?: number };
      data: unknown;
    };
    return { status: init?.status ?? 200, body: data };
  }
  return { status: 200, body: result };
}

// B signs in from the invite page: the page's form posts to the normal
// /auth/email/initiate, then B opens the sign-in link from that email.
async function signInFromInvitePage(
  jar: CookieJar,
  email: string,
  token: string,
) {
  const page = (await reply(await openInvite(token, jar.header()))).body as {
    email: string;
    redirectTo: string;
  };
  const sent = await authRequest(
    formPost(
      "/auth/email/initiate",
      { email: page.email, redirectTo: page.redirectTo },
      { cookie: jar.header(), referer: `/invite/${token}` },
    ),
  );
  jar.store(sent);
  expect(sent.status).toBe(302);
  expect(sent.headers.get("location")).toContain(`/invite/${token}?sent=1`);

  const captured = (await run(
    capturedEmail.loader,
    get(`/e2e/captured-email?email=${encodeURIComponent(email)}`, E2E_SECRET),
  )) as Response;
  const { magicLink } = await captured.json();
  const link = new URL(magicLink);
  const confirm = await authRequest(
    get(link.pathname + link.search, { cookie: jar.header() }),
  );
  const action = (await confirm.text())
    .match(/<form method="post" action="([^"]*)"/)![1]!
    .replaceAll("&amp;", "&");
  const verified = await authRequest(
    formPost(
      `/auth/email/verify${action}`,
      {
        challenge: link.searchParams.get("challenge")!,
        key: link.searchParams.get("key")!,
      },
      { cookie: jar.header(), referer: link.pathname + link.search },
    ),
  );
  jar.store(verified);
  return verified;
}

async function move(as: { cookie: string }, gameId: string, column: number) {
  const game = await db.game.findUniqueOrThrow({ where: { id: gameId } });
  return (await run(
    moves.action,
    formPost(
      `/games/${gameId}/moves`,
      { column: String(column), expectedMoveCount: String(game.moveCount) },
      { cookie: as.cookie, referer: `/games/${gameId}` },
    ),
    { id: gameId },
  )) as unknown;
}

test("A invites B by email; B signs up from the link, lands in the game, and both play", async () => {
  const alice = await player("alice");
  const bob = address("bob");

  const sent = await sendInvite(alice, bob);
  expect(sent.status).toBe(302);
  const gameId = sent.headers.get("location")!.split("/").at(-1)!;
  expect(sent.headers.get("location")).toBe(`/games/${gameId}`);
  const token = inviteToken(bob);
  expect(captureMailer!.last(bob, "invite")!.link).toBe(
    `http://localhost/invite/${token}`,
  );

  // Signed out, the invite page offers an email sign-in for B's address
  // that comes back to /invite/:gameId.
  const jar = new CookieJar();
  expect(await reply(await openInvite(token))).toMatchObject({
    status: 200,
    body: {
      state: "pending",
      inviter: alice.email.split("@")[0],
      email: bob,
      redirectTo: `/invite/${gameId}`,
      sent: false,
    },
  });

  const signedIn = await signInFromInvitePage(jar, bob, token);
  expect(signedIn.status).toBe(302);
  expect(signedIn.headers.get("location")).toBe(`/invite/${gameId}`);

  const accepted = await reply(await openInvite(gameId, jar.header()));
  expect(accepted).toMatchObject({
    status: 302,
    location: `/games/${gameId}`,
  });
  const bobUser = await db.user.findUniqueOrThrow({ where: { email: bob } });
  expect(
    await db.game.findUniqueOrThrow({ where: { id: gameId } }),
  ).toMatchObject({
    status: "ACTIVE",
    playerTwoId: bobUser.id,
    nextPlayerId: alice.id,
  });

  // A's open board sees B join without a move.
  const poll = await reply(
    await run(
      state.loader,
      get(`/games/${gameId}/state?since=0&status=INVITED`, {
        cookie: alice.cookie,
      }),
      { id: gameId },
    ),
  );
  expect(JSON.parse(poll.body as string)).toMatchObject({
    unchanged: false,
    status: "ACTIVE",
    yourTurn: true,
  });

  // One move each.
  await move(alice, gameId, 3);
  await move({ cookie: jar.header() }, gameId, 4);
  expect(
    await db.move.findMany({
      where: { gameId },
      orderBy: { number: "asc" },
      select: { playerId: true, column: true },
    }),
  ).toEqual([
    { playerId: alice.id, column: 3 },
    { playerId: bobUser.id, column: 4 },
  ]);
});

test("an invitee who is already signed in is seated straight from the link", async () => {
  const alice = await player("alice");
  const bob = await player("bob");
  const sent = await sendInvite(alice, bob.email);
  const gameId = sent.headers.get("location")!.split("/").at(-1)!;

  expect(
    await reply(await openInvite(inviteToken(bob.email), bob.cookie)),
  ).toMatchObject({ status: 302, location: `/games/${gameId}` });
  expect(
    await db.game.findUniqueOrThrow({ where: { id: gameId } }),
  ).toMatchObject({ status: "ACTIVE", playerTwoId: bob.id });
});

test("inviting an address with an account and one without gets the same response", async () => {
  const alice = await player("alice");
  const member = await player("member");

  const shape = async (response: Response) => ({
    status: response.status,
    location: response.headers
      .get("location")
      ?.replace(/[0-9a-f-]{36}$/, "<id>"),
    headers: [...response.headers.keys()].sort(),
    body: await response.text(),
  });

  expect(await shape(await sendInvite(alice, member.email))).toEqual(
    await shape(await sendInvite(alice, address("stranger"))),
  );
});

test("the New game form explains a bad address, your own address and the cap", async () => {
  const alice = await player("alice");

  expect(await reply(await sendInvite(alice, "not an email"))).toMatchObject({
    status: 400,
    body: { error: expect.stringMatching(/email address/i) },
  });
  expect(await reply(await sendInvite(alice, alice.email))).toMatchObject({
    status: 400,
    body: { error: expect.stringMatching(/your own/i) },
  });
  for (let i = 0; i < 5; i++) {
    expect((await sendInvite(alice, address("friend"))).status).toBe(302);
  }
  expect(await reply(await sendInvite(alice, address("sixth")))).toMatchObject({
    status: 429,
    body: { error: expect.stringMatching(/5 invites/) },
  });
  expect(log.capture.events("invite.capped")).toHaveLength(1);
});

test("an expired invite link says so, and its sign-in is refused by the gate", async () => {
  const alice = await player("alice");
  const bob = address("bob");
  const sent = await sendInvite(alice, bob);
  const gameId = sent.headers.get("location")!.split("/").at(-1)!;
  const token = inviteToken(bob);

  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + INVITE_TTL_MS + 1);

  expect(await reply(await openInvite(token))).toMatchObject({
    status: 410,
    body: { state: "expired" },
  });
  expect(log.capture.events("invite.expired")).toContainEqual(
    expect.objectContaining({ gameId }),
  );
  const refused = await authRequest(
    formPost(
      "/auth/email/initiate",
      { email: bob, redirectTo: `/invite/${gameId}` },
      { referer: `/invite/${token}` },
    ),
  );
  expect(refused.headers.get("location")).toBe("/login?error=NOT_INVITED");
});

test("a used invite link can't seat anyone else", async () => {
  const alice = await player("alice");
  const bob = await player("bob");
  const sent = await sendInvite(alice, bob.email);
  const gameId = sent.headers.get("location")!.split("/").at(-1)!;
  const token = inviteToken(bob.email);
  await openInvite(token, bob.cookie);

  // Signed out, or as B again: B is sent back to the game.
  expect(await reply(await openInvite(token))).toMatchObject({
    status: 410,
    body: { state: "used" },
  });
  expect(await reply(await openInvite(token, bob.cookie))).toMatchObject({
    status: 302,
    location: `/games/${gameId}`,
  });
  const mallory = await player("mallory");
  expect((await reply(await openInvite(token, mallory.cookie))).status).toBe(
    410,
  );
  expect((await reply(await openInvite(gameId, mallory.cookie))).status).toBe(
    404,
  );
});

test("a signed-in account that isn't the invitee gets 404 and the seat stays empty", async () => {
  const alice = await player("alice");
  const bob = address("bob");
  const sent = await sendInvite(alice, bob);
  const gameId = sent.headers.get("location")!.split("/").at(-1)!;
  const mallory = await player("mallory");

  expect(
    (await reply(await openInvite(inviteToken(bob), mallory.cookie))).status,
  ).toBe(404);
  expect((await reply(await openInvite(gameId, mallory.cookie))).status).toBe(
    404,
  );
  expect((await reply(await openInvite(gameId, alice.cookie))).status).toBe(
    404,
  );
  expect(
    await db.game.findUniqueOrThrow({ where: { id: gameId } }),
  ).toMatchObject({ status: "INVITED", playerTwoId: null });
});

test("/invite/:gameId signed out goes to sign-in and back; an unknown token is 404", async () => {
  const gameId = "00000000-0000-4000-8000-000000000000";
  const signedOut = await reply(await openInvite(gameId));
  expect(signedOut.status).toBe(302);
  expect(signedOut.location).toContain(
    `redirectTo=${encodeURIComponent(`/invite/${gameId}`)}`,
  );
  expect((await reply(await openInvite("no-such-token"))).status).toBe(404);
});
