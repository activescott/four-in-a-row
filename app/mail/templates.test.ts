import { expect, test } from "vitest";
import { inviteEmail, signInEmail, turnEmail } from "./templates";

test("the invite email names the inviter and links to the invite", () => {
  const mail = inviteEmail({
    to: "b@example.com",
    inviterEmail: "alice@example.com",
    link: "https://app.example/invite/abc",
  });

  expect(mail).toMatchObject({
    kind: "invite",
    to: "b@example.com",
    replyTo: "alice@example.com",
    link: "https://app.example/invite/abc",
  });
  expect(mail.text).toBe(
    [
      "alice@example.com invited you to play Four in a Row, a two-player game you take turns at on your phone or computer. Nothing to install.",
      "Tap Join the game to start. The link works for 7 days.",
      "https://app.example/invite/abc",
      "If you weren't expecting this, you can ignore it.",
    ].join("\n\n"),
  );
  expect(mail.html).toContain('href="https://app.example/invite/abc"');
});

// The inviter chose their own address, so it never sets the subject, and
// the body leads with all of it, domain included.
test("the invite subject is fixed, whoever sends it", () => {
  const mail = inviteEmail({
    to: "b@example.com",
    inviterEmail: "your-bank-account-is-locked@example.com",
    link: "https://app.example/invite/abc",
  });

  expect(mail.subject).toBe("You're invited to play Four in a Row");
  expect(mail.text.startsWith("your-bank-account-is-locked@example.com ")).toBe(
    true,
  );
});

test("the invite HTML says it can be ignored, and its button clears 44 px", () => {
  const { html } = inviteEmail({
    to: "b@example.com",
    inviterEmail: "alice@example.com",
    link: "https://app.example/invite/abc",
  });

  const ignore = html.indexOf(
    "If you weren&#39;t expecting this, you can ignore it.",
  );
  expect(ignore).toBeGreaterThan(html.indexOf(">Join the game</a>"));
  expect(ignore).toBeLessThan(html.indexOf("If the button doesn"));
  expect(html).toMatch(
    /<p style="color: #6b7280; font-size: 12px;">If you weren/,
  );
  expect(html).toContain("padding: 14px 28px; font-size: 18px;");
});

test("the turn email names the opponent and links to the game", () => {
  const mail = turnEmail({
    to: "b@example.com",
    opponentEmail: "alice@example.com",
    link: "https://app.example/games/g1",
  });

  expect(mail).toMatchObject({
    kind: "turn",
    subject: "Your turn against alice in Four in a Row",
    link: "https://app.example/games/g1",
  });
  expect(mail.text).toContain("https://app.example/games/g1");
  expect(mail.html).toContain('href="https://app.example/games/g1"');
});

test("names are escaped in the HTML part", () => {
  const mail = inviteEmail({
    to: "b@example.com",
    inviterEmail: '<b>"x"&@example.com',
    link: "https://app.example/invite/abc",
  });

  expect(mail.html).toContain("&lt;b&gt;&quot;x&quot;&amp;");
  expect(mail.html).not.toContain("<b>");
});

const LINK = "https://app.example/auth/email/verify?challenge=c&key=k";
const LINK_HTML = "https://app.example/auth/email/verify?challenge=c&amp;key=k";

function signIn(extra: Partial<Parameters<typeof signInEmail>[0]> = {}) {
  return signInEmail({
    to: "b@example.com",
    link: LINK,
    code: "123456",
    minutes: 5,
    ...extra,
  });
}

test("the sign-in text part leads with the link, then the code, then the expiry", () => {
  const mail = signIn();

  expect(mail.kind).toBe("signin");
  expect(mail.subject).toBe("Your sign-in link for Four in a Row");
  expect(mail.text).toBe(
    [
      `Use this link to sign in and play Four in a Row:\n${LINK}`,
      "Or type your sign-in code on the sign-in page. Your sign-in code is: 123456",
      "This link works for 5 minutes. If it runs out, go back to the sign-in page and ask for a new one.",
      "If you weren't expecting this, you can ignore it.",
    ].join("\n\n"),
  );
  expect(mail.text).not.toMatch(/expire/i);
});

