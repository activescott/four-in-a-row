import { parseDuration } from "@activescott/auth";
import { validateEmailConfig } from "@activescott/auth-provider-email";
import type { EmailProviderConfig } from "@activescott/auth-provider-email";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createSignupGate } from "../auth/signup-gate.server";
import type { PrismaClient } from "../generated/prisma/client";
import { createLogger } from "../logger.server";
import { createPgliteDb } from "../pglite.server";
import { logCapture } from "../test/routes";
import type { Mail, Mailer } from "./mailer.server";
import { createSignInTransport } from "./signin-transport.server";

const smtp = { host: "h", port: 587, user: "u", pass: "p" };

function setup(expiry?: string) {
  const sent: Mail[] = [];
  const mailer: Mailer = {
    async send(mail) {
      sent.push(mail);
      return true;
    },
  };
  const config = validateEmailConfig({ smtp, from: "a@example.com", expiry });
  return { sent, config, transport: createSignInTransport(mailer) };
}

test("the library's sign-in mail goes out as the app's own, with the configured expiry", async () => {
  const { sent, config, transport } = setup("5m");

  const ok = await transport.sendMagicLink(
    "b@example.com",
    "https://x/y",
    config,
    {
      code: "654321",
      purpose: "sign-in",
    },
  );

  expect(ok).toBe(true);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    kind: "signin",
    to: "b@example.com",
    link: "https://x/y",
    subject: "Your sign-in link for Four in a Row",
  });
  expect(sent[0].text).toContain("654321");
  expect(sent[0].text).toContain("works for 5 minutes");
});

test("without an expiry setting the wording follows the library default of 15 minutes", async () => {
  const { sent, config, transport } = setup();
  await transport.sendMagicLink("b@example.com", "https://x/y", config);
  expect(sent[0].text).toContain("works for 15 minutes");
});

test("a relay failure is reported as not sent", async () => {
  const { config } = setup();
  const transport = createSignInTransport({ send: async () => false });
  expect(await transport.sendMagicLink("b@example.com", "l", config)).toBe(
    false,
  );
});

test("a sign-in email and a link-confirmation email are worded differently", async () => {
  const { sent, config, transport } = setup();
  await transport.sendMagicLink("b@example.com", "https://x/y", config, {
    code: "1",
    purpose: "sign-in",
  });
  await transport.sendMagicLink("b@example.com", "https://x/y", config, {
    code: "1",
    purpose: "link",
  });

  expect(sent.map((m) => m.subject)).toEqual([
    "Your sign-in link for Four in a Row",
    "Confirm your email for Four in a Row",
  ]);
  expect(sent[1].text).toContain("asked to add this email address");
});

test("a config without an expiry falls back to the library's validated default", async () => {
  const { sent, config, transport } = setup();
  const minutes = parseDuration(config.expiry as string) / 60;
  await transport.sendMagicLink("b@example.com", "l", {
    smtp,
    from: "a@example.com",
  } as EmailProviderConfig);
  expect(sent[0].text).toContain(`works for ${minutes} minutes`);
});

let db: PrismaClient;
beforeAll(async () => {
  db = await createPgliteDb();
});
afterAll(async () => {
  await db.$disconnect();
});

test("behind the open sign-up gate a stranger is sent the mail too", async () => {
  const { sent, config } = setup();
  const send = vi.fn(async (mail: Mail) => {
    sent.push(mail);
    return true;
  });
  const gate = createSignupGate({
    db,
    logger: createLogger(logCapture().destination),
  });
  const transport = gate.transport(createSignInTransport({ send }));

  expect(
    await transport.sendMagicLink("stranger@example.com", "l", config),
  ).toBe(true);
  expect(await transport.sendMagicLink("known@example.com", "l", config)).toBe(
    true,
  );
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  expect(sent.map((mail) => mail.to).sort()).toEqual([
    "known@example.com",
    "stranger@example.com",
  ]);
});
