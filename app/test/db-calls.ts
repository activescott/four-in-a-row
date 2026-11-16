import type { PrismaClient } from "../generated/prisma/client";

/**
 * A client that records every query it runs, model calls and raw SQL alike,
 * as "Model.operation" or the SQL text with its values left out. Two sends
 * that did the same work leave the same list, whatever the address was.
 */
export function recordDbCalls(db: PrismaClient) {
  const calls: string[] = [];
  const watched = db.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        const sql = (args as { strings?: readonly string[] } | undefined)
          ?.strings;
        calls.push(
          sql
            ? `${operation} ${sql.join("?").replace(/\s+/g, " ").trim()}`
            : `${model}.${operation}`,
        );
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
  return { db: watched, calls };
}

/** A client whose `fail` query throws, as a database that went away would. */
export function failingDb(
  db: PrismaClient,
  fail: (call: { model?: string; operation: string; sql?: string }) => boolean,
) {
  return db.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        const sql = (
          args as { strings?: readonly string[] } | undefined
        )?.strings?.join("?");
        if (fail({ model, operation, sql })) {
          throw new Error("connection terminated unexpectedly");
        }
        return query(args);
      },
    },
  }) as unknown as PrismaClient;
}
