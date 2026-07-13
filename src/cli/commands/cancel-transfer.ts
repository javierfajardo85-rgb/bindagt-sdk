import { shouldUseJson, printResult, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";

export async function cmdCancelTransfer(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const domain = args.find((a) => !a.startsWith("-"));

  if (!domain) {
    printError("Usage: bindagt cancel-transfer <domain>", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey) {
    printError("Authentication required. Set BINDAGT_API_KEY or run: bindagt login", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  // Step 1: Fetch cancelNonce from the backend (reads L1 getCancelNonce(domainHash))
  let cancelNonce: string;
  try {
    const res = await fetch(
      `${apiUrl}/domains/${encodeURIComponent(domain)}/cancel-nonce`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!res.ok) {
      printError(`Failed to fetch cancelNonce: HTTP ${res.status}`, isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }
    const body = (await res.json()) as Record<string, unknown>;
    cancelNonce = String(body["cancelNonce"] ?? "");
  } catch (err) {
    printError(`Network error fetching cancelNonce: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }

  if (!isJson) {
    console.log(`\n→ cancelNonce: ${cancelNonce}`);
    console.log("→ Sign with your controlKey (Passkey or local key)...");
  }

  // Step 2: Submit the veto (backend constructs EIP-712 message and submits to L1)
  try {
    const res = await fetch(`${apiUrl}/domains/${encodeURIComponent(domain)}/cancel-transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ cancelNonce }),
    });

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
