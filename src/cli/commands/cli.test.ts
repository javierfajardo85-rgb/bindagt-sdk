// T-500 to T-543 — CLI command tests (Vitest, no subprocess needed)
//
// Strategy: import command functions directly; mock process.exit to throw so
// exit-code assertions work; stub global fetch for HTTP commands.

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// ── Module mocks (hoisted before imports) ──────────────────────────────────

const { mockVerify, mockVerifyOnChain } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockVerifyOnChain: vi.fn(),
}));
vi.mock("../../verify.js", () => ({ verify: mockVerify }));
vi.mock("../../verifyOnChain.js", () => ({ verifyOnChain: mockVerifyOnChain }));

const { mockResolveTxt } = vi.hoisted(() => ({ mockResolveTxt: vi.fn() }));
vi.mock("node:dns/promises", () => ({ resolveTxt: mockResolveTxt }));

const { mockLoadControlKey } = vi.hoisted(() => ({ mockLoadControlKey: vi.fn() }));
vi.mock("./key.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./key.js")>();
  return { ...actual, loadControlKey: mockLoadControlKey };
});

// ── Imports (after mocks are hoisted) ─────────────────────────────────────

import { shouldUseJson, printResult, printError } from "../output.js";
import { exitCode, EXIT } from "../exit.js";
import { BindAgtError } from "../../errors.js";
import { cmdVerify } from "./verify.js";
import { cmdStatus } from "./status.js";
import { cmdList } from "./list.js";
import { cmdRegister } from "./register.js";
import { cmdActivate } from "./activate.js";
import { cmdRenew } from "./renew.js";
import { cmdReactivate } from "./reactivate.js";
import { cmdBuySlots } from "./buy-slots.js";
import { cmdSlotsList } from "./slots-list.js";
import { cmdCancelTransfer } from "./cancel-transfer.js";
import { cmdKeyGenerate, cmdKeyExport, cmdKeyImport } from "./key.js";
import { cmdLogin } from "./login.js";
import { cmdCheckDns } from "./check-dns.js";
import { cmdDoctor } from "./doctor.js";

// ── Test setup ──────────────────────────────────────────────────────────────

type ExitError = Error & { exitCode: number };

