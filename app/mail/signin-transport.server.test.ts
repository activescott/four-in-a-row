import { validateEmailConfig } from "@activescott/auth-provider-email";
import { expect, test } from "vitest";
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
