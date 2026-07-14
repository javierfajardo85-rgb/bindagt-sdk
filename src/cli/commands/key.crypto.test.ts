// Covers the controlKey derivation added to fix the CLI's `bindagt register`
// (Checklist.md §"CLI público" — the API's RegisterSchema requires
// controlKey/keyType, which the CLI never sent, so every registration 400'd).
//
// This file intentionally does NOT go through cli.test.ts's `vi.mock("./key.js")`
// (that mock replaces loadControlKey with a stub for the other CLI-command
// tests) — it exercises the real crypto against independently-computed
// expected values, so a mistake in the ECDH usage would actually fail here.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createECDH, randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadControlKey } from "./key.js";

// Mirrors encryptKey()'s on-disk format in key.ts, built independently here
// so this test doesn't depend on key.ts's own encrypt path (only decrypt,
// via loadControlKey, is under test).
function buildKeyFile(privateKeyHex: string, password: string, keyType: 0 | 1): string {
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, 100_000, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyHex, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: 1,
    keyType,
    kdf: "pbkdf2",
    kdf_params: { salt: salt.toString("base64url"), iterations: 100_000 },
    cipher: "AES-256-GCM",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: tag.toString("base64url"),
  });
}

let tmpDir: string;

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env["BINDAGT_KEY_FILE"];
  delete process.env["BINDAGT_KEY_PASSWORD"];
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadControlKey — secp256k1 (keyType 0)", () => {
  it("decrypts the stored private key and derives the matching 33-byte compressed controlKey", async () => {
    const ecdh = createECDH("secp256k1");
    ecdh.generateKeys();
    const privateKeyHex = ecdh.getPrivateKey("hex");
    const expectedControlKey = "0x" + ecdh.getPublicKey(undefined, "compressed").toString("hex");

    tmpDir = mkdtempSync(join(tmpdir(), "bindagt-key-test-"));
    const keyFile = join(tmpDir, "key.enc");
    writeFileSync(keyFile, buildKeyFile(privateKeyHex, "correct horse", 0));
    process.env["BINDAGT_KEY_FILE"] = keyFile;
    process.env["BINDAGT_KEY_PASSWORD"] = "correct horse";

    const result = await loadControlKey(true, true);

    expect(result.keyType).toBe(0);
    expect(result.controlKey).toBe(expectedControlKey);
    expect(result.controlKey).toMatch(/^0x[0-9a-f]{66}$/); // 33 bytes
  });
});

describe("loadControlKey — P-256 (keyType 1)", () => {
  it("decrypts and derives the matching 64-byte raw controlKey (no 0x04 prefix)", async () => {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const privateKeyHex = ecdh.getPrivateKey("hex");
    const expectedControlKey =
      "0x" + ecdh.getPublicKey(undefined, "uncompressed").subarray(1).toString("hex");

    tmpDir = mkdtempSync(join(tmpdir(), "bindagt-key-test-"));
    const keyFile = join(tmpDir, "key.enc");
    writeFileSync(keyFile, buildKeyFile(privateKeyHex, "correct horse", 1));
    process.env["BINDAGT_KEY_FILE"] = keyFile;
    process.env["BINDAGT_KEY_PASSWORD"] = "correct horse";

    const result = await loadControlKey(true, true);

    expect(result.keyType).toBe(1);
    expect(result.controlKey).toBe(expectedControlKey);
    expect(result.controlKey).toMatch(/^0x[0-9a-f]{128}$/); // 64 bytes
  });
});

describe("loadControlKey — error paths", () => {
  it("no key file + isCI → exit(AUTH_REQUIRED... actually INVALID_INPUT for missing file)", async () => {
    process.env["BINDAGT_KEY_FILE"] = "/tmp/__bindagt_missing_key_crypto_test__.enc";
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw Object.assign(new Error(`exit:${code ?? 0}`), { exitCode: code ?? 0 });
      }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(loadControlKey(true, true)).rejects.toBeTruthy();
    expect(exitSpy).toHaveBeenCalledWith(2); // EXIT.INVALID_INPUT
  });

  it("wrong password → exit(AUTH_REQUIRED)", async () => {
    const ecdh = createECDH("secp256k1");
    ecdh.generateKeys();
    tmpDir = mkdtempSync(join(tmpdir(), "bindagt-key-test-"));
    const keyFile = join(tmpDir, "key.enc");
    writeFileSync(keyFile, buildKeyFile(ecdh.getPrivateKey("hex"), "right-password", 0));
    process.env["BINDAGT_KEY_FILE"] = keyFile;
    process.env["BINDAGT_KEY_PASSWORD"] = "wrong-password";

    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw Object.assign(new Error(`exit:${code ?? 0}`), { exitCode: code ?? 0 });
      }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(loadControlKey(true, true)).rejects.toBeTruthy();
    expect(exitSpy).toHaveBeenCalledWith(3); // EXIT.AUTH_REQUIRED
  });
});
