import { describe, expect, it } from "vitest";
import { defaultPolicy, getSandbox, LocalProcessSandbox } from "@/server/tools/sandbox";
import { classifyRisk, requiresApproval, validateToolSpec } from "@/server/tools/sdk";

const benignSource = `
module.exports = function (input) {
  console.log("doubling", input.n);
  return { doubled: input.n * 2 };
};
`;

describe("LocalProcessSandbox", () => {
  it("runs a benign js_function and returns its output + logs", async () => {
    const sandbox = getSandbox();
    expect(sandbox).toBeInstanceOf(LocalProcessSandbox);
    const result = await sandbox.runJs(benignSource, { n: 21 }, defaultPolicy({ timeoutMs: 10000 }));
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ doubled: 42 });
    expect(result.logs.some((l) => l.includes("doubling 21"))).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("kills an infinite-loop tool on timeout", async () => {
    const result = await getSandbox().runJs(
      "module.exports = function () { while (true) {} };",
      {},
      defaultPolicy({ timeoutMs: 1500 })
    );
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/timeout/i);
    expect(result.durationMs).toBeLessThan(15000);
  }, 20000);

  it("blocks fetch when policy.network is deny", async () => {
    const result = await getSandbox().runJs(
      `module.exports = async function () {
         const res = await fetch("http://example.com/");
         return res.status;
       };`,
      {},
      defaultPolicy({ network: "deny" })
    );
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/denied/);
  });

  it("blocks require('http') when policy.network is deny", async () => {
    const result = await getSandbox().runJs(
      `module.exports = function () {
         const http = require("http");
         return typeof http.get;
       };`,
      {},
      defaultPolicy({ network: "deny" })
    );
    expect(result.ok).toBe(false);
    expect(result.error ?? "").toMatch(/denied/);
  });

  it("runTests passes a correct tool and reports failures for a broken one", async () => {
    const source = "module.exports = function (input) { return input.a + input.b; };";
    const passing = await getSandbox().runTests(
      source,
      `assert.equal(tool({ a: 2, b: 3 }), 5, "adds");
       assert.equal(tool({ a: -1, b: 1 }), 0, "handles negatives");`,
      defaultPolicy()
    );
    expect(passing.ok).toBe(true);

    const failing = await getSandbox().runTests(
      source,
      `assert.equal(tool({ a: 2, b: 3 }), 6, "wrong on purpose");`,
      defaultPolicy()
    );
    expect(failing.ok).toBe(false);
    expect(failing.error ?? "").toContain("wrong on purpose");
  });

  it("scrubs the environment (tool code cannot see secrets)", async () => {
    const result = await getSandbox().runJs(
      "module.exports = function () { return Object.keys(process.env).length; };",
      {},
      defaultPolicy()
    );
    expect(result.ok).toBe(true);
    // Only PATH survives the scrub.
    expect(result.output).toBeLessThanOrEqual(1);
  });
});

describe("tool sdk", () => {
  it("classifies child_process source as high risk", () => {
    expect(
      classifyRisk({ permissions: [], sourceCode: 'require("child_process").exec("ls")' })
    ).toBe("high");
  });

  it("classifies high-risk permissions as high and plain code as low", () => {
    expect(classifyRisk({ permissions: ["shell"], sourceCode: "return 1;" })).toBe("high");
    expect(
      classifyRisk({ permissions: [], sourceCode: "module.exports = (i) => i.x + 1;" })
    ).toBe("low");
  });

  it("requiresApproval follows the autonomy matrix", () => {
    expect(requiresApproval("high", "auto")).toBe(true);
    expect(requiresApproval("medium", "auto")).toBe(false);
    expect(requiresApproval("medium", "ask_risky")).toBe(true);
    expect(requiresApproval("low", "ask_all")).toBe(true);
    expect(requiresApproval("low", "auto")).toBe(false);
  });

  it("validateToolSpec enforces the name pattern", () => {
    expect(() =>
      validateToolSpec({ name: "Bad Name!", type: "js_function", sourceCode: "x" })
    ).toThrow();
    const spec = validateToolSpec({ name: "good_name_1", type: "js_function", sourceCode: "x" });
    expect(spec.version).toBe(1);
    expect(spec.timeoutMs).toBe(10000);
  });
});
