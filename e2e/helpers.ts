import { expect, type APIRequestContext, type Page } from "@playwright/test";

export type Captured = { magicLink?: string; invite?: { link: string } };

// The app's e2e readback of the last email each address was sent.
export async function captured(request: APIRequestContext, email: string) {
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
export async function newLink(
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
export async function waitOutFormToken(page: Page) {
  const token = await page.locator('input[name="authFormToken"]').inputValue();
  const issuedAtMs = Number(token.split(".")[0]) * 1000;
  const wait = issuedAtMs + 2_000 + 100 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
}

export async function confirmSignIn(page: Page, magicLink: string) {
  await page.goto(magicLink);
  await page.getByRole("button", { name: "Confirm sign-in" }).click();
}

// Signs `email` in through the emailed link and lands on /games. Each browser
// project shares one per-IP send limit (3 a minute), which the other specs
// may have used up, so a dropped send waits out the window and tries again.
export async function signIn(
  page: Page,
  request: APIRequestContext,
  email: string,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await waitOutFormToken(page);
      const link = await newLink(
        request,
        email,
        (m) => m.magicLink,
        async () => {
          await page
            .getByRole("button", { name: "Email me a sign-in link" })
            .click();
          await expect(page.getByText("Check your email")).toBeVisible();
        },
      );
      await confirmSignIn(page, link);
      await expect(page).toHaveURL(/\/games$/);
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(30_000);
    }
  }
}

// Collects React's hydration errors, which production builds report as
// minified errors 418, 423 and 425.
export function hydrationErrors(page: Page) {
  const errors: string[] = [];
  const check = (text: string) => {
    if (/hydrat|#418|#423|#425/i.test(text)) errors.push(text);
  };
  page.on("console", (message) => check(message.text()));
  page.on("pageerror", (error) => check(String(error)));
  return errors;
}
