import { describe, it, expect } from "vitest";
import { normalizeDomain, validatePath, parseAgentId } from "./normalize.js";
import { BindAgtError } from "./errors.js";

// ── normalizeDomain ───────────────────────────────────────────────────────────

describe("normalizeDomain", () => {
  it("lowercases ASCII domain", () => {
    expect(normalizeDomain("Example.COM")).toBe("example.com");
  });

  it("strips trailing dot", () => {
    expect(normalizeDomain("example.com.")).toBe("example.com");
  });

  it("converts IDN to Punycode (T-106)", () => {
    expect(normalizeDomain("münchen.de")).toBe("xn--mnchen-3ya.de");
  });

  it("preserves already-punycode domain", () => {
    expect(normalizeDomain("xn--mnchen-3ya.de")).toBe("xn--mnchen-3ya.de");
  });

  it("throws INVALID_DOMAIN for empty string", () => {
    expect(() => normalizeDomain("")).toThrow(BindAgtError);
    expect(() => normalizeDomain("")).toThrow(
      expect.objectContaining({ code: "INVALID_DOMAIN" })
    );
  });

  it("throws INVALID_DOMAIN for bare TLD (no dot)", () => {
    expect(() => normalizeDomain("com")).toThrow(
      expect.objectContaining({ code: "INVALID_DOMAIN" })
    );
  });

  it("preserves subdomain structure when valid", () => {
    expect(normalizeDomain("sub.example.com")).toBe("sub.example.com");
  });

  it("throws INVALID_DOMAIN when domainToASCII returns empty (invalid punycode label)", () => {
    // "xn--" is an invalid Punycode label — domainToASCII("xn--") returns ""
    expect(() => normalizeDomain("xn--")).toThrow(
      expect.objectContaining({ code: "INVALID_DOMAIN" })
    );
  });
});

// ── validatePath ─────────────────────────────────────────────────────────────

describe("validatePath", () => {
  it("accepts valid non-ephemeral path", () => {
    expect(validatePath("my-agent")).toBe("my-agent");
    expect(validatePath("agent123")).toBe("agent123");
    expect(validatePath("ab")).toBe("ab");
  });

  it("normalises uppercase to lowercase (does not throw)", () => {
    // validatePath normalises case — uppercase input returns lowercase, not error
    expect(validatePath("MyAgent")).toBe("myagent");
  });

  it("rejects path starting with hyphen", () => {
    expect(() => validatePath("-agent")).toThrow(
      expect.objectContaining({ code: "INVALID_PATH" })
    );
  });

  it("rejects path ending with hyphen", () => {
    expect(() => validatePath("agent-")).toThrow(
      expect.objectContaining({ code: "INVALID_PATH" })
    );
  });

  it("rejects single-character path", () => {
    expect(() => validatePath("a")).toThrow(
      expect.objectContaining({ code: "INVALID_PATH" })
    );
  });

  it("rejects path exceeding 63 chars (non-ephemeral)", () => {
    const long = "a" + "b".repeat(62) + "c"; // 64 chars
    expect(() => validatePath(long)).toThrow(
      expect.objectContaining({ code: "INVALID_PATH" })
    );
  });

  it("accepts max-length non-ephemeral path (63 chars)", () => {
    const path = "a" + "b".repeat(61) + "c"; // 63 chars
    expect(validatePath(path)).toBe(path);
  });

  it("accepts ephemeral path with slashes", () => {
    expect(validatePath("session/abc123", true)).toBe("session/abc123");
  });

  it("rejects non-ephemeral path with slash (slash not allowed)", () => {
    expect(() => validatePath("session/abc123")).toThrow(
      expect.objectContaining({ code: "INVALID_PATH" })
    );
  });

  it("rejects ephemeral path exceeding 129 chars", () => {
    // PATH_EPHEMERAL_RE allows ^[a-z0-9][a-z0-9\-/]{0,127}[a-z0-9]$ → max 129 chars
    const long = "a/" + "b".repeat(127) + "c"; // 131 chars, body 127+2 = 129... let's be precise
    const tooLong = "a" + "/b".repeat(65) + "c"; // > 129
    expect(() => validatePath(tooLong, true)).toThrow(
      expect.objectContaining({ code: "INVALID_PATH" })
    );
  });
});

// ── parseAgentId ──────────────────────────────────────────────────────────────

describe("parseAgentId", () => {
  it("parses agt://domain/path correctly", () => {
    const result = parseAgentId("agt://example.com/my-agent");
    expect(result.domain).toBe("example.com");
    expect(result.path).toBe("my-agent");
  });

  it("normalises domain to lowercase", () => {
    const result = parseAgentId("agt://Example.COM/agent");
    expect(result.domain).toBe("example.com");
  });

  it("parses ephemeral path with slashes (auto-detected)", () => {
    const result = parseAgentId("agt://example.com/session/abc123");
    expect(result.domain).toBe("example.com");
    expect(result.path).toBe("session/abc123");
  });

  it("throws INVALID_AGENT_ID for missing agt:// prefix", () => {
    expect(() => parseAgentId("https://example.com/agent")).toThrow(
      expect.objectContaining({ code: "INVALID_AGENT_ID" })
    );
  });

  it("throws INVALID_AGENT_ID for missing path separator", () => {
    expect(() => parseAgentId("agt://example.com")).toThrow(
      expect.objectContaining({ code: "INVALID_AGENT_ID" })
    );
  });

  it("throws INVALID_AGENT_ID for empty string", () => {
    expect(() => parseAgentId("")).toThrow(
      expect.objectContaining({ code: "INVALID_AGENT_ID" })
    );
  });
});
