import { shouldUseJson, printResult, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";

export async function cmdBuySlots(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const nStr = args.find((a) => !a.startsWith("-"));
  const n = nStr ? parseInt(nStr, 10) : NaN;

  if (!nStr || isNaN(n) || n < 1) {
    printError(
      "Usage: bindagt buy-slots <n>\n  Note: Slots activate as Public or Private — you choose at activation. Type is fixed in v1.",
      isJson
    );
    process.exit(EXIT.INVALID_INPUT);
  }

  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey) {
    printError("Authentication required. Set BINDAGT_API_KEY or run: bindagt login", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  try {
    const res = await fetch(`${apiUrl}/slots/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ quantity: n }),
    });

    if (!res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      printError(String(body["message"] ?? `HTTP ${res.status}`), isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }

    const body = (await res.json()) as Record<string, unknown>;

    if (!isJson) {
      const checkoutUrl = body["checkoutUrl"];
      if (typeof checkoutUrl === "string") {
        console.log(`\n→ Opening browser for payment...`);
        const { default: open } = await import("open").catch(() => ({ default: null })) as { default: ((u: string) => Promise<void>) | null };
        if (open) await open(checkoutUrl);
        else console.log(`  ${checkoutUrl}`);
      }
    } else {
      printResult(body, true);
    }
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
