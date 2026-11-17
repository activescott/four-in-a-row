import { expect, test } from "@playwright/test";
import { waitOutFormToken } from "./helpers";

// #76: the 3 tries per code are spent, so a 4th wrong code needs a new code.
test("a 4th wrong sign-in code lands on /login asking for a new one", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page
    .getByLabel("Email")
    .fill(`wrong-code-${testInfo.project.name}@example.com`);
  await waitOutFormToken(page);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  const codeForm = page.getByLabel("Or enter the code");
  await expect(codeForm).toBeVisible();
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
  await expect(page.getByText("Ask for a new code")).toBeVisible();
});