test("the sign-in HTML has a heading, the button before the code, and a calm expiry paragraph", () => {
  const { html } = signIn();

  expect(html).toMatch(
    /<h1[^>]*font-size: 22px[^>]*font-weight: (bold|700)[^>]*>Sign in to Four in a Row<\/h1>/,
  );
  expect(html).toContain("Use the button below to sign in and play");
  expect(html).not.toContain("Tap");
  expect(html).toContain("#1d4ed8");
  expect(html).not.toContain("#6366f1");
  expect(html).toMatch(/color: #111827/);

  expect(html.indexOf("Sign in and play</a>")).toBeGreaterThan(-1);
  expect(html.indexOf("Sign in and play</a>")).toBeLessThan(
    html.indexOf("Or type your sign-in code on the sign-in page."),
  );
  expect(html).toContain("Your sign-in code is: ");
  expect(html).toMatch(
    /font-size: 24px;[^"]*font-weight: (bold|700);[^"]*letter-spacing: [^;"]+[^>]*>123456</,
  );

  expect(html).toMatch(
    /<p style="[^"]*color: #4b5563;[^"]*font-size: 15px[^"]*">This link works for 5 minutes\. If it runs out, go back to the sign-in page and ask for a new one\.<\/p>/,
  );
  expect(html).toMatch(
    /color: #4b5563; font-size: 14px[^>]*>If you weren&#39;t expecting this, you can ignore it\./,
  );
  expect(html).toMatch(
    /color: #4b5563; font-size: 14px[^>]*>If the button doesn&#39;t work, open this link:<\/p>\s*<p[^>]*><a href="/,
  );
  expect(html).not.toMatch(/12px|13px|#6b7280/);
  expect(html).toMatch(
    /<a href="[^"]*" style="[^"]*word-break: break-all[^"]*color: #1d4ed8|<a href="[^"]*" style="[^"]*color: #1d4ed8[^"]*word-break: break-all/,
  );
});

test("the link purpose confirms an address instead of asking for a sign-in", () => {
  const mail = signIn({ purpose: "link" });

  expect(mail.kind).toBe("signin");
  expect(mail.subject).toBe("Confirm your email for Four in a Row");
  expect(mail.text).toContain(
    `Someone signed in to Four in a Row asked to add this email address to their account. Use this link to confirm it:\n${LINK}`,
  );
  expect(mail.text).toContain("123456");
  expect(mail.text).toContain("works for 5 minutes");
  expect(mail.text).toContain("If that wasn't you, you can ignore this email.");
  expect(mail.text).not.toMatch(/sign in and play|sign-in/i);
  expect(mail.html).toContain(">Confirm your email for Four in a Row</h1>");
  expect(mail.html).toContain("Use the button below to confirm it");
  expect(mail.html).toContain(">Confirm email</a>");
  expect(mail.html).not.toMatch(/sign in and play|sign-in/i);
  expect(mail.html).toContain(
    "If that wasn&#39;t you, you can ignore this email.",
  );
});

test("the sign-in purpose is the default", () => {
  expect(signIn({ purpose: "sign-in" })).toEqual(signIn());
});

test("link and code are escaped in the HTML part", () => {
  const mail = signIn({
    link: 'https://x/y?a=1&b="2"<z>',
    code: '1&"<2',
  });

  expect(mail.html).toContain("https://x/y?a=1&amp;b=&quot;2&quot;&lt;z&gt;");
  expect(mail.html).toContain("1&amp;&quot;&lt;2");
  expect(mail.html).not.toContain('b="2"');
  expect(mail.html).not.toContain("<z>");
  expect(mail.html).not.toContain('1&"<2');
  expect(mail.text).toContain('https://x/y?a=1&b="2"<z>');
});

test("without a code there is no code line in either part", () => {
  const mail = signIn({ code: undefined });

  expect(mail.text).not.toMatch(/code/i);
  expect(mail.html).not.toMatch(/code/i);
  expect(mail.html).not.toContain("letter-spacing");
});

test("the sign-in email says 1 minute, not 1 minutes", () => {
  const mail = signIn({ minutes: 1 });
  expect(mail.text).toContain("works for 1 minute.");
});

test("the link HTML keeps the fallback link readable", () => {
  expect(signIn().html).toContain(`<a href="${LINK_HTML}"`);
});
