import { keccak256, encodePacked } from "viem";
import { normalizeDomain, validatePath } from "./normalize.js";
import { BindAgtError } from "./errors.js";
import type { VerifyLocalResult } from "./types.js";

interface AgtDocument {
  agent_id?: string;
  agent_type?: string;
  domain?: string;
  verification?: {
    onchain_hash?: string;
    anchored_at?: string;
    issuer_address?: string;
  };
  [key: string]: unknown;
}

/**
 * Verifies the hash integrity of an AGT-9303 document without any network call.
 * §5.3 DX_Spec: confirms that onchain_hash is correctly derived from domain + path.
 * Does NOT confirm the agent is active on L1 — use verify() or verifyOnChain() for that.
 */
export async function verifyLocal(doc: unknown): Promise<VerifyLocalResult> {
  if (typeof doc !== "object" || doc === null) {
    return { valid: false, reason: "Document is not an object" };
  }

  const d = doc as AgtDocument;

  const agentId = d["agent_id"];
  if (typeof agentId !== "string" || !agentId.startsWith("agt://")) {
    return { valid: false, reason: "Missing or invalid agent_id field" };
  }

  const onchainHash = d["verification"]?.["onchain_hash"];
  if (typeof onchainHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(onchainHash)) {
    return { valid: false, reason: "Missing or invalid verification.onchain_hash" };
  }

  // Parse agt://domain/path
  const rest = agentId.slice(6);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1 || slashIdx === 0 || slashIdx === rest.length - 1) {
    return { valid: false, reason: `Malformed agent_id: "${agentId}"` };
  }

  const rawDomain = rest.slice(0, slashIdx);
  const rawPath = rest.slice(slashIdx + 1);

  let domain: string;
  try {
    domain = normalizeDomain(rawDomain);
  } catch {
    return { valid: false, reason: `Invalid domain in agent_id: "${rawDomain}"` };
  }

  const isEphemeral = d["agent_type"] === "ephemeral";
  let path: string;
  try {
    path = validatePath(rawPath, isEphemeral);
  } catch (err) {
    const msg = err instanceof BindAgtError ? err.message : String(err);
    return { valid: false, reason: msg };
  }

  // Compute expected hash: keccak256(abi.encodePacked(domainHash, path))
  const domainHash = keccak256(encodePacked(["string"], [domain]));
  const expectedHash = keccak256(encodePacked(["bytes32", "string"], [domainHash, path]));

  const match = expectedHash.toLowerCase() === onchainHash.toLowerCase();
  if (!match) {
    return {
      valid: false,
      reason: `Hash mismatch: computed ${expectedHash}, document has ${onchainHash}`,
    };
  }

  return { valid: true, reason: "Hash matches" };
}
