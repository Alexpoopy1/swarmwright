import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import type { SandboxAdapter, SandboxPolicy, ToolRunResult } from "@/types";
import { env } from "@/server/env";

/**
 * LocalProcessSandbox (SPEC §4.8) — agent-authored tool code never runs
 * in-process. Each execution:
 *   1. creates sandbox-tmp/<uuid>/ at the project root,
 *   2. writes job.json (source, input, policy) + runner.js,
 *   3. spawns `node --max-old-space-size=<mb> runner.js` with the environment
 *      scrubbed to { PATH },
 *   4. hard-kills (SIGKILL) on timeout,
 *   5. reads the result from stdout between the __SW_RESULT__ / __SW_END__
 *      sentinel lines, then deletes the temp dir.
 *
 * TOOL AUTHORING CONVENTION (documented for the factory/UI):
 * `sourceCode` must assign the callable tool via CommonJS, either
 *     module.exports = function (input) { ... }        // preferred
 * or  exports.default = function (input) { ... }
 * The function receives the parsed JSON input and its return value (awaited)
 * becomes the tool output. `console.*` is captured into `logs`.
 *
 * TEST HARNESS CONVENTION: `runTests` wraps `testCode` in an async function
 * with globals `tool` (the loaded tool function) and `assert`
 * (assert(cond,msg), assert.equal, assert.notEqual, assert.deepEqual,
 * assert.throws). Failures are collected, not thrown; the run is ok only
 * when zero failures were recorded.
 *
 * Network policy "deny" is enforced inside the runner prelude by stubbing
 * the http/https/net/tls/dns modules (via a guarded require) and fetch.
 */

export const DEFAULT_DENIED_COMMANDS = ["rm -rf /", "sudo", "curl | sh"];

export function defaultPolicy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
  return {
    timeoutMs: env.SANDBOX_TIMEOUT_MS,
    memoryMb: env.SANDBOX_MEMORY_MB,
    network: env.SANDBOX_NETWORK,
    allowedPaths: [],
    deniedCommands: [...DEFAULT_DENIED_COMMANDS],
    ...overrides,
  };
}

const RESULT_START = "__SW_RESULT__";
const RESULT_END = "__SW_END__";

/**
 * Static runner source. Written verbatim into the temp dir; all dynamic data
 * arrives via job.json so this string contains no interpolation.
 */
const RUNNER_SOURCE = `
"use strict";
const fs = require("fs");
const path = require("path");

const job = JSON.parse(fs.readFileSync(path.join(__dirname, "job.json"), "utf8"));
const logs = [];

function fmt(v) {
  if (typeof v === "string") return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

const captured = {};
for (const level of ["log", "info", "warn", "error", "debug"]) {
  captured[level] = function () {
    const args = Array.prototype.slice.call(arguments);
    logs.push("[" + level + "] " + args.map(fmt).join(" "));
  };
}

// ── network policy ─────────────────────────────────────────
const BLOCKED_MODULES = ["http", "https", "net", "tls", "dns", "node:http", "node:https", "node:net", "node:tls", "node:dns"];
const realRequire = require;
function sandboxRequire(id) {
  if (job.policy.network === "deny" && BLOCKED_MODULES.indexOf(id) !== -1) {
    throw new Error("network access denied by sandbox policy: " + id);
  }
  return realRequire(id);
}
if (job.policy.network === "deny") {
  globalThis.fetch = function () {
    return Promise.reject(new Error("network access denied by sandbox policy: fetch"));
  };
}

// ── tool loading (CommonJS convention) ─────────────────────
function loadTool(sourceCode) {
  const mod = { exports: {} };
  const factory = new Function("module", "exports", "require", "console", sourceCode);
  factory(mod, mod.exports, sandboxRequire, captured);
  if (typeof mod.exports === "function") return mod.exports;
  if (mod.exports && typeof mod.exports.default === "function") return mod.exports.default;
  throw new Error("tool source must assign module.exports = function(...) or exports.default");
}

// ── assert harness for runTests ────────────────────────────
function makeAssert(failures) {
  const assert = function (cond, msg) { if (!cond) failures.push(msg || "assertion failed"); };
  assert.ok = assert;
  assert.equal = function (a, b, msg) {
    if (!Object.is(a, b)) failures.push(msg || ("expected " + fmt(b) + " but got " + fmt(a)));
  };
  assert.notEqual = function (a, b, msg) {
    if (Object.is(a, b)) failures.push(msg || ("did not expect " + fmt(a)));
  };
  assert.deepEqual = function (a, b, msg) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      failures.push(msg || ("deepEqual failed: " + fmt(a) + " !== " + fmt(b)));
    }
  };
  assert.throws = function (fn, msg) {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) failures.push(msg || "expected function to throw");
  };
  return assert;
}

function safeValue(v) {
  try { JSON.stringify(v === undefined ? null : v); return v === undefined ? null : v; }
  catch (e) { return String(v); }
}

function writeResult(result) {
  let json;
  try {
    json = JSON.stringify(result);
  } catch (e) {
    json = JSON.stringify({ ok: false, error: "result not serializable: " + e.message, logs: [] });
  }
  process.stdout.write("${RESULT_START}\\n" + json + "\\n${RESULT_END}\\n");
}

(async function main() {
  try {
    if (job.mode === "test") {
      const tool = loadTool(job.sourceCode);
      const failures = [];
      const assert = makeAssert(failures);
      const testFn = new Function(
        "tool", "assert", "console", "require",
        "'use strict'; return (async function () {\\n" + job.testCode + "\\n})();"
      );
      await testFn(tool, assert, captured, sandboxRequire);
      writeResult({
        ok: failures.length === 0,
        output: { failures: failures },
        error: failures.length ? failures.join("; ") : undefined,
        logs: logs,
      });
    } else {
      const tool = loadTool(job.sourceCode);
      const output = await tool(job.input);
      writeResult({ ok: true, output: safeValue(output), logs: logs });
    }
  } catch (err) {
    writeResult({ ok: false, error: (err && err.message) || String(err), logs: logs });
  }
})();
`;

