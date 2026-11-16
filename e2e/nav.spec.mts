import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { signIn } from "./helpers";

// One sign-in per project: the per-IP send limit is shared with the other
// specs, so the tests reuse this session in contexts of their own.
let session: Awaited<ReturnType<BrowserContext["storageState"]>>;

test.beforeAll(async ({ browser, request }, testInfo) => {
  const context = await browser.newContext(testInfo.project.use);
  const page = await context.newPage();
  test.setTimeout(150_000);
  await signIn(page, request, `nav-${testInfo.project.name}@example.com`);
  session = await context.storageState();
  await context.close();
});

async function signedInPage(
  browser: Browser,
  project: object,
  colorScheme: "light" | "dark" = "light",
) {
  const context = await browser.newContext({
    ...project,
    storageState: session,
    colorScheme,
  });
  const page = await context.newPage();
  await page.goto("/games");
  return page;
}

const details = (page: Page) => page.locator("header details");

async function openMenu(page: Page) {
  const summary = page.locator("header summary");
  await summary.click();
  await expect(details(page)).toHaveJSProperty("open", true);
  return summary;
}

test("Escape closes the account menu and puts focus back on the summary", async ({
  browser,
}, testInfo) => {
  const page = await signedInPage(browser, testInfo.project.use);
  const summary = await openMenu(page);
  await page.getByRole("link", { name: "Profile" }).focus();
  await page.keyboard.press("Escape");
  await expect(details(page)).toHaveJSProperty("open", false);
  await expect(summary).toBeFocused();
});

test("a click outside closes the account menu", async ({
  browser,
}, testInfo) => {
  const page = await signedInPage(browser, testInfo.project.use);
  await openMenu(page);
  await page.locator("main").click({ position: { x: 5, y: 5 } });
  await expect(details(page)).toHaveJSProperty("open", false);
});

test("following Profile leaves the account menu closed on /profile", async ({
  browser,
}, testInfo) => {
  const page = await signedInPage(browser, testInfo.project.use);
  await openMenu(page);
  await page.getByRole("link", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(details(page)).toHaveJSProperty("open", false);
});

test("in dark mode the profile page still has a light background", async ({
  browser,
}, testInfo) => {
  const page = await signedInPage(browser, testInfo.project.use, "dark");
  await page.goto("/profile");
  const container = page.locator("main > *").first();
  await expect(container).toHaveCSS("color-scheme", "light");
  const lightness = await container.evaluate((el) => {
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
});
