export { verify, computeAgentHash } from "./verify.js";
export { verifyOnChain } from "./verifyOnChain.js";
export { verifyLocal } from "./verifyLocal.js";
export { BindAgtError } from "./errors.js";
export { parseAgentId, normalizeDomain, validatePath } from "./normalize.js";
export type {
  VerifyResult,
  VerifyLocalResult,
  VerifyOptions,
  VerifyOnChainOptions,
  DomainStatusLabel,
} from "./types.js";
