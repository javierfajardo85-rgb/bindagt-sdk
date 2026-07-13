import { shouldUseJson, printResult, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";

export async function cmdList(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey) {
    printError("Authentication required. Run: bindagt login", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  try {
    const res = await fetch(`${apiUrl}/users/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (res.status === 401) {
      printError("Invalid API key. Run: bindagt login", isJson);
      process.exit(EXIT.AUTH_REQUIRED);
    }
    if (!res.ok) {
      printError(`API error: HTTP ${res.status}`, isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }

    const profile = (await res.json()) as Record<string, unknown>;
    printResult(profile, isJson);
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
