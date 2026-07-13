import process from "node:process";

export type OutputMode = "human" | "json" | "auto";

function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function shouldUseJson(args: string[], isCI: boolean): boolean {
  if (args.includes("--json")) return true;
  if (args.includes("--human")) return false;
  if (isCI) return true;
  return !isTTY();
}

export function printResult(data: unknown, isJson: boolean, verdictLine?: string): void {
  if (isJson) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    if (verdictLine) {
      console.log(verdictLine);
    }
    if (typeof data === "object" && data !== null) {
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        console.log(`${k.padEnd(24)}${String(v)}`);
      }
    } else {
      console.log(String(data));
    }
  }
}

export function printError(message: string, isJson: boolean): void {
  if (isJson) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(`\n✗ ${message}\n`);
  }
}
