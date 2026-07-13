import process from "node:process";
import { shouldUseJson } from "../output.js";

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

export async function cmdDoctor(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const results: CheckResult[] = [];

  // Node.js version check
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0] ?? "0", 10);
  results.push({
    name: "Node.js version",
    ok: major >= 20,
    detail: nodeVersion + (major < 20 ? " (requires >=20)" : ""),
  });

  // Network: API reachable
  const apiUrl = process.env["BINDAGT_API_URL"] ?? "https://api.bindagt.com/v1";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(`${apiUrl.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    results.push({
      name: "API reachable",
      ok: res.status < 500,
      detail: `HTTP ${res.status} from ${apiUrl}`,
    });
  } catch {
    results.push({ name: "API reachable", ok: false, detail: "Connection failed" });
  }

  // BINDAGT_API_KEY present
  const hasKey = Boolean(process.env["BINDAGT_API_KEY"]);
  results.push({
    name: "BINDAGT_API_KEY",
    ok: hasKey,
    detail: hasKey ? "Set" : "Not set (required for mutations)",
  });

  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      const icon = r.ok ? "✓" : "✗";
      console.log(`  ${icon}  ${r.name.padEnd(25)} ${r.detail}`);
    }
    const allOk = results.every((r) => r.ok);
    console.log(allOk ? "\n  All checks passed." : "\n  Some checks failed.");
  }

  const allPassed = results.every((r) => r.ok);
  if (!allPassed) process.exit(1);
}
