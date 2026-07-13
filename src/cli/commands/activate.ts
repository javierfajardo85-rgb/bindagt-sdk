import { shouldUseJson, printResult, printError } from "../output.js";
import { parseAgentId } from "../../normalize.js";
import { EXIT } from "../exit.js";
import { BindAgtError } from "../../errors.js";
import process from "node:process";

export async function cmdActivate(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const agentIdRaw = args.find((a) => !a.startsWith("-"));

  if (!agentIdRaw) {
    printError(
      "Usage: bindagt activate agt://domain/path [--public|--private]\n  Default: --private. Type is fixed in v1.",
      isJson
    );
    process.exit(EXIT.INVALID_INPUT);
  }

  let domain: string, path: string;
  try {
    ({ domain, path } = parseAgentId(agentIdRaw));
  } catch (err) {
    const msg = err instanceof BindAgtError ? err.message : String(err);
    printError(msg, isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const isPublic = args.includes("--public");
  const agentType = isPublic ? "public" : "private";

  if (!isJson && !isCI) {
    console.log(`  Note: Type is fixed in v1. To change type later → create a new agent (consumes 1 slot + gas).`);
  }

  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey) {
    printError("Authentication required. Set BINDAGT_API_KEY or run: bindagt login", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  try {
    const res = await fetch(`${apiUrl}/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ domain, agentPath: path, agentType }),
    });

    if (res.status === 402) {
      printError("No available slots. Run: bindagt buy-slots <n>", isJson);
      process.exit(EXIT.PAYMENT_REQUIRED);
    }
    if (res.status === 401 || res.status === 403) {
      printError("Invalid API key. Run: bindagt login", isJson);
      process.exit(EXIT.AUTH_REQUIRED);
    }

    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      printError(String(body["message"] ?? `HTTP ${res.status}`), isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }

    printResult(body, isJson);
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
