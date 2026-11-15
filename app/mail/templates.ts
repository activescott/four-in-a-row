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

function html(
  paragraphs: string[],
  link: string,
  button: string,
  footnote?: string,
) {
  const href = escape(link);
  const small = 'style="color: #6b7280; font-size: 12px;"';
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
${paragraphs.map((p) => `<p>${escape(p)}</p>`).join("\n")}
<p style="margin: 30px 0;"><a href="${href}" style="background: #1d4ed8; color: white; padding: 14px 28px; font-size: 18px; text-decoration: none; border-radius: 6px; display: inline-block;">${escape(button)}</a></p>
${footnote ? `<p ${small}>${escape(footnote)}</p>\n` : ""}<p ${small}>If the button doesn't work, open this link: <a href="${href}">${href}</a></p>
</div>`;
}

/**
 * The invite: who sent it and the /invite/:token link, valid for 7 days.
 * The inviter picked their own address, so it never sets the subject, and
 * the body shows all of it, domain included.
 */
export function inviteEmail({
  to,
  inviterEmail,
  link,
}: {
  to: string;
  inviterEmail: string;
  link: string;
}): Mail {
  const lines = [
    `${inviterEmail} invited you to play ${APP}, a two-player game you take turns at on your phone or computer. Nothing to install.`,
    "Tap Join the game to start. The link works for 7 days.",
  ];
  const ignore = "If you weren't expecting this, you can ignore it.";
  return {
    kind: "invite",
    to,
    replyTo: inviterEmail,
    subject: `You're invited to play ${APP}`,
    text: `${lines.join("\n\n")}\n\n${link}\n\n${ignore}`,
    html: html(lines, link, "Join the game", ignore),
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

/**
 * The sign-in mail the auth library hands to the app's transport: the code and
 * the link, worded for someone about to play, with the expiry stated calmly.
 */
export function signInEmail({
  to,
  link,
  code,
  minutes,
}: {
  to: string;
  link: string;
  code?: string;
  minutes: number;
}): Mail {
  const lines = [`Tap the button to sign in and play ${APP}.`];
  // Literal "Your sign-in code is: N" so mail apps offer AutoFill.
  const codeLine = code && `Your sign-in code is: ${code}`;
  const expiry = `This link works for ${minutes} ${minutes === 1 ? "minute" : "minutes"}. If it runs out, just ask for a new one.`;
  const ignore = "If you weren't expecting this, you can ignore it.";
  const body = [...lines, ...(codeLine ? [codeLine] : [])];
  return {
    kind: "signin",
    to,
    subject: `Your sign-in link for ${APP}`,
    text: `${body.join("\n\n")}\n\n${link}\n\n${expiry}\n\n${ignore}`,
    html: html(body, link, "Sign in and play", `${expiry} ${ignore}`),
    link,
  };
}
