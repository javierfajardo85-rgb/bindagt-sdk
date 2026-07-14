import { shouldUseJson, printError } from "../output.js";
import { EXIT } from "../exit.js";
import process from "node:process";
import { randomBytes, createCipheriv, createDecipheriv, createECDH, pbkdf2Sync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as readline from "node:readline";

const KEY_FILE_DEFAULT = join(homedir(), ".bindagt", "key.enc");

// Contract's _validateKeyType: 0 = secp256k1 (33-byte compressed), 1 = P-256
// (64-byte raw, no 0x04 prefix). Node's built-in ECDH covers both curves
// without pulling in a new dependency.
const CURVE_FOR_KEY_TYPE: Record<0 | 1, string> = { 0: "secp256k1", 1: "prime256v1" };

function deriveControlKey(privateKeyHex: string, keyType: 0 | 1): string {
  const ecdh = createECDH(CURVE_FOR_KEY_TYPE[keyType]);
  ecdh.setPrivateKey(Buffer.from(privateKeyHex, "hex"));
  if (keyType === 0) {
    return "0x" + ecdh.getPublicKey(undefined, "compressed").toString("hex");
  }
  // Strip the leading 0x04 (uncompressed-point marker) — the contract wants
  // raw X||Y, 64 bytes.
  return "0x" + ecdh.getPublicKey(undefined, "uncompressed").subarray(1).toString("hex");
}

async function promptPassword(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(prompt);
  return new Promise<string>((resolve) => {
    // Hide input for passwords
    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    let password = "";
    stdin.on("data", function handler(chunk: Buffer) {
      const char = chunk.toString();
      if (char === "\r" || char === "\n") {
        stdin.setRawMode?.(false);
        stdin.removeListener("data", handler);
        rl.close();
        process.stdout.write("\n");
        resolve(password);
      } else if (char === "") {
        process.exit(EXIT.GENERAL_ERROR);
      } else {
        password += char;
      }
    });
  });
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, 100_000, 32, "sha256");
}

function encryptKey(privateKeyHex: string, password: string, keyType: 0 | 1): Record<string, unknown> {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    keyType,
    kdf: "pbkdf2",
    kdf_params: { salt: salt.toString("base64url"), iterations: 100_000 },
    cipher: "AES-256-GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url"),
  };
}

function decryptKey(fileContents: string, password: string): { privateKeyHex: string; keyType: 0 | 1 } {
  const parsed = JSON.parse(fileContents) as {
    keyType: 0 | 1;
    kdf_params: { salt: string; iterations: number };
    iv: string;
    ciphertext: string;
    tag: string;
  };
  const salt = Buffer.from(parsed.kdf_params.salt, "base64url");
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  const privateKeyHex = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return { privateKeyHex, keyType: parsed.keyType };
}

export async function cmdKeyGenerate(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);

  if (isCI) {
    printError("Key generation requires an interactive terminal", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const keyType: 0 | 1 = args.includes("--p256") ? 1 : 0;
  const ecdh = createECDH(CURVE_FOR_KEY_TYPE[keyType]);
  ecdh.generateKeys();
  const privateKey = ecdh.getPrivateKey("hex");
  const controlKey = deriveControlKey(privateKey, keyType);
  const keyFile = process.env["BINDAGT_KEY_FILE"] ?? KEY_FILE_DEFAULT;

  console.log("\n⚠  controlKey generated.");
  console.log("\n   IMPORTANT: If you lose this key AND lose DNS control of your domain,");
  console.log("   recovery is impossible. BindAgt cannot recover your identity.");
  console.log("\n   If you only lose the key but keep DNS control, recovery takes 72h");
  console.log("   via the DNS Insurance mechanism. See: bindagt.com/docs/recovery\n");

  const password = await promptPassword("Enter password to encrypt key: ");
  const confirm = await promptPassword("Confirm password: ");

  if (password !== confirm) {
    printError("Passwords do not match", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const encrypted = encryptKey(privateKey, password, keyType);

  // Ensure directory exists
  try {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(homedir(), ".bindagt"), { recursive: true });
  } catch {
    // ignore
  }

  writeFileSync(keyFile, JSON.stringify(encrypted, null, 2), { mode: 0o600 });

  console.log(`\n✓ controlKey stored: ${keyFile}`);
  console.log(`  controlKey (public, used at registration time): ${controlKey}`);
  console.log(`  keyType: ${keyType} (${keyType === 0 ? "secp256k1" : "P-256"})\n`);
}

// Used by `bindagt register` to attach controlKey/keyType to the request
// without making the caller re-derive the public key themselves.
export async function loadControlKey(isCI: boolean, isJson: boolean): Promise<{ controlKey: string; keyType: 0 | 1 }> {
  const keyFile = process.env["BINDAGT_KEY_FILE"] ?? KEY_FILE_DEFAULT;

  let raw: string;
  try {
    raw = readFileSync(keyFile, "utf8");
  } catch {
    printError(`No controlKey found. Run: bindagt key generate`, isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const password = isCI
    ? process.env["BINDAGT_KEY_PASSWORD"]
    : await promptPassword("Password to decrypt controlKey: ");

  if (!password) {
    printError("Set BINDAGT_KEY_PASSWORD to decrypt the controlKey headlessly", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }

  try {
    const { privateKeyHex, keyType } = decryptKey(raw, password);
    return { controlKey: deriveControlKey(privateKeyHex, keyType), keyType };
  } catch {
    printError("Wrong password for controlKey file", isJson);
    process.exit(EXIT.AUTH_REQUIRED);
  }
}

export async function cmdKeyExport(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const keyFile = process.env["BINDAGT_KEY_FILE"] ?? KEY_FILE_DEFAULT;

  let contents: string;
  try {
    contents = readFileSync(keyFile, "utf8");
  } catch {
    printError(`Key file not found: ${keyFile}. Run: bindagt key generate`, isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  process.stdout.write(contents + "\n");
}

export async function cmdKeyImport(args: string[], isCI: boolean): Promise<void> {
  const isJson = shouldUseJson(args, isCI);
  const sourceFile = args.find((a) => !a.startsWith("-"));

  if (!sourceFile) {
    printError("Usage: bindagt key import <file>", isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  let contents: string;
  try {
    contents = readFileSync(sourceFile, "utf8");
    JSON.parse(contents); // validate JSON
  } catch {
    printError(`Cannot read key file: ${sourceFile}`, isJson);
    process.exit(EXIT.INVALID_INPUT);
  }

  const keyFile = process.env["BINDAGT_KEY_FILE"] ?? KEY_FILE_DEFAULT;

  try {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(homedir(), ".bindagt"), { recursive: true });
  } catch {
    // ignore
  }

  writeFileSync(keyFile, contents, { mode: 0o600 });
  console.log(`✓ Key imported to ${keyFile}`);
}