interface RunnerResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  logs: string[];
}

async function executeJob(
  mode: "run" | "test",
  sourceCode: string,
  input: unknown,
  testCode: string | undefined,
  policy: SandboxPolicy
): Promise<ToolRunResult> {
  const startedAt = Date.now();
  const root = path.join(process.cwd(), "sandbox-tmp");
  const dir = path.join(root, crypto.randomUUID());
  await fs.mkdir(dir, { recursive: true });

  const cleanup = async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    const job = { mode, sourceCode, testCode, input, policy };
    await fs.writeFile(path.join(dir, "job.json"), JSON.stringify(job), "utf8");
    await fs.writeFile(path.join(dir, "runner.js"), RUNNER_SOURCE, "utf8");

    return await new Promise<ToolRunResult>((resolve) => {
      const child = spawn(
        process.execPath,
        [`--max-old-space-size=${policy.memoryMb}`, path.join(dir, "runner.js")],
        {
          cwd: dir,
          // Environment scrubbed: tool code sees only PATH.
          env: { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL"); // hard kill — tool code cannot catch this
      }, policy.timeoutMs);

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error: `sandbox spawn failed: ${err.message}`,
          logs: [],
          durationMs: Date.now() - startedAt,
        });
      });

      child.on("close", () => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        if (timedOut) {
          resolve({
            ok: false,
            error: `timeout: killed after ${policy.timeoutMs}ms`,
            logs: stderr ? [`[stderr] ${stderr.slice(0, 500)}`] : [],
            durationMs,
          });
          return;
        }
        const start = stdout.indexOf(RESULT_START);
        const end = stdout.indexOf(RESULT_END);
        if (start === -1 || end === -1 || end < start) {
          resolve({
            ok: false,
            error: `sandbox crashed without a result: ${(stderr || stdout).slice(0, 500)}`,
            logs: stderr ? [`[stderr] ${stderr.slice(0, 500)}`] : [],
            durationMs,
          });
          return;
        }
        const raw = stdout.slice(start + RESULT_START.length, end).trim();
        try {
          const parsed = JSON.parse(raw) as RunnerResult;
          resolve({
            ok: parsed.ok,
            output: parsed.output,
            error: parsed.error,
            logs: Array.isArray(parsed.logs) ? parsed.logs : [],
            durationMs,
          });
        } catch (err) {
          resolve({
            ok: false,
            error: `sandbox returned invalid result JSON: ${err instanceof Error ? err.message : String(err)}`,
            logs: [],
            durationMs,
          });
        }
      });
    });
  } finally {
    await cleanup();
  }
}

export class LocalProcessSandbox implements SandboxAdapter {
  readonly name = "local-process";

  runJs(sourceCode: string, input: unknown, policy: SandboxPolicy): Promise<ToolRunResult> {
    return executeJob("run", sourceCode, input, undefined, policy);
  }

  runTests(sourceCode: string, testCode: string, policy: SandboxPolicy): Promise<ToolRunResult> {
    return executeJob("test", sourceCode, undefined, testCode, policy);
  }
}

let sandbox: SandboxAdapter | null = null;

/** Process-wide sandbox adapter (local by default; replaceable for remote). */
export function getSandbox(): SandboxAdapter {
  if (!sandbox) sandbox = new LocalProcessSandbox();
  return sandbox;
}
