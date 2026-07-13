import { shouldUseJson, printResult, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";

export async function cmdSlotsList(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey) {
    printError("Authentication required. Set BINDAGT_API_KEY or run: bindagt login", isJson);
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
    const slots = profile["slots"] as Record<string, unknown> | undefined;
    const available = Number(slots?.["available"] ?? 0);
    const total = Number(slots?.["total"] ?? 0);
    const used = Number(slots?.["used"] ?? 0);

    if (isJson) {
      printResult({ available, total, used }, true);
    } else {
      console.log(`\n  Slots available:  ${available}`);
      console.log(`  Slots used:       ${used}`);
      console.log(`  Slots total:      ${total}`);
      if (available === 0) {
        console.log("\n  No available slots. Run: bindagt buy-slots <n>\n");
      }
    }
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
