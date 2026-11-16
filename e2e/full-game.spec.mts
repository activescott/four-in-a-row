import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { inviteeEmail, inviterEmail } from "./players";

type Captured = { magicLink?: string; invite?: { link: string } };

// The app's e2e readback of the last email each address was sent.
async function captured(request: APIRequestContext, email: string) {
  const response = await request.get(
    `/e2e/captured-email?email=${encodeURIComponent(email)}`,
    { headers: { "x-e2e-secret": process.env.E2E_CAPTURE_SECRET! } },
  );
  return response.ok() ? ((await response.json()) as Captured) : {};
}

// Runs `send`, then waits for a link that wasn't in the readback before it.
// The readback keeps the last email per address, so a send the server
// dropped (the sign-in limit is 3 per address an hour) would otherwise hand
// back an older, already used link.
async function newLink(
  request: APIRequestContext,
  email: string,
  pick: (mail: Captured) => string | undefined,
  send: () => Promise<void>,
) {
  const before = pick(await captured(request, email));
  await send();
  let link: string | undefined;
  await expect
    .poll(async () => (link = pick(await captured(request, email))), {
      message: `a new email to ${email}`,
    })
    .not.toBe(before);
  return link!;
}

// The sign-in forms carry a signed issued-at time, and the auth library
// refuses a submit less than 2 whole seconds after it, as a bot check.
async function waitOutFormToken(page: Page) {
  const token = await page.locator('input[name="authFormToken"]').inputValue();
  const issuedAtMs = Number(token.split(".")[0]) * 1000;
  const wait = issuedAtMs + 2_000 + 100 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
}

async function confirmSignIn(page: Page, magicLink: string) {
  await page.goto(magicLink);
  await page.getByRole("button", { name: "Confirm sign-in" }).click();
}

test("a signed-out visitor reaches the sign-in form from the home page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

const name = (email: string) => email.split("@")[0]!;
const column = (page: Page, n: number) =>
  page.getByRole("button", { name: `Drop a disc in column ${n}` });

test("A invites B by email and they play to a win, live on both boards", async ({
  page: a,
  browser,
  request,
}, testInfo) => {
  const emailA = inviterEmail(testInfo.project.name);
  const emailB = inviteeEmail(testInfo.project.name);

  // A signs in with the emailed link. Nobody invited A and no allowlist names
  // them: a never-seen address signs up and reaches /games (#58).
  await a.goto("/login");
  await a.getByLabel("Email").fill(emailA);
  await waitOutFormToken(a);
  const linkA = await newLink(
    request,
    emailA,
    (m) => m.magicLink,
    async () => {
      await a.getByRole("button", { name: "Email me a sign-in link" }).click();
      await expect(a.getByText("Check your email")).toBeVisible();
    },
  );
  await confirmSignIn(a, linkA);
  await expect(a).toHaveURL(/\/profile$/);
  await a.goto("/games");
  await expect(a).toHaveURL(/\/games$/);
  await expect(a.getByRole("button", { name: "Invite" })).toBeVisible();

  // A invites B and lands on the new game's board.
  await a.locator("#invite-email").fill(emailB);
  const invite = await newLink(
    request,
    emailB,
    (m) => m.invite?.link,
    () => a.getByRole("button", { name: "Invite" }).click(),
  );
  await expect(a).toHaveURL(/\/games\/[0-9a-f-]{36}$/);
  const gameUrl = a.url();
  await expect(a.getByText(`${name(emailB)} (invited)`)).toBeVisible();

  // B, in a browser of their own, opens the invite link and signs in from it.
  const contextB = await browser.newContext(testInfo.project.use);
  const b = await contextB.newPage();
  await b.goto(invite);
  await waitOutFormToken(b);
  const linkB = await newLink(
    request,
    emailB,
    (m) => m.magicLink,
    async () => {
      await b.getByRole("button", { name: "Send my sign-in email" }).click();
      await expect(b.getByText("Open the email we just sent")).toBeVisible();
    },
  );
  await confirmSignIn(b, linkB);
  await expect(b).toHaveURL(gameUrl);
  await expect(b.getByText("You are yellow")).toBeVisible();

  // From here on neither page navigates: a reload would drop these marks.
  for (const page of [a, b]) {
    await page.evaluate(() => {
      (window as { e2eLoaded?: boolean }).e2eLoaded = true;
    });
  }

  // A's open board learns that B joined.
  await expect(a.getByText(name(emailB), { exact: true })).toBeVisible();

  // A stacks four in column 1, B answers in column 2. Each move shows up on
  // the other board through polling.
  const moves: [Page, Page, string, number][] = [];
  for (let i = 0; i < 3; i++) {
    moves.push([a, b, name(emailA), 1], [b, a, name(emailB), 2]);
  }
  moves.push([a, b, name(emailA), 1]);
  for (const [mover, watcher, moverName, n] of moves) {
    await column(mover, n).click();
    await expect(mover.getByText(`You played column ${n}.`)).toBeVisible();
    await expect(
      watcher.getByText(`${moverName} played column ${n}.`),
    ).toBeVisible();
  }

  await expect(a.getByText("You won!")).toBeVisible();
  await expect(b.getByText("You lost.")).toBeVisible();
  for (const page of [a, b]) {
    expect(
      await page.evaluate(() => (window as { e2eLoaded?: boolean }).e2eLoaded),
    ).toBe(true);
  }
  await contextB.close();
});
