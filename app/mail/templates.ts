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

type Purpose = "sign-in" | "link";

// What differs between the two mails the auth library sends through the
// transport; layout and the expiry sentence are shared.
const SIGN_IN_COPY = {
  subject: `Your sign-in link for ${APP}`,
  heading: `Sign in to ${APP}`,
  lede: `sign in and play ${APP}`,
  button: "Sign in and play",
  codeIntro: "Or type your sign-in code on the sign-in page.",
  // Literal "Your sign-in code is: N" so mail apps offer AutoFill.
  codeLabel: "Your sign-in code is: ",
  retry: "go back to the sign-in page and ask for a new one",
  ignore: "If you weren't expecting this, you can ignore it.",
};

const LINK_COPY = {
  subject: `Confirm your email for ${APP}`,
  heading: `Confirm your email for ${APP}`,
  lede: "confirm it",
  button: "Confirm email",
  codeIntro: "Or type your confirmation code where you were asked for it.",
  codeLabel: "Your confirmation code is: ",
  retry: `go back to ${APP} and ask for a new one`,
  ignore: "If that wasn't you, you can ignore this email.",
};

const TEXT = "#111827";
const MUTED = "#4b5563";
const BLUE = "#1d4ed8";

/**
 * The sign-in mail the auth library hands to the app's transport: the link
 * first, then the code, worded for someone about to play, with the expiry
 * stated calmly. A "link" purpose confirms an address a signed-in user is
 * adding, and says so.
 */
export function signInEmail({
  to,
  link,
  code,
  minutes,
  purpose = "sign-in",
}: {
  to: string;
  link: string;
  code?: string;
  minutes: number;
  purpose?: Purpose;
}): Mail {
  const c = purpose === "link" ? LINK_COPY : SIGN_IN_COPY;
  const intro =
    purpose === "link"
      ? `Someone signed in to ${APP} asked to add this email address to their account.`
      : "";
  const expiry = `This link works for ${minutes} ${minutes === 1 ? "minute" : "minutes"}. If it runs out, ${c.retry}.`;
  const href = escape(link);
  const p = (style: string, body: string) => `<p style="${style}">${body}</p>`;

  const text = [
    `${intro ? `${intro} Use this link to ${c.lede}:` : `Use this link to ${c.lede}:`}\n${link}`,
    ...(code ? [`${c.codeIntro} ${c.codeLabel}${code}`] : []),
    expiry,
    c.ignore,
  ].join("\n\n");

  const html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: ${TEXT};">
<h1 style="font-size: 22px; font-weight: bold; margin: 0 0 16px; color: ${TEXT};">${escape(c.heading)}</h1>
${p("font-size: 16px;", escape(`${intro ? `${intro} ` : ""}Use the button below to ${c.lede}.`))}
<p style="margin: 30px 0;"><a href="${href}" style="background: ${BLUE}; color: white; padding: 14px 28px; font-size: 18px; text-decoration: none; border-radius: 6px; display: inline-block;">${escape(c.button)}</a></p>
${code ? `${p("font-size: 16px;", `${escape(c.codeIntro)} ${escape(c.codeLabel)}<span style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${escape(code)}</span>`)}\n` : ""}${p(`color: ${MUTED}; font-size: 15px;`, escape(expiry))}
${p(`color: ${MUTED}; font-size: 14px;`, escape(c.ignore))}
${p(`color: ${MUTED}; font-size: 14px; margin-bottom: 4px;`, escape("If the button doesn't work, open this link:"))}
${p("font-size: 14px; margin-top: 0; word-break: break-all;", `<a href="${href}" style="color: ${BLUE}; word-break: break-all;">${href}</a>`)}
</div>`;

  return { kind: "signin", to, subject: c.subject, text, html, link };
}
