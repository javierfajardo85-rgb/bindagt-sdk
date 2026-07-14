#!/usr/bin/env node
import process from "node:process";
import { cmdVerify } from "./commands/verify.js";
import { cmdStatus } from "./commands/status.js";
import { cmdDoctor } from "./commands/doctor.js";
import { cmdList } from "./commands/list.js";
import { cmdRegister } from "./commands/register.js";
import { cmdActivate } from "./commands/activate.js";
import { cmdRenew } from "./commands/renew.js";
import { cmdReactivate } from "./commands/reactivate.js";
import { cmdBuySlots } from "./commands/buy-slots.js";
import { cmdSlotsList } from "./commands/slots-list.js";
import { cmdCancelTransfer } from "./commands/cancel-transfer.js";
import { cmdKeyGenerate, cmdKeyExport, cmdKeyImport } from "./commands/key.js";
import { cmdLogin } from "./commands/login.js";
import { cmdUpgrade } from "./commands/upgrade.js";
import { cmdCheckDns } from "./commands/check-dns.js";
import { exitCode, EXIT } from "./exit.js";

const args = process.argv.slice(2);
const [command, sub, ...rest] = args;

// Detect CI/headless mode
const isCI =
  process.env["CI"] === "true" ||
  process.env["GITHUB_ACTIONS"] === "true" ||
  process.env["GITLAB_CI"] === "true" ||
  args.includes("--ci");

async function main(): Promise<void> {
  switch (command) {
    case "verify":
      await cmdVerify([sub ?? "", ...rest], isCI);
      break;

    case "status":
      await cmdStatus([sub ?? "", ...rest], isCI);
      break;

    case "list":
      await cmdList(args.slice(1), isCI);
      break;

    case "register":
      await cmdRegister([sub ?? "", ...rest], isCI);
      break;

    case "activate":
      await cmdActivate([sub ?? "", ...rest], isCI);
      break;

    case "renew":
      await cmdRenew([sub ?? "", ...rest], isCI);
      break;

    case "reactivate":
      await cmdReactivate([sub ?? "", ...rest], isCI);
      break;

    case "buy-slots":
      await cmdBuySlots([sub ?? "", ...rest], isCI);
      break;

    case "slots":
      if (sub === "list") {
        await cmdSlotsList(rest, isCI);
      } else {
        printUnknown(`slots ${sub ?? ""}`);
      }
      break;

    case "cancel-transfer":
      await cmdCancelTransfer([sub ?? "", ...rest], isCI);
      break;

    case "key":
      if (sub === "generate") {
        await cmdKeyGenerate(rest, isCI);
      } else if (sub === "export") {
        await cmdKeyExport(rest, isCI);
      } else if (sub === "import") {
        await cmdKeyImport(rest, isCI);
      } else {
        printKeyHelp();
      }
      break;

    case "login":
      await cmdLogin(args.slice(1), isCI);
      break;

    case "check-dns":
      await cmdCheckDns([sub ?? "", ...rest], isCI);
      break;

    case "upgrade":
      await cmdUpgrade(args.slice(1), isCI);
      break;

    case "doctor":
      await cmdDoctor(args.slice(1), isCI);
      break;

    case "--version":
    case "-v":
    case "version":
      printVersion();
      break;

    case "--help":
    case "-h":
    case "help":
    case undefined:
      printHelp();
      break;

    default:
      printUnknown(command ?? "");
  }
}

function printVersion(): void {
  // Version injected at build time via package.json
  const pkg = { version: "0.1.0" };
  console.log(pkg.version);
}

function printHelp(): void {
  console.log(`
bindagt — AGT-9303 agent identity CLI

Usage: bindagt <command> [options]

Authentication
  login                       Authenticate with your BindAgt account

Identity & key management
  key generate [--p256]       Generate a new controlKey (default: secp256k1)
  key export                  Export encrypted controlKey
  key import <file>           Import encrypted controlKey

Root management
  register <agt-id> [--fast-lane]   Register a new root + agent (--fast-lane: priority queue)
  renew <domain>               Renew a root domain
  reactivate <domain>          Reactivate a suspended root ($10)

Agent management
  activate <agt-id>           Activate a slot (--private/--public, default: --private)
  list                        List your roots and agents
  status <agt-id>             Show status of a root or agent
  status --watch <agt-id>     Poll until the agent is active
  slots list                  List unactivated slots

Payments
  buy-slots <n>                Purchase a pack of agent slots

Recovery
  cancel-transfer <domain>    Veto an in-progress transfer (Time-Lock)
  change-email <domain>       Change the registered email
  recover-key <domain>        Recover a lost controlKey via DNS Insurance

Diagnostic
  doctor                      Check system dependencies and connectivity
  check-dns <domain>          Verify current DNS TXT record
  verify <agt-id|hash>        Quick verification (read-only, no auth needed)
  upgrade                     Update bindagt to the latest version

Global flags
  --json                      Force JSON output
  --human                     Force human-readable output
  --ci                        Headless/non-interactive mode
  --help                      Show this help
  --version                   Show version

Environment variables
  BINDAGT_API_KEY             API key (headless auth)
  BINDAGT_API_URL             Override API base URL
  BINDAGT_RPC_URL             Override RPC URL (default: mainnet)
  BINDAGT_CONTRACT_ADDRESS    Override registry contract address (e.g. Sepolia for QA)
  BINDAGT_KEY_FILE            Override controlKey file path

Docs: https://docs.bindagt.com
`);
}

function printKeyHelp(): void {
  console.log(`
Usage: bindagt key <subcommand>

  generate [--p256]    Generate a new controlKey
  export               Export encrypted controlKey to stdout
  import <file>        Import a controlKey from an encrypted file
`);
}

function printUnknown(cmd: string): void {
  console.error(`Unknown command: "${cmd}". Run bindagt --help for usage.`);
  process.exit(EXIT.INVALID_INPUT);
}

main().catch((err: unknown) => {
  const code = exitCode(err);
  const message = err instanceof Error ? err.message : String(err);
  if (process.env["BINDAGT_JSON_OUTPUT"] === "true" || args.includes("--json")) {
    console.error(JSON.stringify({ error: message }));
  } else {
    console.error(`\n✗ ${message}\n`);
  }
  process.exit(code);
});
