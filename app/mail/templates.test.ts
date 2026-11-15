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

test("the sign-in email is about Four in a Row, states the expiry calmly and uses the app blue", () => {
  const mail = signInEmail({
    to: "b@example.com",
    link: "https://app.example/auth/email/verify?challenge=c&key=k",
    code: "123456",
    minutes: 5,
  });

  expect(mail.kind).toBe("signin");
  expect(mail.subject).toBe("Your sign-in link for Four in a Row");
  expect(mail.text).toContain("Four in a Row");
  expect(mail.text).toContain("Your sign-in code is: 123456");
  expect(mail.text).toContain(
    "This link works for 5 minutes. If it runs out, just ask for a new one.",
  );
  expect(mail.text).toContain(
    "If you weren't expecting this, you can ignore it.",
  );
  expect(mail.text).not.toMatch(/expire/i);
  expect(mail.html).toContain("#1d4ed8");
  expect(mail.html).not.toContain("#6366f1");
  expect(mail.html).toContain("Four in a Row");
  expect(mail.html).toContain("This link works for 5 minutes.");
  expect(mail.html).toContain("If you weren't expecting this");
  expect(mail.html).toContain("123456");
});

test("the sign-in email says 1 minute, not 1 minutes", () => {
  const mail = signInEmail({ to: "b@example.com", link: "l", minutes: 1 });
  expect(mail.text).toContain("works for 1 minute.");
});
