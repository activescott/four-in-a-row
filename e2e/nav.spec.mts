import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

const menuEmail = (project: string) => `nav-${project}@example.com`;

async function openMenu(page: Page) {
  const summary = page.locator("header summary");
  await summary.click();
  await expect(page.locator("header details")).toHaveJSProperty("open", true);
  return summary;
}

test.describe("the account menu", () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await signIn(page, request, menuEmail(testInfo.project.name));
  });

  test("Escape closes it and puts focus back on the summary", async ({
    page,
  }) => {
    const summary = await openMenu(page);
    await page.getByRole("link", { name: "Profile" }).focus();
    await page.keyboard.press("Escape");
    await expect(page.locator("header details")).toHaveJSProperty(
      "open",
      false,
    );
    await expect(summary).toBeFocused();
  });

  test("a click outside closes it", async ({ page }) => {
    await openMenu(page);
    await page.locator("main").click();
    await expect(page.locator("header details")).toHaveJSProperty(
      "open",
      false,
    );
  });

  test("following Profile leaves it closed on /profile", async ({ page }) => {
    await openMenu(page);
    await page.getByRole("link", { name: "Profile" }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator("header details")).toHaveJSProperty(
      "open",
      false,
    );
  });
});

test.describe("in dark mode", () => {
  test.use({ colorScheme: "dark" });

  test("the profile page still has a light background", async ({
    page,
    request,
  }, testInfo) => {
    await signIn(page, request, `navdark-${testInfo.project.name}@example.com`);
    await page.goto("/profile");
    const lightness = await page
      .locator("main > *")
      .first()
      .evaluate((el) => {
        // The first opaque background from the container up, else the canvas.
        for (let n: Element | null = el; n; n = n.parentElement) {
          const m = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
          if (m && (m.length < 4 || Number(m[3]) > 0)) {
            return Math.min(...m.slice(0, 3).map(Number));
          }
        }
        return 255; // the canvas, which `color-scheme: light` keeps white
      });
    expect(lightness).toBeGreaterThan(200);
    await expect(page.locator("main > *").first()).toHaveCSS(
      "color-scheme",
      "light",
    );
  });
});
