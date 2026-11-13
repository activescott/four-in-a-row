import pino, { type DestinationStream } from "pino";

// JSON to stdout, one `event` name per line. Logs carry user ids, never emails.
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
