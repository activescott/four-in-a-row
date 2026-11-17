import { expect, test } from "@playwright/test";
import { newLink, waitOutFormToken } from "./helpers";

// This spec is its own client, as Traefik would report it (the app takes the
// last X-Forwarded-For entry, and the TLS proxy passes the header through), so
// the per-IP send limit the other specs spend in a project doesn't touch it.
// The addresses don't collide with 1 to 3 in playwright.config.mts.
const CLIENT_IP: Record<string, string> = {
  "mobile-webkit": "198.51.100.11",
  "desktop-chromium": "198.51.100.12",
  "desktop-firefox": "198.51.100.13",
};

// #76: the 3 tries per code are spent, so a 4th wrong code needs a new code.
test("a 4th wrong sign-in code lands on /login asking for a new one", async ({
  page,
  request,
}, testInfo) => {
  await page.context().setExtraHTTPHeaders({
    "x-forwarded-for": CLIENT_IP[testInfo.project.name],
  });
  const email = `wrong-code-${testInfo.project.name}@example.com`;
  const codeForm = page.getByLabel("Or enter the code");
  const askForNew = page.getByText("Ask for a new one");

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await waitOutFormToken(page);
  // newLink guards against a dropped send, which sets no code cookie.
  await newLink(
    request,
    email,
    (m) => m.magicLink,
    async () => {
      await page
        .getByRole("button", { name: "Email me a sign-in link" })
        .click();
      await expect(codeForm).toBeVisible();
    },
  );
  const sentUrl = page.url();

  for (let attempt = 1; attempt <= 4; attempt++) {
    await codeForm.fill("000000");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    if (attempt < 4) {
      // Tries 1 to 3 are wrong codes, not yet a refusal.
      await expect(page).toHaveURL(/\/login\?error=INVALID_CREDENTIALS/);
      await expect(askForNew).not.toBeVisible();
      // A failed code drops ?sent=1, hiding the code form; going back to the
      // sent page keeps the same code, as a person retyping would.
      await page.goto(sentUrl);
    } else {
      await expect(page).toHaveURL(/\/login\?error=RATE_LIMITED/);
    }
  }

  expect(new URL(page.url()).pathname).toBe("/login");
  await expect(askForNew).toBeVisible();
});
