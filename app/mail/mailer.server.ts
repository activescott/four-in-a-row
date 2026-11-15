import nodemailer, { type Transporter } from "nodemailer";

// The app's own mail (invites and "your turn"), separate from the auth
// library's sign-in mail but over the same SMTP settings: the email relay in
// production. Under E2E_TEST_MODE nothing is sent and each mail is captured.

export type MailKind = "invite" | "turn";

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
}: {
  transport: Transporter;
  from: string;
}): Mailer {
  return {
    async send({ to, replyTo, subject, text, html }) {
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
      } catch {
        return false;
      }
    },
  };
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
