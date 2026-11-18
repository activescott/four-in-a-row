// Fails if the Playwright container image the e2e job runs in is not the same
// version as @playwright/test in package-lock.json. The image carries the
// browser builds that exact Playwright version expects, so a mismatch makes
// every browser launch fail (or, worse, silently use the wrong build).
// Usage: node scripts/check-playwright-image.mjs [workflow.yaml] [package-lock.json]
import { readFileSync } from "node:fs";

const [
  workflowPath = ".github/workflows/ci.yaml",
  lockPath = "package-lock.json",
] = process.argv.slice(2);

const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const locked = lock.packages?.["node_modules/@playwright/test"]?.version;
if (!locked) {
  console.error(`No @playwright/test version found in ${lockPath}`);
  process.exit(1);
}

const workflow = readFileSync(workflowPath, "utf8");
const tags = [
  ...workflow.matchAll(/mcr\.microsoft\.com\/playwright:v([^\s@-]+)/g),
].map((m) => m[1]);
if (tags.length === 0) {
  console.error(
    `${workflowPath} has no mcr.microsoft.com/playwright:v<version> image`,
  );
  process.exit(1);
}

const wrong = tags.filter((t) => t !== locked);
if (wrong.length > 0) {
  console.error(
    `Playwright image tag v${wrong.join(", v")} in ${workflowPath} differs from ` +
      `@playwright/test ${locked} in ${lockPath}. Update the image tag and digest.`,
  );
  process.exit(1);
}
console.log(`Playwright image v${locked} matches package-lock.json`);
