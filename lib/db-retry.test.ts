import { describe, expect, it } from "vitest";
import { isDroppedConnection, isUnreachable, retryable } from "./db-retry";

const prismaError = (code: string, message: string) => Object.assign(new Error(message), { code });

describe("database retry rules", () => {
  it("retries any operation when the database was never reached (nothing was sent)", () => {
    const unreachable = prismaError("P1001", "Can't reach database server at ep-x-pooler.neon.tech");
    expect(isUnreachable(unreachable)).toBe(true);
    expect(retryable("findMany", unreachable)).toBe(true);
    expect(retryable("create", unreachable)).toBe(true);
  });

  it("retries a dropped connection only for reads (a write may already have committed)", () => {
    const dropped = new Error("Connection terminated unexpectedly");
    expect(isDroppedConnection(dropped)).toBe(true);
    expect(retryable("findUnique", dropped)).toBe(true);
    expect(retryable("update", dropped)).toBe(false);
  });

  it("never retries real query errors", () => {
    const unique = prismaError("P2002", "Unique constraint failed on the fields: (`paypalEventId`)");
    expect(retryable("create", unique)).toBe(false);
    expect(retryable("findMany", unique)).toBe(false);
  });
});
