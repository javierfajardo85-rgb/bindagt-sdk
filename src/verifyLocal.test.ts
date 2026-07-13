import { describe, it, expect } from "vitest";
import { verifyLocal } from "./verifyLocal.js";
import { computeAgentHash } from "./verify.js";
import { keccak256, encodePacked } from "viem";

// Helper: build a minimal AGT-9303-shaped doc with a correct onchain_hash
function makeDoc(domain: string, path: string, agentType = "public"): object {
  const domainHash = keccak256(encodePacked(["string"], [domain]));
  const agentHash = computeAgentHash(domain, path);
  return {
    agent_id: `agt://${domain}/${path}`,
    agent_type: agentType,
    domain,
    path,
    verification: {
      onchain_hash: agentHash,
      domain_hash: domainHash,
    },
  };
}

// ── T-407 / T-409 / T-410 ─────────────────────────────────────────────────────

describe("verifyLocal", () => {
  // T-410: verifyLocal never requires network
  it("verifies a correct document offline (T-410)", async () => {
    const doc = makeDoc("example.com", "my-agent");
    const result = await verifyLocal(doc);
    expect(result.valid).toBe(true);
  });

  // T-407: any key type (hash is key-type agnostic)
  it("accepts document with any keyType (hash is key-type agnostic)", async () => {
    const doc = makeDoc("example.com", "agent-p256");
    const result = await verifyLocal(doc);
    expect(result.valid).toBe(true);
  });

  it("returns valid: false for tampered onchain_hash (T-409)", async () => {
    const doc = makeDoc("example.com", "my-agent");
    const tampered = {
      ...doc,
      verification: {
        ...(doc as { verification: object }).verification,
        onchain_hash: "0x" + "00".repeat(32),
      },
    };
    const result = await verifyLocal(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("returns valid: false for mismatched domain in agent_id vs hash", async () => {
    // Build hash for example.com/my-agent, but claim agent_id is other.com/my-agent
    const agentHash = computeAgentHash("example.com", "my-agent");
    const tampered = {
      agent_id: "agt://other.com/my-agent",
      agent_type: "public",
      verification: { onchain_hash: agentHash },
    };
    const result = await verifyLocal(tampered);
    expect(result.valid).toBe(false);
  });

  it("does not throw on empty object — returns valid: false (T-409)", async () => {
    const result = await verifyLocal({});
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("does not throw on null — returns valid: false", async () => {
    const result = await verifyLocal(null);
    expect(result.valid).toBe(false);
  });

  it("handles IDN domain correctly (T-106 analogue)", async () => {
    // normalizeDomain converts münchen.de → xn--mnchen-3ya.de
    const punyDomain = "xn--mnchen-3ya.de";
    const doc = makeDoc(punyDomain, "agent");
    const result = await verifyLocal(doc);
    expect(result.valid).toBe(true);
  });

  it("validates hash correctly for ephemeral agent path", async () => {
    const doc = makeDoc("example.com", "session/abc123", "ephemeral");
    const result = await verifyLocal(doc);
    expect(result.valid).toBe(true);
  });

  // Lines 43-45: malformed agent_id — trailing slash (empty path segment)
  it("returns valid:false for agent_id with trailing slash (empty path)", async () => {
    const result = await verifyLocal({
      agent_id: "agt://example.com/",
      agent_type: "public",
      verification: { onchain_hash: "0x" + "ab".repeat(32) },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/malformed/i);
  });

  // Lines 53-55: normalizeDomain throws for bare TLD
  it("returns valid:false when domain in agent_id has no TLD dot", async () => {
    const result = await verifyLocal({
      agent_id: "agt://nodot/my-agent",
      agent_type: "public",
      verification: { onchain_hash: "0x" + "ab".repeat(32) },
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/domain/i);
  });

  // Lines 62-64: validatePath throws for invalid path
  it("returns valid:false when path in agent_id is invalid (starts with hyphen)", async () => {
    const result = await verifyLocal({
      agent_id: "agt://example.com/-bad-path",
      agent_type: "public",
      verification: { onchain_hash: "0x" + "ab".repeat(32) },
    });
    expect(result.valid).toBe(false);
  });

  // Lines 36-38: missing or malformed onchain_hash
  it("returns valid:false when onchain_hash is missing", async () => {
    const result = await verifyLocal({
      agent_id: "agt://example.com/my-agent",
      agent_type: "public",
      verification: {},
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/onchain_hash/i);
  });

  it("returns valid:false when onchain_hash is wrong length", async () => {
    const result = await verifyLocal({
      agent_id: "agt://example.com/my-agent",
      agent_type: "public",
      verification: { onchain_hash: "0xdeadbeef" },
    });
    expect(result.valid).toBe(false);
  });
});
