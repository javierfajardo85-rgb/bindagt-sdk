export type DomainStatusLabel =
  | "active"
  | "transfer_pending"
  | "suspended"
  | "expired"
  | "transferred"
  | "transfer_expired";

export interface VerifyResult {
  valid: boolean;
  agentId: string;
  domain: string;
  domainStatus: DomainStatusLabel;
  agentType: "public" | "private";
  anchoredAt?: string;
  issuer?: string;
  source: "api" | "l1";
  /** Propagated from X-Correlation-Id response header (T-531/T-708). */
  correlationId?: string;
}

export interface VerifyLocalResult {
  valid: boolean;
  reason: string;
}

export interface VerifyOptions {
  /** Override API base URL (default: https://api.bindagt.com/v1) */
  apiUrl?: string;
  /** API key for higher rate limits */
  apiKey?: string;
  /** Timeout in ms (default: 10_000) */
  timeoutMs?: number;
}

export interface VerifyOnChainOptions {
  /** RPC URL override — defaults to public Sepolia endpoint */
  rpcUrl?: string;
  /** Timeout in ms (default: 10_000) */
  timeoutMs?: number;
  /** Contract address override */
  contractAddress?: `0x${string}`;
}
