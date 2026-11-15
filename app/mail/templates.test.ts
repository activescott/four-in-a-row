import { expect, test } from "vitest";
import { inviteEmail, turnEmail } from "./templates";

test("the invite email names the inviter and links to the invite", () => {
  const mail = inviteEmail({
    to: "b@example.com",
    inviterEmail: "alice@example.com",
    link: "https://app.example/invite/abc",
  });

  expect(mail).toMatchObject({
    kind: "invite",
    to: "b@example.com",
    subject: "alice invited you to play Four in a Row",
    link: "https://app.example/invite/abc",
  });
  expect(mail.text).toContain("https://app.example/invite/abc");
  expect(mail.text).toContain("7 days");
  expect(mail.html).toContain('href="https://app.example/invite/abc"');
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
