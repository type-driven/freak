# Phase 13: Benchmarks — Freak vs Fresh - Research

**Researched:** 2026-02-28 **Domain:** HTTP benchmarking, Deno, Fresh 2 / Freak
framework comparison **Confidence:** HIGH (tool APIs), MEDIUM (methodology
patterns), LOW (island hydration automation)

---

## Research Summary

This phase establishes a benchmark harness in `packages/benchmarks/` that
compares Freak (this repo's `@fresh/core` fork with Effect v4 integration)
against upstream Fresh 2 (`jsr:@fresh/core@^2.2.0`) across four dimensions:
handler throughput, build time, bundle size, and server startup time. Island
hydration latency is possible but requires a headless browser
(Astral/Playwright) and is classified as stretch scope.

**Standard approach:** Run two server processes — a Freak app on port 8001 and
an equivalent upstream Fresh app on port 8002. Use `oha` (Rust HTTP load tester,
`brew install oha`) for throughput with `--output-format json --no-tui`. Use
`hyperfine` for build time and startup time with `--export-json`. Use
`deno bench` only for pure-Deno microbenchmarks (not HTTP load). Collect results
into a Deno script that writes `RESULTS.md`.

**Primary recommendation:** Use `oha` + `hyperfine` as the external measurement
tools (both installed via Homebrew), driven from a Deno orchestrator script.
`Deno.bench` is NOT suitable for HTTP throughput because it cannot do
multi-connection load generation.

---

## Benchmarking Approach (tools + methodology)

### Tool Selection

#### `oha` — HTTP Throughput (PRIMARY tool)

- **What:** Rust HTTP load generator inspired by `rakyll/hey`, TUI + JSON output
- **Install:** `brew install oha` (macOS, Apple Silicon native)
- **Why chosen over alternatives:**
  - `wrk` has LuaJIT ARM64 compile issues on Apple Silicon
  - `autocannon` is Node.js, CPU-bound, and known to undercount Deno/Bun
    throughput (see denosaurs/bench issue #41)
  - `k6` is powerful but heavyweight for simple req/s measurement
- **Key flags:**
  ```bash
  oha -n 10000 -c 50 --no-tui --output-format json http://localhost:8001/
  ```
  - `-n` requests total (supports k/m suffix: `-n 10k`)
  - `-c` concurrent connections
  - `--no-tui` suppress animated display (required for script use)
  - `--output-format json` structured output for automated collection
  - `--latency-correction` optional: avoids coordinated omission problem
  - `--disable-keepalive` optional: simulates connection-per-request scenario
- **JSON output schema:** includes `summary.requestsPerSec`, `summary.total`,
  `latencyPercentiles.p50/p90/p99`, `responseTimeHistogram`
- **Confidence:** HIGH (verified via official GitHub:
  https://github.com/hatoo/oha)

#### `hyperfine` — Build Time + Startup Time (PRIMARY tool)

- **What:** Command-line benchmarking for shell commands, statistical output
- **Install:** `brew install hyperfine`
- **Why chosen:** Cross-platform, warmup runs, outlier detection, JSON/Markdown
  export
- **Key flags:**
  ```bash
  hyperfine --warmup 3 --runs 10 --export-json results.json \
    'deno task --cwd=packages/benchmarks/freak-app build' \
    'deno task --cwd=packages/benchmarks/upstream-app build'
  ```
  - `--warmup N` warmup runs before measurement
  - `--runs N` number of timed runs (default: 10)
  - `--export-json FILE` structured output
  - `--export-markdown FILE` human-readable table
  - `--prepare CMD` setup before each run (e.g., `rm -rf _fresh`)
- **Confidence:** HIGH (verified via https://github.com/sharkdp/hyperfine)

#### `deno bench` — Microbenchmarks (SECONDARY tool)

- **What:** Built-in Deno benchmarking for in-process code measurement
- **Use cases:** Pure handler dispatch overhead (calling
  `app.handler()(req, info)` in a tight loop), router matching, middleware chain
- **NOT suitable for:** Multi-connection HTTP load, network throughput
  comparisons
- **API:**
  ```typescript
  Deno.bench({
    name: "handler dispatch",
    group: "freak",
    baseline: true,
    fn: async () => {
      await freakHandler(req, connInfo);
    },
  });
  Deno.bench({
    name: "handler dispatch",
    group: "freak",
    fn: async () => {
      await upstreamHandler(req, connInfo);
    },
  });
  ```
- **CLI:** `deno bench --json bench_handler.ts` produces structured JSON with
  `n`, `min`, `max`, `avg`, `p75`, `p99`, `p995` (nanoseconds)
- **Default iterations:** Runs until statistically stable (replaces old
  `n`/`warmup` params in Deno v1.21+). Can still set
  `Deno.bench({ n: 1000, warmup: 100, ... })`
- **Confidence:** HIGH (verified via
  https://docs.deno.com/runtime/reference/cli/bench/)

#### Prerequisite Check

The benchmark orchestrator must verify tools are available before running:

```typescript
async function checkTool(name: string): Promise<boolean> {
  const cmd = new Deno.Command("which", {
    args: [name],
    stdout: "null",
    stderr: "null",
  });
  const { code } = await cmd.output();
  return code === 0;
}
```

Install instructions if missing: `brew install oha hyperfine`

---

## Dimensions to Measure

### Dimension 1: Handler Throughput (req/s)

- **What:** Requests per second for a simple JSON API route under load
- **Scenarios:**
  1. **Freak: plain handler** — standard Fresh handler returning JSON (no
     Effect)
  2. **Freak: Effect handler** — `Effect.gen` handler going through Effect
     runtime
  3. **Upstream: plain handler** — equivalent route in upstream
     `jsr:@fresh/core`
- **Why three:** Isolates the overhead introduced by Effect specifically
- **Tool:** `oha -n 10000 -c 50 --no-tui --output-format json`
- **Warmup:** 2000 requests before timed run
- **Report metric:** `summary.requestsPerSec` (p50, p90, p99 latency)

### Dimension 2: Build Time

- **What:** Time to run `deno task build` (the AOT esbuild step) from cold cache
- **What gets built:** Island JS bundles to `_fresh/static/` and `snapshot.js`
- **Tool:** `hyperfine --warmup 1 --runs 5 --prepare 'rm -rf _fresh'`
- **Report metric:** mean build time in seconds, stddev

### Dimension 3: Bundle Size

- **What:** Total size of JS sent to browser (island chunks in `_fresh/static/`)
- **Approach:** After build, walk `_fresh/static/` and sum `.js` file sizes
  ```typescript
  for await (const entry of Deno.readDir("_fresh/static")) {
    if (entry.name.endsWith(".js")) totalBytes += (await Deno.stat(...)).size;
  }
  ```
- **Report metrics:** total gzipped size, total raw size, number of chunks
- **Note:** Gzip size matters more for user experience; use `CompressionStream`
  or shell `gzip -c file | wc -c`
- **Confidence:** HIGH — `_fresh/static/` is confirmed from source code
  inspection (packages/fresh/src/dev/builder.ts line 286:
  `const staticOutDir = path.join(outDir, "static")`)

### Dimension 4: Server Startup Time

- **What:** Time from `deno serve -A _fresh/server.js` to first successful HTTP
  response
- **Tool:** `hyperfine` with
  `--prepare 'kill $(lsof -ti:8001) 2>/dev/null; true'`
- **Alternative:** Script-based: spawn `Deno.Command`, poll until
  `fetch("http://localhost:8001/")` succeeds, measure elapsed time
- **Report metric:** time-to-first-response in milliseconds

### Dimension 5 (STRETCH): Island Hydration Latency

- **What:** Time from page load to island being interactive
- **Tool:** Astral (`jsr:@astral/astral@^0.5.5`) — already in workspace deps
- **Approach:** Use
  `page.evaluate(() => performance.getEntriesByName("island-hydrated")[0]?.duration)`
  with custom `performance.mark` calls in islands
- **Risk:** Requires modifying island code to emit marks; highly
  environment-sensitive
- **Recommendation:** Defer to stretch scope; note as "future work" in
  RESULTS.md

---

## Comparison Setup (Freak vs Fresh side-by-side)

### App Parity Requirement

Both benchmark apps must have **identical feature sets** to make the comparison
fair:

- Same route structure: `GET /` (plain HTML), `GET /api/todos` (JSON),
  `GET /api/slow` (simulated I/O)
- Same number of islands (one interactive island)
- No database — in-memory data
- No TailwindCSS (adds build complexity without measuring framework overhead)

### Project Structure within packages/benchmarks/

```
packages/benchmarks/
├── deno.json                    # workspace member, tasks: bench, bench:build, bench:throughput
├── apps/
│   ├── freak-app/               # Freak with Effect handler
│   │   ├── deno.json            # imports: @fresh/core from local path, effect npm pkg
│   │   ├── main.ts              # entry: createEffectApp().fsRoutes().app
│   │   ├── dev.ts               # builder for AOT build
│   │   ├── routes/
│   │   │   ├── index.tsx        # plain SSR page
│   │   │   └── api/
│   │   │       └── todos.ts     # GET /api/todos — returns JSON
│   │   └── islands/
│   │       └── Counter.tsx      # one interactive island
│   ├── freak-plain-app/         # Freak WITHOUT Effect (plain handler) — isolates overhead
│   │   └── ...                  # same structure, handler returns Response directly
│   └── upstream-app/            # Upstream Fresh 2 from JSR
│       ├── deno.json            # imports: @fresh/core from jsr:@fresh/core@2.2.x
│       ├── main.ts              # entry: new App().fsRoutes()
│       └── ...                  # identical routes to freak-app
├── scripts/
│   ├── bench.ts                 # main orchestrator (runs all dimensions, writes RESULTS.md)
│   ├── bench_throughput.ts      # oha runner, server lifecycle, JSON collection
│   ├── bench_build.ts           # hyperfine build time runner
│   ├── bench_bundle.ts          # _fresh/static size calculator
│   ├── bench_startup.ts         # server startup time measurement
│   └── check_tools.ts           # verify oha, hyperfine installed
└── RESULTS.md                   # generated output (committed after running)
```

### Freak App Import Mapping

The `freak-app/deno.json` imports `@fresh/core` from the local packages:

```json
{
  "imports": {
    "@fresh/core": "../../fresh/src/mod.ts",
    "@fresh/effect": "../../effect/src/mod.ts",
    "effect": "npm:effect@^4.0.0-beta.20"
  }
}
```

### Upstream App Import Mapping

The `upstream-app/deno.json` imports from JSR:

```json
{
  "imports": {
    "@fresh/core": "jsr:@fresh/core@2.2.0",
    "@fresh/core/dev": "jsr:@fresh/core@2.2.0/dev"
  }
}
```

**Version pin:** Use exact version `2.2.0` (confirmed latest stable on JSR as of
2026-02-28), not a range, to ensure reproducible comparisons.

### Server Lifecycle Pattern

The throughput benchmark script manages server processes:

```typescript
// Start server process
const proc = new Deno.Command("deno", {
  args: ["serve", "-A", "--port=8001", "_fresh/server.js"],
  cwd: appDir,
  stdout: "piped",
  stderr: "piped",
}).spawn();

// Wait for readiness by polling
let ready = false;
for (let i = 0; i < 50; i++) { // max 5 seconds
  await new Promise((r) => setTimeout(r, 100));
  try {
    const res = await fetch("http://localhost:8001/");
    if (res.ok) {
      ready = true;
      break;
    }
  } catch { /* not ready yet */ }
}
if (!ready) throw new Error("Server failed to start");

// Run oha
const ohaResult = await new Deno.Command("oha", {
  args: [
    "-n",
    "10000",
    "-c",
    "50",
    "--no-tui",
    "--output-format",
    "json",
    "http://localhost:8001/api/todos",
  ],
  stdout: "piped",
}).output();
const stats = JSON.parse(new TextDecoder().decode(ohaResult.stdout));

// Cleanup
proc.kill("SIGTERM");
await proc.status;
```

### Port Assignments

| App                             | Port |
| ------------------------------- | ---- |
| freak-app (Effect handler)      | 8001 |
| freak-plain-app (plain handler) | 8002 |
| upstream-app                    | 8003 |

---

## Package Structure (`packages/benchmarks/`)

### `deno.json` Tasks

```json
{
  "name": "@fresh/benchmarks",
  "version": "0.1.0",
  "tasks": {
    "bench": "deno run -A scripts/bench.ts",
    "bench:throughput": "deno run -A scripts/bench_throughput.ts",
    "bench:build": "deno run -A scripts/bench_build.ts",
    "bench:bundle": "deno run -A scripts/bench_bundle.ts",
    "bench:startup": "deno run -A scripts/bench_startup.ts",
    "build:all": "deno task build:freak && deno task build:upstream",
    "build:freak": "deno task --cwd=apps/freak-app build",
    "build:upstream": "deno task --cwd=apps/upstream-app build"
  }
}
```

### `scripts/bench.ts` Orchestrator Pattern

```typescript
// Pseudocode structure
const results = {
  meta: {
    date: new Date().toISOString(),
    freakVersion: "2.2.1",
    upstreamVersion: "2.2.0",
  },
  throughput: await runThroughputBench(), // calls oha
  buildTime: await runBuildTimeBench(), // calls hyperfine
  bundleSize: await runBundleSizeBench(), // walks _fresh/static
  startupTime: await runStartupTimeBench(), // spawn + poll
};
await Deno.writeTextFile("RESULTS.md", renderMarkdown(results));
```

### `RESULTS.md` Template Structure

```markdown
# Freak vs Fresh 2 Benchmark Results

**Date:** YYYY-MM-DD **Freak version:** 2.2.1 (local) **Upstream Fresh
version:** jsr:@fresh/core@2.2.0 **Machine:** Apple M[x], [RAM], Deno [version]
**Methodology:** [brief description]

## Summary Table

| Dimension             | Upstream Fresh | Freak (plain) | Freak (Effect) | Effect overhead |
| --------------------- | -------------- | ------------- | -------------- | --------------- |
| Throughput (req/s)    | N              | N             | N              | +X%             |
| Build time (s)        | N              | N             | N              | +X%             |
| Bundle size (KB gzip) | N              | N             | N              | +X KB           |
| Startup time (ms)     | N              | N             | N              | +X ms           |

## Raw Results

### Handler Throughput

...

### Build Time

...

## Notes on Effect Overhead

...
```

---

## Key Risks & Mitigations

### Risk 1: `oha`/`hyperfine` Not Installed

**Problem:** Benchmark script fails silently or with cryptic errors.
**Mitigation:** `check_tools.ts` runs at the start of `bench.ts`, prints clear
install instructions and exits if tools are missing:

```
Missing required tools:
  - oha: brew install oha
  - hyperfine: brew install hyperfine
```

**Confidence:** HIGH

### Risk 2: App Parity Drift

**Problem:** Freak app and upstream app diverge in features over time, making
comparisons unfair or misleading. **Mitigation:** Keep both apps' routes as a
single source of truth in a shared `apps/shared/` directory. Both apps import
the same route handler logic but wire it through their respective framework
APIs. Document any intentional differences in RESULTS.md methodology section.

### Risk 3: Build Output in Working Tree

**Problem:** Running `deno task build` writes `_fresh/` into the benchmark app
directories, potentially dirtying the git working tree or causing CI confusion.
**Mitigation:** Add `apps/*/._fresh/` to `.gitignore` in the benchmarks package.
Use `--prepare 'rm -rf _fresh'` in hyperfine commands to ensure cold builds.

### Risk 4: Port Conflicts

**Problem:** Benchmark ports (8001–8003) conflict with other dev servers.
**Mitigation:** At the start of each benchmark run, kill any processes listening
on the target ports:

```typescript
await new Deno.Command("sh", {
  args: ["-c", "lsof -ti:8001,8002,8003 | xargs kill -9 2>/dev/null; true"],
}).output();
```

### Risk 5: Deno Module Cache State

**Problem:** First run downloads all JSR/npm modules; subsequent runs hit cache.
Benchmarked "build time" may include download time on first run. **Mitigation:**
Run `deno task build:all` once before benchmarking (cache warm-up). Document
"requires pre-warmed Deno module cache" in RESULTS.md.

### Risk 6: Effect v4 beta instability

**Problem:** `effect@4.0.0-beta.20` may have performance regressions vs stable
Effect 3.x or future stable Effect 4.x. **Mitigation:** Record exact Effect
version in results metadata. Frame overhead as "Effect v4 beta" overhead, not
"Effect" overhead in general. This is the version Freak currently depends on per
`packages/effect/deno.json`.

### Risk 7: `freak-app` requires Effect layer build-up on each request

**Problem:** Unlike plain handlers, Effect handlers build layers per request (or
share a managed runtime). Measurement must reflect the actual production pattern
(pre-built `ManagedRuntime` reused across requests). **Mitigation:** The
`freak-app` must use `ManagedRuntime` at app level (not per-request
`Effect.runPromise`). This matches how the example app works in
`packages/examples/effect-integration/main.ts`. Document this explicitly.

### Risk 8: `upstream-app` version mismatch

**Problem:** Freak is based on `@fresh/core@2.2.1` (local fork). Upstream is
`jsr:@fresh/core@2.2.0`. They may have small behavioral differences.
**Mitigation:** Lock upstream to `2.2.0` exactly. Note version delta in
RESULTS.md. If Freak is further ahead, consider pinning to common ancestor.

---

## State of the Art

| Old Approach           | Current Approach        | Notes                                        |
| ---------------------- | ----------------------- | -------------------------------------------- |
| `deno bench` for HTTP  | External `oha` for HTTP | `deno bench` cannot do multi-connection load |
| `wrk` on macOS         | `oha` on macOS          | wrk has ARM64/LuaJIT issues                  |
| `autocannon` (Node.js) | `oha` (Rust)            | autocannon undercounts Deno throughput       |
| Manual timing          | `hyperfine`             | Statistical analysis, warmup, JSON export    |

---

## References

### Primary (HIGH confidence)

- `oha` official GitHub: https://github.com/hatoo/oha — flags, JSON schema,
  install
- `hyperfine` official GitHub: https://github.com/sharkdp/hyperfine — usage,
  flags, export formats
- Deno bench CLI reference: https://docs.deno.com/runtime/reference/cli/bench/ —
  API, JSON output schema
- `jsr:@fresh/core` versions: https://jsr.io/@fresh/core/versions — current
  stable = 2.2.0
- Freak source: `packages/fresh/src/dev/builder.ts` lines 286, 336 —
  `_fresh/static/` path confirmed
- Freak source: `packages/fresh/src/app.ts` lines 67–146 — `listen()` pattern,
  `Deno.serve`

### Secondary (MEDIUM confidence)

- denosaurs/bench issue #41: autocannon undercounts Deno/Bun
  (https://github.com/denosaurs/bench/issues/41)
- Deno.Command API: https://docs.deno.com/api/deno/~/Deno.Command — spawn,
  stdout piped, kill

### Tertiary (LOW confidence)

- Fresh AOT build docs:
  `https://fresh.deno.dev/docs/concepts/ahead-of-time-builds` (404 as of
  research date — confirmed from source code instead)
- Island hydration timing via Astral: no official benchmarking pattern found;
  stretch scope

---

## Metadata

**Confidence breakdown:**

- Benchmarking tools (oha, hyperfine): HIGH — verified via official repos
- `deno bench` API: HIGH — verified via official docs
- Build output structure (`_fresh/static/`): HIGH — confirmed from source code
- Upstream Fresh version (2.2.0): HIGH — confirmed via JSR
- Comparison app structure: MEDIUM — pattern derived from existing example app
- Island hydration timing: LOW — no established pattern found

**Research date:** 2026-02-28 **Valid until:** 2026-04-28 (60 days —
oha/hyperfine are stable; Effect beta may change)
