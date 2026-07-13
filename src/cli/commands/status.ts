import { verify } from "../../verify.js";
import { shouldUseJson, printResult, printError } from "../output.js";
import { BindAgtError } from "../../errors.js";
import { EXIT } from "../exit.js";
import process from "node:process";

const WATCH_INTERVAL_MS = 10_000;

export async function cmdStatus(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const watchMode = args.includes("--watch");
  const waitUntilFlag = args.indexOf("--wait-until");
  const waitUntilState = waitUntilFlag !== -1 ? args[waitUntilFlag + 1] : null;
  const timeoutFlag = args.indexOf("--timeout");
  const timeoutSec =
    timeoutFlag !== -1 ? parseInt(args[timeoutFlag + 1] ?? "300", 10) : 300;

  const agentIdOrHash = args.find((a) => !a.startsWith("-"));

  if (!agentIdOrHash) {
    printError("Usage: bindagt status <agt-id> [--watch] [--wait-until active] [--timeout 300]", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const apiUrl = process.env["BINDAGT_API_URL"];
  const apiKey = process.env["BINDAGT_API_KEY"];

  async function checkOnce(): Promise<{ done: boolean }> {
    const result = await verify(agentIdOrHash!, {
      ...(apiUrl ? { apiUrl } : {}),
      ...(apiKey ? { apiKey } : {}),
    });

    printResult(result, isJson);

    if (waitUntilState && result.domainStatus === waitUntilState) {
      return { done: true };
    }
    return { done: false };
  }

  if (!watchMode && !waitUntilState) {
    await checkOnce();
    return;
  }

  // Watch / wait-until mode
  const deadline = Date.now() + timeoutSec * 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const { done } = await checkOnce();
      if (done) return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printError(msg, isJson);
    }

    if (Date.now() + WATCH_INTERVAL_MS >= deadline) {
      if (waitUntilState) {
        printError(
          `Timeout: agent did not reach state "${waitUntilState}" within ${timeoutSec}s`,
          isJson
        );
        process.exit(EXIT.ORACLE_UNAVAILABLE);
      }
      return;
    }

    await new Promise<void>((resolve) => setTimeout(resolve, WATCH_INTERVAL_MS));
  }
}
