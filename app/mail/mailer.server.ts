import nodemailer, { type Transporter } from "nodemailer";
import { type Logger, logger as appLogger } from "../logger.server";

// The app's own mail (invites and "your turn"), separate from the auth
// library's sign-in mail but over the same SMTP settings: the email relay in
// production. Under E2E_TEST_MODE nothing is sent and each mail is captured.

export type MailKind = "invite" | "turn" | "signin";

export type Mail = {
  kind: MailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  /** The one link the mail is about, kept for the e2e readback. */
  link: string;
};

export type Mailer = {
  /** True once the relay has accepted the mail. Never throws. */
  send(mail: Mail): Promise<boolean>;
};

export function createSmtpMailer({
  transport,
  from,
  logger = appLogger,
}: {
  transport: Transporter;
  from: string;
  logger?: Logger;
}): Mailer {
  return {
    async send({ kind, to, replyTo, subject, text, html, link }) {
      try {
        await transport.sendMail({
          from: { name: APP_NAME, address: from },
          to,
          ...(replyTo && { replyTo }),
          subject,
          text,
          html,
        });
        return true;
      } catch (error) {
        logRelayError(logger, kind, error, { to, link });
        return false;
      }
    },
  };
}

// Why the relay refused. Never the body or the address: the link and code sign
// someone in. Logging must not change the answer, so nothing here may throw.
function logRelayError(
  logger: Logger,
  kind: MailKind,
  error: unknown,
  mail: { to: string; link: string },
) {
  try {
    const { code, responseCode, command, message } = (error ?? {}) as Record<
      string,
      unknown
    >;
    logger.error({
      event: "email.send.failed",
      kind,
      ...(typeof code === "string" && { code }),
      ...(typeof responseCode === "number" && { responseCode }),
      ...(typeof command === "string" && { command }),
      message: scrubRelayMessage(messageText(message), mail),
    });
  } catch {
    // A broken logger or a hostile error is not worth failing the send for.
  }
}

function messageText(message: unknown) {
  try {
    return String(message ?? "");
  } catch {
    return "";
  }
}

// Relays echo what they were given, so strip everything that could sign
// someone in or name them: the link, any URL, anything address-shaped, the
// recipient's bare name, and runs of 4+ digits (the code). What is left is the
// relay's reason, first line only.
function scrubRelayMessage(
  message: string,
  { to, link }: { to: string; link: string },
) {
  const localPart = to.split("@")[0] ?? "";
  // Bound the input first: the address pattern is quadratic on a long run
  // with no spaces, and only the first line is kept anyway.
  let scrubbed = (message.split(/\r?\n/)[0] ?? "").slice(0, MAX_SCRUB_INPUT);
  for (const literal of [link, to]) {
    if (literal) scrubbed = scrubbed.replaceAll(literal, REDACTED);
  }
  scrubbed = scrubbed
    .replace(/https?:\/\/\S+/gi, REDACTED)
    .replace(/[^\s<>"'()[\],;]*@[^\s<>"'()[\],;]*/g, REDACTED)
    .replace(/\d{4,}/g, REDACTED);
  if (localPart) {
    scrubbed = scrubbed.replace(
      new RegExp(`(?<![\\w.+-])${escapeRegExp(localPart)}(?![\\w.+-])`, "gi"),
      REDACTED,
    );
  }
  return scrubbed.trim().slice(0, 200);
}

const REDACTED = "[redacted]";
const MAX_SCRUB_INPUT = 1000;

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Records the mail it is given, keyed by address and kind, and sends none. */
export class CaptureMailer implements Mailer {
  private readonly captured = new Map<string, Mail[]>();

  async send(mail: Mail) {
    const key = this.key(mail.to, mail.kind);
    this.captured.set(key, [...(this.captured.get(key) ?? []), mail]);
    return true;
  }

  last(to: string, kind: MailKind): Mail | null {
    return this.captured.get(this.key(to, kind))?.at(-1) ?? null;
  }

  count(to: string, kind: MailKind) {
    return this.captured.get(this.key(to, kind))?.length ?? 0;
  }

  clear() {
    this.captured.clear();
  }

  private key(to: string, kind: MailKind) {
    return `${kind} ${to.toLowerCase()}`;
  }
}

const env = process.env;
const production = env.NODE_ENV === "production";

/** SMTP_* from env, shared with the auth library's sign-in mail. */
export const smtp = {
  host: env.SMTP_HOST ?? (production ? "" : "localhost"),
  port: Number(env.SMTP_PORT ?? 587),
  secure: env.SMTP_SECURE === "true",
  user: env.SMTP_USER ?? (production ? "" : "dev"),
  pass: env.SMTP_PASS ?? (production ? "" : "dev"),
};
export const fromEmail =
  env.FROM_EMAIL ?? (production ? "" : "noreply@localhost.test");

// Every mail, sign-in included, shows as from "Four in a Row".
export const APP_NAME = "Four in a Row";
export const fromHeader = fromEmail && `"${APP_NAME}" <${fromEmail}>`;

// Dev without SMTP_HOST prints each mail's link instead of sending it.
const consoleMailer: Mailer = {
  async send({ kind, link }) {
    console.info(`App email (development mode): ${kind} ${link}`);
    return true;
  },
};

export const captureMailer =
  env.E2E_TEST_MODE === "true" ? new CaptureMailer() : null;

export const mailer: Mailer =
  captureMailer ??
  (!production && !env.SMTP_HOST
    ? consoleMailer
    : createSmtpMailer({
        from: fromEmail,
        transport: nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: { user: smtp.user, pass: smtp.pass },
          // A stuck relay must not hold a move or an invite for minutes.
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        }),
      }));
