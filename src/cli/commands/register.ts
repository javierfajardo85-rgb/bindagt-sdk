import { shouldUseJson, printResult, printError } from "../output.js";
import { parseAgentId } from "../../normalize.js";
import { EXIT } from "../exit.js";
import { BindAgtError } from "../../errors.js";
import { loadControlKey } from "./key.js";
import process from "node:process";

export async function cmdRegister(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const agentIdRaw = args.find((a) => !a.startsWith("-"));
  const fastLane = args.includes("--fast-lane");

  if (!agentIdRaw) {
    printError("Usage: bindagt register agt://domain/path [--fast-lane]", isJson);
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

  const apiUrl = (process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1").replace(/\/$/, "");
  const apiKey = process.env["BINDAGT_API_KEY"];

  if (!apiKey && isCI) {
    printError("Set BINDAGT_API_KEY for headless registration", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  // The contract requires a controlKey (public key) + keyType at registration
  // time — pulled from the local key file created by `bindagt key generate`.
  const { controlKey, keyType } = await loadControlKey(isCI, isJson);

  // In interactive mode, collect email if not provided
  let email = args.find((_, i) => args[i - 1] === "--email") ?? process.env["BINDAGT_EMAIL"];
  if (!email && !isCI) {
    const readline = await import("node:readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    email = await new Promise<string>((resolve) => {
      rl.question("Email for notifications: ", (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });
  }

  if (!email) {
    printError("Email is required for registration (--email or BINDAGT_EMAIL)", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  if (!isJson) {
    console.log(`\n→ Registering agt://${domain}/${path}`);
  }

  try {
    const res = await fetch(`${apiUrl}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        domain,
        agentPath: path,
        email,
        controlKey,
        keyType,
        fastLane,
      }),
    });

    if (res.status === 402) {
      printError("Payment required. Visit the dashboard to purchase slots.", isJson);
      process.exit(EXIT.PAYMENT_REQUIRED);
    }
    if (res.status === 401 || res.status === 403) {
      printError("Authentication required. Run: bindagt login", isJson);
      process.exit(EXIT.AUTH_REQUIRED);
    }

    const body = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      printError(String(body["message"] ?? `HTTP ${res.status}`), isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }

    if (isJson) {
      printResult(body, true);
    } else {
      const challengeTxt = body["challengeTxt"] as { name?: string; value?: string } | undefined;
      if (challengeTxt?.name && challengeTxt?.value) {
        console.log(`\n  Publish this DNS TXT record on ${domain}:`);
        console.log(`    ${challengeTxt.name}  TXT  ${challengeTxt.value}`);
        console.log("  Keep it published indefinitely — BindAgt re-checks it daily.");
      }

      const checkoutUrl = body["checkoutUrl"];
      if (typeof checkoutUrl === "string") {
        console.log(`\n  Complete payment to continue: ${checkoutUrl}`);
        const { default: open } = await import("open").catch(() => ({ default: null })) as { default: ((url: string) => Promise<void>) | null };
        if (open) await open(checkoutUrl);
      }

      console.log(`\n→ Check progress: bindagt status agt://${domain}/${path} --watch\n`);
    }
  } catch (err) {
    printError(`Network error: ${String(err)}`, isJson);
    process.exit(EXIT.ORACLE_UNAVAILABLE);
  }
}
