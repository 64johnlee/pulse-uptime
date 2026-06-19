#!/usr/bin/env node
/**
 * Production health gate.
 *
 * Probes each configured production URL and fails (exit 1) unless every target
 * returns its expected status (default 200) and, optionally, contains an
 * expected body marker. This is the automated check that MUST pass before a
 * production incident may be marked resolved/closed — it replaces "the board
 * approved it" with "the live URL actually returns 200".
 *
 * No dependencies (Node 18+ global fetch). Usage:
 *   node scripts/check-production-health.mjs                 # uses ./production-targets.json
 *   node scripts/check-production-health.mjs --config p.json
 *   node scripts/check-production-health.mjs --url pulse-web=https://pulse-web-prod.vercel.app
 *   node scripts/check-production-health.mjs --json          # machine-readable output
 *
 * Exit codes: 0 = all healthy, 1 = one or more unhealthy, 2 = bad invocation.
 */
import { readFileSync } from "node:fs";

const DEFAULTS = { status: 200, retries: 5, delayMs: 6000, timeoutMs: 15000 };

function parseArgs(argv) {
  const opts = { configPath: "production-targets.json", json: false, urls: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--config") opts.configPath = argv[++i];
    else if (a === "--url") opts.urls.push(argv[++i]);
    else if (a === "--help" || a === "-h") opts.help = true;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

function loadTargets(opts) {
  // --url name=URL flags take precedence; else PRODUCTION_TARGETS env; else config file.
  if (opts.urls.length) {
    return opts.urls.map((pair) => {
      const idx = pair.indexOf("=");
      if (idx === -1) {
        console.error(`--url expects name=URL, got: ${pair}`);
        process.exit(2);
      }
      return { name: pair.slice(0, idx), url: pair.slice(idx + 1), expect: {} };
    });
  }
  const raw = process.env.PRODUCTION_TARGETS
    ? process.env.PRODUCTION_TARGETS
    : readFileSync(opts.configPath, "utf8");
  const parsed = JSON.parse(raw);
  const targets = Array.isArray(parsed) ? parsed : parsed.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    console.error("No targets found. Provide production-targets.json with a non-empty `targets` array.");
    process.exit(2);
  }
  return targets;
}

/** Human-friendly hint for the common failure statuses we saw in the P0. */
function hintFor(status) {
  if (status === 401) return "behind Vercel deployment protection or no public custom-domain alias";
  if (status === 404) return "no production deployment assigned (BLOCKED/ERROR build or missing alias)";
  if (status >= 500) return "server error — app deployed but crashing";
  if (status === 0) return "no response (DNS/network/timeout)";
  return "unexpected status";
}

async function probeOnce(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: "manual", signal: ac.signal });
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: "", error: err?.name === "AbortError" ? "timeout" : String(err?.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkTarget(t) {
  const expectStatus = t.expect?.status ?? DEFAULTS.status;
  const bodyIncludes = t.expect?.bodyIncludes;
  const retries = t.retries ?? DEFAULTS.retries;
  const delayMs = t.delayMs ?? DEFAULTS.delayMs;
  const timeoutMs = t.timeoutMs ?? DEFAULTS.timeoutMs;

  let last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const r = await probeOnce(t.url, timeoutMs);
    const statusOk = r.status === expectStatus;
    const bodyOk = !bodyIncludes || r.body.toLowerCase().includes(String(bodyIncludes).toLowerCase());
    last = { ...r, statusOk, bodyOk, attempt };
    if (statusOk && bodyOk) {
      return { name: t.name, url: t.url, healthy: true, status: r.status, attempts: attempt };
    }
    if (attempt < retries) await new Promise((res) => setTimeout(res, delayMs));
  }

  let reason;
  if (!last.statusOk) reason = `got ${last.status} (expected ${expectStatus}) — ${last.error || hintFor(last.status)}`;
  else reason = `body missing expected marker "${bodyIncludes}"`;
  return { name: t.name, url: t.url, healthy: false, status: last.status, attempts: last.attempt, reason };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log("Usage: node scripts/check-production-health.mjs [--config p.json] [--url name=URL] [--json]");
    process.exit(0);
  }
  const targets = loadTargets(opts);
  const results = [];
  for (const t of targets) results.push(await checkTarget(t));
  const failed = results.filter((r) => !r.healthy);

  if (opts.json) {
    console.log(JSON.stringify({ healthy: failed.length === 0, results }, null, 2));
  } else {
    console.log("\nProduction health check");
    console.log("=".repeat(60));
    for (const r of results) {
      const mark = r.healthy ? "✅ PASS" : "❌ FAIL";
      console.log(`${mark}  ${r.name.padEnd(16)} ${r.url}`);
      console.log(`        HTTP ${r.status} after ${r.attempts} attempt(s)${r.healthy ? "" : ` — ${r.reason}`}`);
    }
    console.log("=".repeat(60));
    console.log(failed.length === 0
      ? `All ${results.length} target(s) healthy — safe to close.`
      : `${failed.length}/${results.length} target(s) UNHEALTHY — do NOT close the incident.`);
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("health check crashed:", err);
  process.exit(1);
});