let mockFetch: ReturnType<typeof vi.fn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Make process.exit throw so execution stops; use exitSpy.mock.calls[0][0]
  // to read the FIRST exit code in tests where exit is inside a try block.
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw Object.assign(new Error(`exit:${code ?? 0}`), { exitCode: code ?? 0 }) as ExitError;
  }) as never);

  // Suppress console output; tests that need to inspect it can spy per-test
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  mockLoadControlKey.mockReset();
  mockLoadControlKey.mockResolvedValue({ controlKey: "0x02" + "ab".repeat(32), keyType: 0 });

  delete process.env["BINDAGT_API_KEY"];
  delete process.env["BINDAGT_API_URL"];
  delete process.env["BINDAGT_EMAIL"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Helper: build a minimal fetch Response mock
function fetchOk(body: unknown, status = 200) {
  return { ok: status < 400, status, json: vi.fn().mockResolvedValue(body) };
}

// ── T-500 to T-504: output utilities ──────────────────────────────────────

describe("shouldUseJson — T-500", () => {
  it("T-500: isCI=true + no flags → true (JSON)", () => {
    expect(shouldUseJson([], true)).toBe(true);
  });
  it("T-501: --json flag → true regardless of isCI", () => {
    expect(shouldUseJson(["--json"], false)).toBe(true);
  });
  it("T-502: --human flag → false regardless of isCI", () => {
    expect(shouldUseJson(["--human"], true)).toBe(false);
  });
  it("T-503: when both --json and --human present, --json wins (first check in source)", () => {
    // shouldUseJson checks --json first, so --json takes precedence
    expect(shouldUseJson(["--json", "--human"], true)).toBe(true);
  });
});

describe("printResult / printError — T-504", () => {
  it("T-504a: printResult in JSON mode calls console.log with JSON string", () => {
    const logSpy = vi.spyOn(console, "log");
    printResult({ valid: true, domain: "example.com" }, true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"valid": true'));
  });
  it("T-504b: printError in JSON mode writes {error:msg} to stderr", () => {
    const errSpy = vi.spyOn(console, "error");
    printError("something failed", true);
    const output = errSpy.mock.calls[0]?.[0] as string;
    expect(JSON.parse(output)).toEqual({ error: "something failed" });
  });
  it("T-504c: printResult in human mode with a verdictLine prints it before the table", () => {
    const logSpy = vi.spyOn(console, "log");
    printResult({ valid: true, agentId: "agt://bindagt.com/demo" }, false, "✓ VERIFIED — agt://bindagt.com/demo");
    expect(logSpy.mock.calls[0]?.[0]).toBe("✓ VERIFIED — agt://bindagt.com/demo");
  });
  it("T-504d: printResult in human mode without a verdictLine prints only the table", () => {
    const logSpy = vi.spyOn(console, "log");
    printResult({ valid: false }, false);
    expect(logSpy.mock.calls[0]?.[0]).not.toContain("VERIFIED");
  });
  it("T-504e: printResult in JSON mode ignores verdictLine entirely", () => {
    const logSpy = vi.spyOn(console, "log");
    printResult({ valid: true }, true, "✓ VERIFIED — agt://bindagt.com/demo");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).not.toContain("VERIFIED");
  });
});

// ── T-505 to T-508: exit code mapping ─────────────────────────────────────

describe("exitCode — T-505 to T-508", () => {
  it("T-505: INVALID_AGENT_ID → EXIT.INVALID_INPUT (2)", () => {
    expect(exitCode(new BindAgtError("INVALID_AGENT_ID", "bad"))).toBe(EXIT.INVALID_INPUT);
  });
  it("T-506: UNAUTHORIZED → EXIT.AUTH_REQUIRED (3)", () => {
    expect(exitCode(new BindAgtError("UNAUTHORIZED", "no auth"))).toBe(EXIT.AUTH_REQUIRED);
  });
  it("T-507: AGENT_NOT_FOUND → EXIT.NOT_FOUND (4)", () => {
    expect(exitCode(new BindAgtError("AGENT_NOT_FOUND", "miss"))).toBe(EXIT.NOT_FOUND);
  });
  it("T-508: RATE_LIMITED → EXIT.RATE_LIMITED (7)", () => {
    expect(exitCode(new BindAgtError("RATE_LIMITED", "slow"))).toBe(EXIT.RATE_LIMITED);
  });
});

// ── T-509 to T-512: verify command ────────────────────────────────────────

describe("cmdVerify — T-509 to T-512", () => {
  it("T-509: missing arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdVerify([], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-510: valid agent, result.valid=true → prints result, no exit", async () => {
    const logSpy = vi.spyOn(console, "log");
    mockVerify.mockResolvedValue({
      valid: true, agentId: "agt://example.com/ai",
      domain: "example.com", domainStatus: "active",
      agentType: "private", source: "api",
    });
    await cmdVerify(["agt://example.com/ai", "--json"], true);
    expect(logSpy).toHaveBeenCalled();
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.valid).toBe(true);
  });

  it("T-511: result.valid=false → first exit call is NOT_FOUND", async () => {
    // process.exit(NOT_FOUND) is inside a try block; mock throw is re-caught
    // → check first call, not the final thrown code
    mockVerify.mockResolvedValue({
      valid: false, agentId: "agt://gone.com/ai",
      domain: "gone.com", domainStatus: "suspended",
      agentType: "private", source: "api",
    });
    await expect(cmdVerify(["agt://gone.com/ai"], true)).rejects.toBeTruthy();
    expect(exitSpy.mock.calls[0]?.[0]).toBe(EXIT.NOT_FOUND);
  });

  it("T-512: --onchain flag → calls verifyOnChain, not verify", async () => {
    mockVerifyOnChain.mockResolvedValue({
      valid: true, agentId: "agt://example.com/ai",
      domain: "example.com", domainStatus: "active",
      agentType: "private", source: "l1",
    });
    await cmdVerify(["agt://example.com/ai", "--onchain"], true);
    expect(mockVerifyOnChain).toHaveBeenCalled();
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("T-513: valid agent, human mode → prints ✓ VERIFIED with the agentId", async () => {
    const logSpy = vi.spyOn(console, "log");
    mockVerifyOnChain.mockResolvedValue({
      valid: true, agentId: "agt://bindagt.com/demo",
      domain: "bindagt.com", domainStatus: "active",
      agentType: "public", source: "l1",
    });
    await cmdVerify(["agt://bindagt.com/demo", "--onchain", "--human"], true);
    expect(logSpy.mock.calls[0]?.[0]).toBe("✓ VERIFIED — agt://bindagt.com/demo");
  });

  it("T-514: invalid agent, human mode → no ✓ VERIFIED line printed", async () => {
    const logSpy = vi.spyOn(console, "log");
    mockVerifyOnChain.mockResolvedValue({
      valid: false, agentId: "agt://gone.com/ai",
      domain: "gone.com", domainStatus: "suspended",
      agentType: "private", source: "l1",
    });
    await expect(cmdVerify(["agt://gone.com/ai", "--onchain", "--human"], true)).rejects.toBeTruthy();
    for (const call of logSpy.mock.calls) {
      expect(call[0]).not.toContain("VERIFIED");
    }
  });
});

// ── T-513 to T-514: status command ────────────────────────────────────────

describe("cmdStatus — T-513 to T-514", () => {
  it("T-513: missing arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdStatus([], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-514: one-shot check → calls verify and prints result", async () => {
    const logSpy = vi.spyOn(console, "log");
    mockVerify.mockResolvedValue({
      valid: true, agentId: "agt://example.com/ai",
      domain: "example.com", domainStatus: "active",
      agentType: "private", source: "api",
    });
    await cmdStatus(["agt://example.com/ai", "--json"], true);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalled();
  });
});

// ── T-515 to T-517: list command ──────────────────────────────────────────

describe("cmdList — T-515 to T-517", () => {
  it("T-515: no BINDAGT_API_KEY → exit(AUTH_REQUIRED)", async () => {
    await expect(cmdList(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.AUTH_REQUIRED });
  });

  it("T-516: API returns 401 → first exit call is AUTH_REQUIRED", async () => {
    // process.exit(AUTH_REQUIRED) is inside try block; check first call
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    mockFetch.mockResolvedValue(fetchOk({}, 401));
    await expect(cmdList(["--json"], true)).rejects.toBeTruthy();
    expect(exitSpy.mock.calls[0]?.[0]).toBe(EXIT.AUTH_REQUIRED);
  });

  it("T-517: API success → printResult called with profile", async () => {
    const logSpy = vi.spyOn(console, "log");
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    const profile = { id: "cus_001", plan: "starter" };
    mockFetch.mockResolvedValue(fetchOk(profile));
    await cmdList(["--json"], true);
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.plan).toBe("starter");
  });
});

// ── T-518 to T-521: register command ─────────────────────────────────────

describe("cmdRegister — T-518 to T-521", () => {
  it("T-518: missing agt-id → exit(INVALID_INPUT)", async () => {
    await expect(cmdRegister(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-519: CI + no BINDAGT_API_KEY → exit(AUTH_REQUIRED)", async () => {
    // Valid agt-id + email provided + CI + no API key
    await expect(
      cmdRegister(["agt://example.com/ai", "--email", "user@example.com", "--json"], true)
    ).rejects.toMatchObject({ exitCode: EXIT.AUTH_REQUIRED });
  });

  it("T-520: invalid agt-id format → exit(INVALID_INPUT)", async () => {
    await expect(
      cmdRegister(["not-a-valid-id", "--email", "user@example.com", "--json"], true)
    ).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-521: 402 response → first exit call is PAYMENT_REQUIRED", async () => {
    // process.exit(PAYMENT_REQUIRED) is inside try block; check first call
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    mockFetch.mockResolvedValue(fetchOk({}, 402));
    await expect(
      cmdRegister(["agt://example.com/ai", "--email", "user@example.com", "--json"], true)
    ).rejects.toBeTruthy();
    expect(exitSpy.mock.calls[0]?.[0]).toBe(EXIT.PAYMENT_REQUIRED);
  });

  it("T-521b: request body includes controlKey + keyType from loadControlKey", async () => {
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    mockLoadControlKey.mockResolvedValue({ controlKey: "0x03" + "cd".repeat(32), keyType: 0 });
    mockFetch.mockResolvedValue(fetchOk({ domainHash: "0xabc" }, 201));
    await cmdRegister(["agt://example.com/ai", "--email", "user@example.com", "--json"], true);
    const call = mockFetch.mock.calls[0];
    const reqBody = JSON.parse((call?.[1] as RequestInit)?.body as string);
    expect(reqBody.controlKey).toBe("0x03" + "cd".repeat(32));
    expect(reqBody.keyType).toBe(0);
  });

  it("T-521c: loadControlKey exits AUTH_REQUIRED (e.g. no key file) → register never calls fetch", async () => {
    mockLoadControlKey.mockImplementation(() => {
      throw Object.assign(new Error(`exit:${EXIT.AUTH_REQUIRED}`), { exitCode: EXIT.AUTH_REQUIRED });
    });
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    await expect(
      cmdRegister(["agt://example.com/ai", "--email", "user@example.com", "--json"], true)
    ).rejects.toMatchObject({ exitCode: EXIT.AUTH_REQUIRED });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── T-522 to T-524: activate command ─────────────────────────────────────

describe("cmdActivate — T-522 to T-524", () => {
  it("T-522: missing arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdActivate(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-523: no BINDAGT_API_KEY → exit(AUTH_REQUIRED)", async () => {
    await expect(
      cmdActivate(["agt://example.com/ai", "--json"], true)
    ).rejects.toMatchObject({ exitCode: EXIT.AUTH_REQUIRED });
  });

  it("T-524: --public flag sends agentType=public in request body", async () => {
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    const body = { agentHash: "0xabc", status: "queued" };
    mockFetch.mockResolvedValue(fetchOk(body, 202));
    await cmdActivate(["agt://example.com/ai", "--public", "--json"], true);
    const call = mockFetch.mock.calls[0];
    const reqBody = JSON.parse((call?.[1] as RequestInit)?.body as string);
    expect(reqBody.agentType).toBe("public");
  });
});

// ── T-525 to T-526: renew command ─────────────────────────────────────────

describe("cmdRenew — T-525 to T-526", () => {
  it("T-525: missing arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdRenew(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-526: 402 response → first exit call is PAYMENT_REQUIRED", async () => {
    // process.exit(PAYMENT_REQUIRED) is inside try block; check first call
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    mockFetch.mockResolvedValue(fetchOk({}, 402));
    await expect(cmdRenew(["example.com", "--json"], true)).rejects.toBeTruthy();
    expect(exitSpy.mock.calls[0]?.[0]).toBe(EXIT.PAYMENT_REQUIRED);
  });
});

// ── T-527 to T-528: reactivate command ────────────────────────────────────

describe("cmdReactivate — T-527 to T-528", () => {
  it("T-527: missing arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdReactivate(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-528: success → printResult called with body", async () => {
    const logSpy = vi.spyOn(console, "log");
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    mockFetch.mockResolvedValue(fetchOk({ status: "queued" }, 202));
    await cmdReactivate(["example.com", "--json"], true);
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.status).toBe("queued");
  });
});

// ── T-529 to T-531: buy-slots command ─────────────────────────────────────

describe("cmdBuySlots — T-529 to T-531", () => {
  it("T-529: non-numeric arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdBuySlots(["abc", "--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-530: n=0 → exit(INVALID_INPUT)", async () => {
    await expect(cmdBuySlots(["0", "--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-531: success → printResult called with checkoutUrl", async () => {
    const logSpy = vi.spyOn(console, "log");
    process.env["BINDAGT_API_KEY"] = "agt_live_key";
    mockFetch.mockResolvedValue(fetchOk({ checkoutUrl: "https://buy.stripe.com/test" }, 200));
    await cmdBuySlots(["3", "--json"], true);
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.checkoutUrl).toBe("https://buy.stripe.com/test");
  });
});

// ── T-532: slots list command ─────────────────────────────────────────────

describe("cmdSlotsList — T-532", () => {
  it("T-532: no API key → exit(AUTH_REQUIRED)", async () => {
    await expect(cmdSlotsList(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.AUTH_REQUIRED });
  });
});

// ── T-535 to T-536: cancel-transfer command ───────────────────────────────

describe("cmdCancelTransfer — T-535 to T-536", () => {
  it("T-535: missing arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdCancelTransfer(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-536: no API key → exit(AUTH_REQUIRED)", async () => {
    await expect(cmdCancelTransfer(["example.com", "--json"], true))
      .rejects.toMatchObject({ exitCode: EXIT.AUTH_REQUIRED });
  });
});

// ── T-537 to T-539: key commands ──────────────────────────────────────────

describe("key commands — T-537 to T-539", () => {
  it("T-537: key generate in CI mode → exit(INVALID_INPUT) (requires interactive TTY)", async () => {
    await expect(cmdKeyGenerate(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-538: key export — no key file set + file not found → exit(INVALID_INPUT)", async () => {
    process.env["BINDAGT_KEY_FILE"] = "/tmp/__bindagt_nonexistent_key_test__.enc";
    await expect(cmdKeyExport([], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
    delete process.env["BINDAGT_KEY_FILE"];
  });

  it("T-539: key import — missing source file arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdKeyImport(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });
});

// ── T-540 to T-541: login command ─────────────────────────────────────────

describe("cmdLogin — T-540 to T-541", () => {
  it("T-540: CI + no BINDAGT_API_KEY → exit(AUTH_REQUIRED)", async () => {
    await expect(cmdLogin(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.AUTH_REQUIRED });
  });

  it("T-541: BINDAGT_API_KEY set → returns without error", async () => {
    process.env["BINDAGT_API_KEY"] = "agt_live_test";
    await expect(cmdLogin(["--json"], true)).resolves.toBeUndefined();
  });
});

// ── T-542 to T-543: check-dns command ─────────────────────────────────────

describe("cmdCheckDns — T-542 to T-543", () => {
  it("T-542: missing arg → exit(INVALID_INPUT)", async () => {
    await expect(cmdCheckDns(["--json"], true)).rejects.toMatchObject({ exitCode: EXIT.INVALID_INPUT });
  });

  it("T-543: DNS resolved → JSON output with domain and records array", async () => {
    const logSpy = vi.spyOn(console, "log");
    mockResolveTxt.mockResolvedValue([["bindagt=abc123"]]);
    await cmdCheckDns(["example.com", "--json"], true);
    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(output.domain).toBe("example.com");
    expect(output.records).toContain("bindagt=abc123");
  });
});
