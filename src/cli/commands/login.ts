import { shouldUseJson, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";
import * as readline from "node:readline";

export async function cmdLogin(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");

  // Headless: if BINDAGT_API_KEY is set, verify it works
  if (process.env["BINDAGT_API_KEY"]) {
    if (!isJson) console.log("Using BINDAGT_API_KEY from environment.");
    return;
  }

  if (isCI) {
    printError("Set BINDAGT_API_KEY for headless authentication", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const email = await new Promise<string>((resolve) => {
    rl.question("Email: ", (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });

  if (!email) {
    printError("Email is required", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  try {
    const res = await fetch(`${apiUrl}/auth/magic-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (!res.ok) {
      printError(`Failed to send magic link: HTTP ${res.status}`, isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }

    if (!isJson) {
      console.log(`\n→ Magic link sent to ${email}`);
      console.log("  Click the link in your inbox to authenticate.\n");
    }
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
