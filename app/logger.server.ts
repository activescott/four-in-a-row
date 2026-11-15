import pino, { type DestinationStream } from "pino";

// JSON to stdout, one `event` name per line. Logs carry user ids, never emails:
// `email` fields are removed, and text from outside (a relay's refusal) is
// scrubbed by whoever logs it.
export function createLogger(destination?: DestinationStream) {
  return pino(
    {
      base: undefined,
      redact: { paths: ["email", "*.email"], remove: true },
    },
    destination,
  );
}

export const logger = createLogger();
export type Logger = ReturnType<typeof createLogger>;
