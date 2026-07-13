import { createPublicClient, http, keccak256, encodePacked } from "viem";
import { mainnet } from "viem/chains";
import { BindAgtError } from "./errors.js";
import { parseAgentId } from "./normalize.js";
import type { VerifyResult, VerifyOnChainOptions, DomainStatusLabel } from "./types.js";

// Public mainnet RPC — replaced by BINDAGT_RPC_URL env var or opts.rpcUrl
const DEFAULT_RPC_URL = "https://ethereum-rpc.publicnode.com";
// Deployed BindAgtRegistry on Ethereum mainnet (verified on Etherscan,
// deployed 2026-07-02, tx 0xd2adf6e9c7863ef776e962b9b21299f9e3ac49e81173c7a1933fb0973f76363e).
// Override with BINDAGT_CONTRACT_ADDRESS env var or opts.contractAddress
// (e.g. to point at Sepolia for internal QA).
const DEFAULT_CONTRACT = (process.env["BINDAGT_CONTRACT_ADDRESS"] ??
  "0x680db4533ef1fdc99bfedd441351d56012e0e7c9") as `0x${string}`;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "isValidAgent",
    inputs: [{ name: "agentHash", type: "bytes32" }],
    outputs: [
      { name: "valid", type: "bool" },
      { name: "rootStatus", type: "uint8" },
      { name: "rootHash", type: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "agents",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "agentHash", type: "bytes32" },
      { name: "rootHash", type: "bytes32" },
      { name: "anchoredAt", type: "uint64" },
      { name: "agentType", type: "uint8" },
    ],
    stateMutability: "view",
  },
] as const;

const ROOT_STATUS: Record<number, DomainStatusLabel> = {
  0: "active",
  1: "suspended",
  2: "expired",
  3: "transferred",
  4: "transfer_pending",
  5: "transfer_expired",
};

function computeAgentHash(domain: string, path: string): `0x${string}` {
  const domainHash = keccak256(encodePacked(["string"], [domain]));
  return keccak256(encodePacked(["bytes32", "string"], [domainHash, path]));
}

/**
 * Verifies an AGT-9303 agent directly on L1 (trustless, no BindAgt backend).
 * Accepts "agt://domain/path" or a raw 0x agentHash.
 */
export async function verifyOnChain(
  agentIdOrHash: string,
  opts: VerifyOnChainOptions = {}
): Promise<VerifyResult> {
  const rpcUrl = opts.rpcUrl ?? process.env["BINDAGT_RPC_URL"] ?? DEFAULT_RPC_URL;
  const contractAddress = opts.contractAddress ?? DEFAULT_CONTRACT;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  let agentHash: `0x${string}`;
  let domain = "";
  let path = "";
  let agentId: string;

  if (agentIdOrHash.startsWith("agt://")) {
    const parsed = parseAgentId(agentIdOrHash);
    domain = parsed.domain;
    path = parsed.path;
    agentHash = computeAgentHash(domain, path);
    agentId = agentIdOrHash;
  } else {
    if (!/^0x[0-9a-f]{64}$/i.test(agentIdOrHash)) {
      throw new BindAgtError(
        "INVALID_AGENT_ID",
        `Expected agt://domain/path or 0x<64hex>: "${agentIdOrHash}"`
      );
    }
    agentHash = agentIdOrHash.toLowerCase() as `0x${string}`;
    agentId = agentIdOrHash;
  }

  const client = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl, { timeout: timeoutMs }),
  });

  let isValidResult: readonly [boolean, number, `0x${string}`];
  let agentData: readonly [`0x${string}`, `0x${string}`, bigint, number];

  try {
    [isValidResult, agentData] = await Promise.all([
      client.readContract({
        address: contractAddress,
        abi: REGISTRY_ABI,
        functionName: "isValidAgent",
        args: [agentHash],
      }),
      client.readContract({
        address: contractAddress,
        abi: REGISTRY_ABI,
        functionName: "agents",
        args: [agentHash],
      }),
    ]);
  } catch (err) {
    throw new BindAgtError(
      "NETWORK_ERROR",
      `L1 read failed: ${String(err)}`,
      { cause: String(err) }
    );
  }

  const [valid, rootStatusCode] = isValidResult;
  const [, , anchoredAtBigInt, agentTypeCode] = agentData;

  // Zero hash means agent does not exist
  if (agentData[0] === "0x0000000000000000000000000000000000000000000000000000000000000000") {
    throw new BindAgtError("AGENT_NOT_FOUND", `Agent not found on L1: ${agentHash}`);
  }

  const domainStatus: DomainStatusLabel = ROOT_STATUS[rootStatusCode] ?? "expired";
  const agentType: "public" | "private" = agentTypeCode === 0 ? "public" : "private";
  const anchoredAt =
    anchoredAtBigInt > 0n
      ? new Date(Number(anchoredAtBigInt) * 1000).toISOString()
      : undefined;

  // Reconstruct agentId if we only had a hash
  const resolvedAgentId =
    domain && path ? `agt://${domain}/${path}` : agentId;

  return {
    valid,
    agentId: resolvedAgentId,
    domain: domain || agentHash,
    domainStatus,
    agentType,
    ...(anchoredAt !== undefined ? { anchoredAt } : {}),
    source: "l1",
  };
}
