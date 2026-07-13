import { shouldUseJson, printResult, printError } from "../output.js";
import { parseAgentId } from "../../normalize.js";
import { EXIT } from "../exit.js";
import { BindAgtError } from "../../errors.js";
import process from "node:process";

export async function cmdFastLane(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const isRegisterMode = args.includes("--register");
  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey) {
    printError("Authentication required. Set BINDAGT_API_KEY or run: bindagt login", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  let body: Record<string, unknown>;

  if (isRegisterMode) {
    const domainRaw = args.find((a) => !a.startsWith("-"));
    if (!domainRaw) {
      printError("Usage: bindagt fast-lane --register <domain>", isJson);
      process.exit(EXIT.INVALID_INPUT);
    }
    body = { mode: "registerRoot", domain: domainRaw.toLowerCase() };
  } else {
    const agentIdRaw = args.find((a) => !a.startsWith("-"));
    if (!agentIdRaw) {
      printError("Usage: bindagt fast-lane agt://domain/path", isJson);
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
    body = { mode: "anchorAgent", domain, agentPath: path };
  }

  if (!isJson) {
    console.log("\n→ Fast Lane: gas×1.5, 10 min window...");
  }

  try {
    const res = await fetch(`${apiUrl}/fast-lane`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 402) {
      printError("Payment required. Fast Lane requires available balance.", isJson);
      process.exit(EXIT.PAYMENT_REQUIRED);
    }
    if (!res.ok) {
      const resBody = (await res.json()) as Record<string, unknown>;
      printError(String(resBody["message"] ?? `HTTP ${res.status}`), isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }

    const resBody = (await res.json()) as Record<string, unknown>;
    printResult(resBody, isJson);
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
