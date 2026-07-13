import { shouldUseJson, printResult, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";
import { resolveTxt } from "node:dns/promises";

export async function cmdCheckDns(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const domain = args.find((a) => !a.startsWith("-"));

  if (!domain) {
    printError("Usage: bindagt check-dns <domain>", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const challengeHost = `_bindagt-challenge.${domain}`;

  try {
    const records = await resolveTxt(challengeHost);
    const values = records.flat();

    if (isJson) {
      printResult({ domain, challengeHost, records: values }, true);
    } else {
      if (values.length === 0) {
        console.log(`\n  No TXT record found at ${challengeHost}`);
        console.log("  Add the challenge TXT record from your BindAgt dashboard.\n");
      } else {
        console.log(`\n  TXT records at ${challengeHost}:`);
        for (const v of values) {
          console.log(`    "${v}"`);
        }
        console.log();
      }
    }
  } catch (err) {
    const isNxDomain =
      err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOTFOUND";
    if (isNxDomain || (err instanceof Error && err.message.includes("ENODATA"))) {
      if (isJson) {
        printResult({ domain, challengeHost, records: [] }, true);
      } else {
        console.log(`\n  No TXT record found at ${challengeHost}\n`);
      }
    } else {
      printError(`DNS lookup failed: ${String(err)}`, isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }
  }
}
