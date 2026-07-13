import { keccak256, encodePacked } from "viem";
import { BindAgtError } from "./errors.js";
import { parseAgentId } from "./normalize.js";
import type { VerifyResult, VerifyOptions, DomainStatusLabel } from "./types.js";

const DEFAULT_API_URL = "https://api.bindagt.com/v1";

export function computeAgentHash(domain: string, path: string): `0x${string}` {
  const domainHash = keccak256(encodePacked(["string"], [domain]));
  return keccak256(encodePacked(["bytes32", "string"], [domainHash, path]));
}

function mapDomainStatus(raw: string): DomainStatusLabel {
  const known: DomainStatusLabel[] = [
    "active",
    "transfer_pending",
    "suspended",
    "expired",
    "transferred",
    "transfer_expired",
  ];
  if ((known as string[]).includes(raw)) return raw as DomainStatusLabel;
  return "expired";
}

// Maps API error codes / HTTP status to BindAgtErrorCode
function mapHttpError(status: number, body: unknown): BindAgtError {
  const code =
    typeof body === "object" && body !== null && "code" in body
      ? String((body as { code: unknown }).code)
      : "";

  if (status === 401 || status === 403) {
    return new BindAgtError("UNAUTHORIZED", "Invalid or missing API key", { status });
  }
  if (status === 404 || code === "AGENT_NOT_FOUND") {
    return new BindAgtError("AGENT_NOT_FOUND", "Agent not found", { status });
  }
  if (status === 429) {
    return new BindAgtError("RATE_LIMITED", "Rate limit exceeded — retry later", { status });
  }
  if (status >= 500) {
    return new BindAgtError("ORACLE_UNAVAILABLE", "BindAgt API unavailable", { status });
  }
  return new BindAgtError("UNKNOWN", `Unexpected HTTP ${status}`, { status, body });
}

/**
 * Verifies an AGT-9303 agent identifier via the BindAgt API (fast path).
 * Accepts "agt://domain/path" or a raw 0x agentHash.
 */
export async function verify(
  agentId: string,
  opts: VerifyOptions = {}
): Promise<VerifyResult> {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  let hash: `0x${string}`;
  let domain: string;
  let path: string;

  if (agentId.startsWith("0x")) {
    // Raw hash — domain/path not known client-side
    if (!/^0x[0-9a-f]{64}$/i.test(agentId)) {
      throw new BindAgtError("INVALID_AGENT_ID", `Invalid agent hash: "${agentId}"`);
    }
    hash = agentId.toLowerCase() as `0x${string}`;
    domain = "";
    path = "";
  } else {
    const parsed = parseAgentId(agentId);
    domain = parsed.domain;
    path = parsed.path;
    hash = computeAgentHash(domain, path);
  }

  const url = `${apiUrl.replace(/\/$/, "")}/verify/${hash}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    throw new BindAgtError(
      "NETWORK_ERROR",
      isAbort ? "Request timed out" : `Network error: ${String(err)}`,
      { cause: String(err) }
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  const correlationId = res.headers.get("x-correlation-id") ?? undefined;

  // T-403: 404 → valid:false (no throw), all other errors throw
  if (res.status === 404) {
    return {
      valid: false,
      agentId: agentId,
      domain: domain,
      domainStatus: "expired",
      agentType: "private",
      source: "api",
      ...(correlationId !== undefined ? { correlationId } : {}),
    };
  }
  if (!res.ok) {
    throw mapHttpError(res.status, body);
  }

  // API returns the AGT-9303 document directly (no wrapper).
  // Guard: body may be null if the response wasn't valid JSON (JSON parse catch above).
  const doc = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const agentIdStr = String(doc["agent_id"] ?? agentId);
  const domainStr = String(doc["domain"] ?? domain);
  const domainStatus = mapDomainStatus(String(doc["domain_status"] ?? "expired"));
  const agentType =
    doc["agent_type"] === "public" || doc["agent_type"] === "private"
      ? (doc["agent_type"] as "public" | "private")
      : "private";

  const verification = doc["verification"] as Record<string, unknown> | undefined;
  const anchoredAt =
    verification?.["anchored_at"] != null
      ? String(verification["anchored_at"])
      : undefined;
  const issuer =
    verification?.["issuer_address"] != null
      ? String(verification["issuer_address"])
      : undefined;

  const valid = domainStatus === "active" || domainStatus === "transfer_pending";

  return {
    valid,
    agentId: agentIdStr,
    domain: domainStr,
    domainStatus,
    agentType,
    ...(anchoredAt !== undefined ? { anchoredAt } : {}),
    ...(issuer !== undefined ? { issuer } : {}),
    source: "api",
    ...(correlationId !== undefined ? { correlationId } : {}),
  };
}
