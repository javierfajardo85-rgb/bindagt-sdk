import { BindAgtError } from "../errors.js";

export const EXIT = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_INPUT: 2,
  AUTH_REQUIRED: 3,
  NOT_FOUND: 4,
  PAYMENT_REQUIRED: 5,
  ORACLE_UNAVAILABLE: 6,
  RATE_LIMITED: 7,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export function exitCode(err: unknown): ExitCode {
  if (!(err instanceof BindAgtError)) return EXIT.GENERAL_ERROR;
  switch (err.code) {
    case "INVALID_AGENT_ID":
    case "INVALID_DOMAIN":
    case "INVALID_PATH":
      return EXIT.INVALID_INPUT;
    case "UNAUTHORIZED":
      return EXIT.AUTH_REQUIRED;
    case "AGENT_NOT_FOUND":
      return EXIT.NOT_FOUND;
    case "RATE_LIMITED":
      return EXIT.RATE_LIMITED;
    case "ORACLE_UNAVAILABLE":
    case "NETWORK_ERROR":
      return EXIT.ORACLE_UNAVAILABLE;
    default:
      return EXIT.GENERAL_ERROR;
  }
}
