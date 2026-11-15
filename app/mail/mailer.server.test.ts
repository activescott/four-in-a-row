import nodemailer, { type SendMailOptions } from "nodemailer";
import { expect, test } from "vitest";
import { createLogger, type Logger } from "../logger.server";
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
    throw Object.assign(
      new Error("550 5.7.1 <B@example.com>: Relay access denied"),
      {
        code: "EENVELOPE",
        responseCode: 550,
        command: "RCPT TO",
      },
    );
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
      message: "550 5.7.1 <[redacted]>: Relay access denied",
    }),
  ]);
  const logged = JSON.stringify(log.lines);
  expect(logged).not.toContain("secret-token");
  expect(logged).not.toContain("482913");
  expect(logged).not.toContain("b@example.com");
});

async function failWith(
  error: unknown,
  to = "b@example.com",
  link = "https://app.example/verify?token=secret-token",
) {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  transport.sendMail = (async () => {
    throw error;
  }) as typeof transport.sendMail;
  const log = logCapture();
  const mailer = createSmtpMailer({
    transport,
    from: "noreply@example.com",
    logger: createLogger(log.destination),
  });
  const result = await mailer.send({ ...mail, kind: "signin", to, link });
  return { result, events: log.events("email.send.failed"), log };
}

test("the logged relay message is scrubbed of the link, URLs, addresses and digit runs", async () => {
  const link = "https://app.example/verify?token=secret-token";
  const relay = [
    `550 denied ${link} again`,
    "see http://other.example/x?t=abc123def for help",
    "code 482913",
    "for B@EXAMPLE.COM",
    'for "Bee" <b@example.com>',
    "for [b@example.com]",
    "for user b",
    "for a+b@x.com",
    "plus someone.else@elsewhere.org",
  ].join(" ");
  const { result, events } = await failWith(
    new Error(relay),
    "b@example.com",
    link,
  );

  expect(result).toBe(false);
  const message = String((events[0] as { message: unknown }).message);
  for (const secret of [
    "secret-token",
    "app.example",
    "other.example",
    "abc123def",
    "482913",
    "example.com",
    "EXAMPLE",
    "a+b",
    "x.com",
    "elsewhere",
    "someone",
  ]) {
    expect(message).not.toContain(secret);
  }
  expect(message).not.toMatch(/\bb\b/);
});

test("the logged relay message stays readable and is one line of at most 200 characters", async () => {
  const plain = await failWith(new Error("550 5.7.1 Relay access denied"));
  expect(plain.events[0]).toMatchObject({
    message: "550 5.7.1 Relay access denied",
  });

  const long = await failWith(
    new Error(`Relay access denied\nsecond line\n${"x".repeat(500)}`),
  );
  expect(long.events[0]).toMatchObject({ message: "Relay access denied" });

  const huge = await failWith(new Error("y".repeat(500)));
  expect(String((huge.events[0] as { message: unknown }).message)).toHaveLength(
    200,
  );
});

test("only a string code and command and a number responseCode are logged", async () => {
  const { events } = await failWith(
    Object.assign(new Error("nope"), {
      code: { secret: "a" },
      command: 5,
      responseCode: "550",
    }),
  );
  expect(events[0]).not.toHaveProperty("code");
  expect(events[0]).not.toHaveProperty("command");
  expect(events[0]).not.toHaveProperty("responseCode");
});

test.each([
  [null],
  [undefined],
  ["boom"],
  [42],
  [{ message: { toString: 1 } }],
])(
  "send answers false and logs once when the relay throws %j",
  async (thrown) => {
    const { result, events } = await failWith(thrown);
    expect(result).toBe(false);
    expect(events).toHaveLength(1);
  },
);

test("send answers false when the message cannot be turned into a string", async () => {
  const hostile = { message: Object.create(null) };
  const { result } = await failWith(hostile);
  expect(result).toBe(false);
});

test("send answers false when the logger itself throws", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  transport.sendMail = (async () => {
    throw new Error("refused");
  }) as typeof transport.sendMail;
  const logger = {
    error() {
      throw new Error("log sink down");
    },
  } as unknown as Logger;
  const mailer = createSmtpMailer({
    transport,
    from: "noreply@example.com",
    logger,
  });

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
