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

  // API returns the AGT-9303 document directly (no wrapper): {identity,
  // verification} per AGT-9303_Standard.md §4.2-4.3. 0.1.0 parsed a flat
  // shape that only ever matched @bindagt/mock-server's old (also wrong)
  // format — see Guia_Ejecucion_Fases_AGT9303_Plugin.md Parte 3 for the
  // full history of this bug.
  // Guard: body may be null if the response wasn't valid JSON (JSON parse catch above).
  const doc = (body !== null && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const identity = (doc["identity"] as Record<string, unknown> | undefined) ?? {};
  const verification = (doc["verification"] as Record<string, unknown> | undefined) ?? {};

  const agentIdStr = String(identity["agent_id"] ?? agentId);
  const domainStr = String(identity["domain"] ?? domain);
  const domainStatus = mapDomainStatus(String(verification["domain_status"] ?? "expired"));
  const agentType =
    identity["agent_type"] === "public" || identity["agent_type"] === "private"
      ? (identity["agent_type"] as "public" | "private")
      : "private";

  // identity.registered_at is unix seconds on the wire (§4.2); VerifyResult.
  // anchoredAt stays an ISO-8601 string — its own public contract is
  // unchanged in 0.2.0, only how it's parsed off the response.
  const registeredAt = identity["registered_at"];
  const anchoredAt =
    typeof registeredAt === "number"
      ? new Date(registeredAt * 1_000).toISOString()
      : undefined;
  const issuer =
    verification["issuer_address"] != null
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
