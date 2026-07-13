import { describe, it, expect } from "vitest";
import { BindAgtError, type BindAgtErrorCode } from "./errors.js";

// ── T-419 ─────────────────────────────────────────────────────────────────────

describe("BindAgtError", () => {
  it("extends Error", () => {
    const err = new BindAgtError("AGENT_NOT_FOUND", "Not found");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BindAgtError);
  });

  it("sets name to BindAgtError (T-419)", () => {
    const err = new BindAgtError("NETWORK_ERROR", "Timeout");
    expect(err.name).toBe("BindAgtError");
  });

  it("exposes code property (T-419)", () => {
    const codes: BindAgtErrorCode[] = [
      "INVALID_AGENT_ID",
      "INVALID_DOMAIN",
      "INVALID_PATH",
      "AGENT_NOT_FOUND",
      "DOMAIN_SUSPENDED",
      "DOMAIN_EXPIRED",
      "RATE_LIMITED",
      "NETWORK_ERROR",
      "ORACLE_UNAVAILABLE",
      "UNAUTHORIZED",
      "UNKNOWN",
    ];
    for (const code of codes) {
      const err = new BindAgtError(code, "test");
      expect(err.code).toBe(code);
    }
  });

  it("preserves message", () => {
    const msg = "Agent hash not found on L1";
    const err = new BindAgtError("AGENT_NOT_FOUND", msg);
    expect(err.message).toBe(msg);
  });

  it("attaches optional details", () => {
    const details = { agentHash: "0xabc", rpcUrl: "https://rpc.example.com" };
    const err = new BindAgtError("NETWORK_ERROR", "RPC error", details);
    expect(err.details).toStrictEqual(details);
  });

  it("details is undefined when not provided", () => {
    const err = new BindAgtError("UNKNOWN", "oops");
    expect(err.details).toBeUndefined();
  });

  it("captures stack trace", () => {
    const err = new BindAgtError("UNKNOWN", "test");
    expect(err.stack).toBeTruthy();
    expect(err.stack).toContain("BindAgtError");
  });
});
