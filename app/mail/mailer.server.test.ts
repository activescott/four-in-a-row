import nodemailer, { type SendMailOptions } from "nodemailer";
import { expect, test } from "vitest";
import { createLogger } from "../logger.server";
import { logCapture } from "../test/routes";
import { CaptureMailer, createSmtpMailer, type Mail } from "./mailer.server";

const mail: Mail = {
  kind: "invite",
  to: "b@example.com",
  subject: "a invited you to play Four in a Row",
  text: "Open https://app.example/invite/t",
  html: "<p>Open</p>",
  link: "https://app.example/invite/t",
};

test("the SMTP mailer sends as Four in a Row from FROM_EMAIL with the subject, text and HTML", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sent: unknown[] = [];
  const original = transport.sendMail.bind(transport);
  transport.sendMail = (async (options: SendMailOptions) => {
    sent.push(options);
    return original(options);
  }) as typeof transport.sendMail;
  const mailer = createSmtpMailer({ transport, from: "noreply@example.com" });

  expect(await mailer.send(mail)).toBe(true);
  expect(sent).toEqual([
    {
      from: { name: "Four in a Row", address: "noreply@example.com" },
      to: "b@example.com",
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
  ]);
});

test("the SMTP mailer sets Reply-To when the mail has one", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const sent: SendMailOptions[] = [];
  transport.sendMail = (async (options: SendMailOptions) => {
    sent.push(options);
  }) as unknown as typeof transport.sendMail;
  const mailer = createSmtpMailer({ transport, from: "noreply@example.com" });

  await mailer.send({ ...mail, replyTo: "alice@example.com" });

  expect(sent[0]?.replyTo).toBe("alice@example.com");
});

test("the SMTP mailer answers false instead of throwing when the send fails", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  transport.sendMail = (async () => {
    throw new Error("connection refused");
  }) as typeof transport.sendMail;
  const mailer = createSmtpMailer({ transport, from: "noreply@example.com" });

  expect(await mailer.send(mail)).toBe(false);
});

test("the SMTP mailer logs why the relay refused, without the link, code, body or full address", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  transport.sendMail = (async () => {
    throw Object.assign(new Error("550 5.7.1 Relay access denied"), {
      code: "EENVELOPE",
      responseCode: 550,
      command: "RCPT TO",
    });
  }) as typeof transport.sendMail;
  const log = logCapture();
  const mailer = createSmtpMailer({
    transport,
    from: "noreply@example.com",
    logger: createLogger(log.destination),
  });

  const signin = {
    ...mail,
    kind: "signin" as const,
    text: "Your code is 482913",
    link: "https://app.example/verify?token=secret-token",
  };
  expect(await mailer.send(signin)).toBe(false);

  expect(log.events("email.send.failed")).toEqual([
    expect.objectContaining({
      event: "email.send.failed",
      kind: "signin",
      code: "EENVELOPE",
      responseCode: 550,
      command: "RCPT TO",
      message: "550 5.7.1 Relay access denied",
    }),
  ]);
  const logged = JSON.stringify(log.lines);
  expect(logged).not.toContain("secret-token");
  expect(logged).not.toContain("482913");
  expect(logged).not.toContain("b@example.com");
});

test("the capture mailer keeps the last mail of each kind per address and sends nothing", async () => {
  const capture = new CaptureMailer();
  await capture.send(mail);
  await capture.send({ ...mail, link: "https://app.example/invite/t2" });
  await capture.send({ ...mail, kind: "turn", link: "https://app.example/g" });

  expect(capture.last("B@Example.com", "invite")?.link).toBe(
    "https://app.example/invite/t2",
  );
  expect(capture.last("b@example.com", "turn")?.link).toBe(
    "https://app.example/g",
  );
  expect(capture.last("c@example.com", "invite")).toBeNull();
  expect(capture.count("b@example.com", "invite")).toBe(2);
});
