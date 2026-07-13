import { verify } from "../../verify.js";
import { verifyOnChain } from "../../verifyOnChain.js";
import { shouldUseJson, printResult, printError } from "../output.js";
import { BindAgtError } from "../../errors.js";
import { EXIT } from "../exit.js";
import process from "node:process";

export async function cmdVerify(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const agentIdOrHash = args.find((a) => !a.startsWith("-"));

  if (!agentIdOrHash) {
    printError("Usage: bindagt verify <agt-id|hash> [--onchain]", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const onchain = args.includes("--onchain") || args.includes("--l1");
  const apiUrl = process.env["BINDAGT_API_URL"];
  const apiKey = process.env["BINDAGT_API_KEY"];

  try {
    const result = onchain
      ? await verifyOnChain(agentIdOrHash, {
          ...(process.env["BINDAGT_RPC_URL"] ? { rpcUrl: process.env["BINDAGT_RPC_URL"] } : {}),
        })
      : await verify(agentIdOrHash, {
          ...(apiUrl ? { apiUrl } : {}),
          ...(apiKey ? { apiKey } : {}),
        });

    printResult(result, isJson, result.valid ? `✓ VERIFIED — ${result.agentId}` : undefined);

    if (!result.valid) {
      process.exit(EXIT.NOT_FOUND);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printError(msg, isJson);
    process.exit(err instanceof BindAgtError ? EXIT.GENERAL_ERROR : EXIT.GENERAL_ERROR);
  }
}
