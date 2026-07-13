import { shouldUseJson, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";
import { execSync } from "node:child_process";

export async function cmdUpgrade(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);

  // Detect package manager: prefer npm global
  const packageManager = args.includes("--npm")
    ? "npm"
    : args.includes("--pnpm")
    ? "pnpm"
    : "npm";

  if (!isJson) {
    console.log("\n→ Checking for latest version...");
  }

  try {
    const res = await fetch("https://registry.npmjs.org/bindagt/latest");
    if (!res.ok) {
      printError("Could not fetch latest version from npm registry", isJson);
      process.exit(EXIT.ORACLE_UNAVAILABLE);
    }
    const pkg = (await res.json()) as Record<string, unknown>;
    const latest = String(pkg["version"] ?? "unknown");

    if (!isJson) {
      console.log(`  Latest version: ${latest}`);
      console.log(`\n→ Installing bindagt@${latest}...`);
    }

    const cmd =
      packageManager === "pnpm"
        ? `pnpm add -g bindagt@${latest}`
        : `npm install -g bindagt@${latest}`;

    execSync(cmd, { stdio: isJson ? "pipe" : "inherit" });

    if (isJson) {
      console.log(JSON.stringify({ updated: true, version: latest }));
    } else {
      console.log(`\n✓ bindagt updated to ${latest}\n`);
    }
  } catch (err) {
    printError(`Upgrade failed: ${String(err)}`, isJson);
    process.exit(EXIT.GENERAL_ERROR);
  }
}
