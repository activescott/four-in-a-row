import nodemailer, { type SendMailOptions } from "nodemailer";
import { expect, test } from "vitest";
import { CaptureMailer, createSmtpMailer, type Mail } from "./mailer.server";

const mail: Mail = {
  kind: "invite",
  to: "b@example.com",
  subject: "a invited you to play Four in a Row",
  text: "Open https://app.example/invite/t",
  html: "<p>Open</p>",
  link: "https://app.example/invite/t",
};

test("the SMTP mailer sends from FROM_EMAIL with the subject, text and HTML", async () => {
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
      from: "noreply@example.com",
      to: "b@example.com",
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    },
  ]);
});

test("the SMTP mailer answers false instead of throwing when the send fails", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  transport.sendMail = (async () => {
    throw new Error("connection refused");
  }) as typeof transport.sendMail;
  const mailer = createSmtpMailer({ transport, from: "noreply@example.com" });

  expect(await mailer.send(mail)).toBe(false);
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
