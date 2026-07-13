import { shouldUseJson, printResult, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";

export async function cmdReactivate(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const domain = args.find((a) => !a.startsWith("-"));

  if (!domain) {
    printError("Usage: bindagt reactivate <domain>", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey) {
    printError("Authentication required. Set BINDAGT_API_KEY or run: bindagt login", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  if (!isJson) {
    console.log(`\n→ Reactivating ${domain} ($10)...`);
  }

  try {
    const res = await fetch(`${apiUrl}/domains/${encodeURIComponent(domain)}/reactivate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 402) {
      printError("Payment required to reactivate ($10).", isJson);
      process.exit(EXIT.PAYMENT_REQUIRED);
    }
    if (!res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      printError(String(body["message"] ?? `HTTP ${res.status}`), isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }

    const body = (await res.json()) as Record<string, unknown>;
    printResult(body, isJson);
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
