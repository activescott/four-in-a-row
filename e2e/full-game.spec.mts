import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  confirmSignIn,
  hydrationErrors,
  newLink,
  waitOutFormToken,
} from "./helpers";
import { inviteeEmail, inviterEmail } from "./players";

test("a signed-out visitor reaches the sign-in form from the home page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("the home page fits a 320px phone with no sideways scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: /Four in a Row board/ }),
  ).toBeVisible();
  const [scroll, inner] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(inner);
  const board = await page
    .getByRole("img", { name: /Four in a Row board/ })
    .boundingBox();
  expect(board!.x + board!.width).toBeLessThanOrEqual(inner);
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
  await expect(a).toHaveURL(/\/games$/);
  await expect(a.getByRole("button", { name: "New game" })).toBeVisible();

  // A invites B and lands on the new game's board.
  await a.locator("#invite-email").fill(emailB);
  const invite = await newLink(
    request,
    emailB,
    (m) => m.invite?.link,
    () => a.getByRole("button", { name: "New game" }).click(),
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
  // The record updates on both boards, the watcher's included, with no reload.
  await expect(a.getByText(`You 1 · ${name(emailB)} 0`)).toBeVisible();
  await expect(b.getByText(`You 0 · ${name(emailA)} 1`)).toBeVisible();
  for (const page of [a, b]) {
    expect(
      await page.evaluate(() => (window as { e2eLoaded?: boolean }).e2eLoaded),
    ).toBe(true);
  }

  // The winner's profile uses the fixed award zone, and the server render must
  // still hydrate.
  const profile = async (
    storageState: BrowserContext["storageState"],
    timezoneId: string,
  ) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      storageState: await storageState(),
      timezoneId,
    });
    const page = await context.newPage();
    const errors = hydrationErrors(page);
    await page.goto("/profile");
    return { page, errors, context };
  };
  const localDay = (iso: string, timeZone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  const award = (page: Page, name: string) =>
    page.getByRole("listitem").filter({ hasText: name });

  for (const timezoneId of ["America/Los_Angeles", "UTC"]) {
    const { page, errors, context } = await profile(
      () => a.context().storageState(),
      timezoneId,
    );
    await expect(page.getByText("1 win out of 1 game")).toBeVisible();
    await expect(page.getByText(`You 1 · ${name(emailB)} 0`)).toBeVisible();
    const earned = award(page, "First win").locator("time");
    const iso = (await earned.getAttribute("datetime"))!;
    await expect(earned).toHaveText(localDay(iso, "America/Los_Angeles"));
    await expect(award(page, "Ten wins")).toContainText("1 of 10");
    expect(errors).toEqual([]);
    await testInfo.attach(`profile-with-games-${timezoneId}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await context.close();
  }

  const loser = await profile(() => contextB.storageState(), "UTC");
  await expect(loser.page.getByText("0 wins out of 1 game")).toBeVisible();
  await expect(award(loser.page, "First win")).toContainText("Not earned yet");
  await expect(award(loser.page, "First win")).toContainText("Win a game");
  expect(loser.errors).toEqual([]);
  await testInfo.attach("profile-lost-game", {
    body: await loser.page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await loser.context.close();
  await contextB.close();
});
