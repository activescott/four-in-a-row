import { displayName } from "../game/display";
import type { Mail } from "./mailer.server";

const APP = "Four in a Row";

function escape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function html(paragraphs: string[], link: string, button: string) {
  const href = escape(link);
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
${paragraphs.map((p) => `<p>${escape(p)}</p>`).join("\n")}
<p style="margin: 30px 0;"><a href="${href}" style="background: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">${escape(button)}</a></p>
<p style="color: #6b7280; font-size: 12px;">If the button doesn't work, open this link: <a href="${href}">${href}</a></p>
</div>`;
}

/** The invite: who sent it and the /invite/:token link, valid for 7 days. */
export function inviteEmail({
  to,
  inviterEmail,
  link,
}: {
  to: string;
  inviterEmail: string;
  link: string;
}): Mail {
  const inviter = displayName(inviterEmail);
  const lines = [
    `${inviter} (${inviterEmail}) invited you to play ${APP}.`,
    "Open the link to sign in and join the game. It works once and expires in 7 days.",
  ];
  return {
    kind: "invite",
    to,
    subject: `${inviter} invited you to play ${APP}`,
    text: `${lines.join("\n\n")}\n\n${link}\n\nIf you weren't expecting this, you can ignore it.`,
    html: html(lines, link, "Join the game"),
    link,
  };
}

/** "Your turn": the opponent has moved and isn't watching you think. */
export function turnEmail({
  to,
  opponentEmail,
  link,
}: {
  to: string;
  opponentEmail: string;
  link: string;
}): Mail {
  const opponent = displayName(opponentEmail);
  const lines = [`${opponent} has played. It's your turn.`];
  return {
    kind: "turn",
    to,
    subject: `Your turn against ${opponent} in ${APP}`,
    text: `${lines.join("\n\n")}\n\n${link}`,
    html: html(lines, link, "Open the game"),
    link,
  };
}
