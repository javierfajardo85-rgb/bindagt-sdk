export type BindAgtErrorCode =
  | "INVALID_AGENT_ID"
  | "INVALID_DOMAIN"
  | "INVALID_PATH"
  | "AGENT_NOT_FOUND"
  | "DOMAIN_SUSPENDED"
  | "DOMAIN_EXPIRED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "ORACLE_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "UNKNOWN";

export class BindAgtError extends Error {
  constructor(
    public readonly code: BindAgtErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "BindAgtError";
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BindAgtError);
    }
  }
}
