import { domainToASCII } from "node:url";
import { BindAgtError } from "./errors.js";

// §5 DX_Spec: path regex for non-ephemeral agents (DNS hostname rules, max 63 chars)
const PATH_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
// §5.3: ephemeral agent paths allow internal slashes, max 129 chars total
const PATH_EPHEMERAL_RE = /^[a-z0-9][a-z0-9\-/]{0,127}[a-z0-9]$/;

/**
 * Normalises a domain name to Punycode ASCII lowercase.
 * "Apple.COM" → "apple.com", "münchen.de" → "xn--mnchen-3ya.de"
 * Throws BindAgtError('INVALID_DOMAIN') on invalid input.
 */
export function normalizeDomain(rawDomain: string): string {
  // Strip DNS trailing dot before processing
  const stripped = rawDomain.endsWith(".") ? rawDomain.slice(0, -1) : rawDomain;
  const lower = stripped.toLowerCase();
  if (!lower) {
    throw new BindAgtError("INVALID_DOMAIN", `Invalid domain: "${rawDomain}"`);
  }
  const ascii = domainToASCII(lower);
  if (!ascii || ascii === "") {
    throw new BindAgtError("INVALID_DOMAIN", `Invalid domain: "${rawDomain}"`);
  }
  // Reject bare TLDs (must contain at least one dot — "com" is invalid, "example.com" is valid)
  if (!ascii.includes(".")) {
    throw new BindAgtError(
      "INVALID_DOMAIN",
      `Domain must have at least one label and a TLD: "${rawDomain}"`
    );
  }
  return ascii;
}

/**
 * Validates a path string against the canonical regex.
 * Normalises to lowercase. Throws BindAgtError('INVALID_PATH') on failure.
 */
export function validatePath(path: string, isEphemeral = false): string {
  const lower = path.toLowerCase();
  const re = isEphemeral ? PATH_EPHEMERAL_RE : PATH_RE;
  if (!re.test(lower)) {
    throw new BindAgtError(
      "INVALID_PATH",
      `Invalid path "${path}". Must match ${re.source}`,
      { path, isEphemeral }
    );
  }
  return lower;
}

/**
 * Parses and normalises an AGT-9303 agent identifier "agt://domain/path".
 */
export function parseAgentId(agentId: string): { domain: string; path: string } {
  if (!agentId.startsWith("agt://")) {
    throw new BindAgtError(
      "INVALID_AGENT_ID",
      `Agent ID must start with "agt://": "${agentId}"`
    );
  }
  const rest = agentId.slice(6);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1 || slashIdx === 0 || slashIdx === rest.length - 1) {
    throw new BindAgtError(
      "INVALID_AGENT_ID",
      `Agent ID must be agt://domain/path: "${agentId}"`
    );
  }

  const rawDomain = rest.slice(0, slashIdx);
  const rawPath = rest.slice(slashIdx + 1);

  const domain = normalizeDomain(rawDomain);
  // Auto-detect ephemeral: path contains a slash (e.g. "session/abc123")
  const isEphemeral = rawPath.includes("/");
  const path = validatePath(rawPath, isEphemeral);
  return { domain, path };
}
