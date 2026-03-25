import { describe, it, expect } from "vitest";
import { createAuthHeader } from "../../../src/jira/auth.js";

describe("createAuthHeader", () => {
  it("produces a valid Basic auth header with base64-encoded credentials", () => {
    const header = createAuthHeader("user@example.com", "my-api-token");

    // "user@example.com:my-api-token" → base64
    const expectedBase64 = Buffer.from(
      "user@example.com:my-api-token",
    ).toString("base64");
    expect(header).toBe(`Basic ${expectedBase64}`);
  });

  it('starts with "Basic "', () => {
    const header = createAuthHeader("a@b.com", "tok");
    expect(header).toMatch(/^Basic /);
  });

  it("correctly encodes special characters", () => {
    const header = createAuthHeader("user+test@example.com", "p@ss:word/123");
    const decoded = Buffer.from(
      header.replace("Basic ", ""),
      "base64",
    ).toString();
    expect(decoded).toBe("user+test@example.com:p@ss:word/123");
  });
});
