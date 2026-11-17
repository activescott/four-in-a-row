import { expect, test } from "@playwright/test";
import { newLink, waitOutFormToken } from "./helpers";

// #76: the 3 tries per code are spent, so a 4th wrong code needs a new code.
test("a 4th wrong sign-in code lands on /login asking for a new one", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(200_000);
  const email = `wrong-code-${testInfo.project.name}@example.com`;
  const codeForm = page.getByLabel("Or enter the code");
  // The project's per-IP send limit (3 a minute) may be spent by the earlier
  // specs. A dropped send is answered as if sent but sets no code cookie, so
  // every code is then refused as "no verification in progress". Wait out the
  // window until an email really arrives.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await waitOutFormToken(page);
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
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(30_000);
    }
  }
  const sentUrl = page.url();

  for (let attempt = 1; attempt <= 4; attempt++) {
    await codeForm.fill("000000");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/login\?error=/);
    // A failed code drops ?sent=1, hiding the code form; going back to the
    // sent page keeps the same code, as a person retyping would.
    if (attempt < 4) await page.goto(sentUrl);
  }

  expect(new URL(page.url()).pathname).toBe("/login");
  await expect(page.getByText("Ask for a new one")).toBeVisible();
});
