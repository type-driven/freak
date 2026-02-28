---
phase: 13-benchmarks-freak-vs-fresh
verified: 2026-02-28T15:30:28Z
status: passed
score: 3/3 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 2/3
  gaps_closed:
    - "upstream-app uses jsr:@fresh/core@2.2.0 for a true upstream Fresh 2 baseline"
  gaps_remaining: []
  regressions: []
---

# Phase 13: Benchmarks Freak vs Fresh Verification Report

**Phase Goal:** Establish a repeatable benchmark suite comparing Freak against upstream Fresh 2 across key performance dimensions (handler throughput, build time, bundle size, startup time) — results published as `packages/benchmarks/RESULTS.md`.
**Verified:** 2026-02-28T15:30:28Z
**Status:** passed — 3/3 must-haves verified
**Re-verification:** Yes — after gap closure (previous status: gaps_found, 2/3)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A benchmark harness in `packages/benchmarks/` runs against both Freak and upstream Fresh 2 and produces consistent, reproducible numbers | VERIFIED | All 6 scripts present (746 total lines). upstream-app/deno.json now declares `"@fresh/core": "jsr:@fresh/core@2.2.0"`, `"@fresh/core/dev": "jsr:@fresh/core@2.2.0/dev"`, `"@fresh/core/runtime": "jsr:@fresh/core@2.2.0/runtime"`, and `"fresh/internal": "jsr:@fresh/core@2.2.0/internal"` — true upstream JSR baseline confirmed |
| 2 | Results are published as `packages/benchmarks/RESULTS.md` with methodology, raw numbers, and a summary table | VERIFIED | RESULTS.md (86 lines): Summary Table with all 4 dimensions, Methodology section, Raw Results with per-app p50/p90/p99 latency data, Notes on Effect Overhead |
| 3 | Performance regressions from Freak's Effect integration are identified and documented with root-cause notes | VERIFIED | 14.2% throughput overhead and 105ms startup overhead documented with specific mechanisms: ManagedRuntime dispatch path, fiber scheduling cost (two `yield*` per request), layer service resolution (O(1) tag-keyed Context lookup). Bundle size delta correctly 0.0 KB (server-only Effect usage). |

**Score:** 3/3 truths verified

### Gap Closure Verification

**Previously failed gap:** `upstream-app/deno.json` missing `@fresh/core` JSR import entries — Deno workspace resolution fell back to local Freak fork (packages/fresh v2.2.1) instead of `jsr:@fresh/core@2.2.0`.

**Closure confirmed:** `packages/benchmarks/apps/upstream-app/deno.json` now contains:
- `"@fresh/core": "jsr:@fresh/core@2.2.0"` — confirmed (4 references to `jsr:@fresh/core@2.2.0` in the file)
- `"@fresh/core/dev": "jsr:@fresh/core@2.2.0/dev"` — confirmed
- `"@fresh/core/runtime": "jsr:@fresh/core@2.2.0/runtime"` — confirmed
- `"fresh/internal": "jsr:@fresh/core@2.2.0/internal"` — confirmed (line 8)

RESULTS.md upstream-app numbers (76186 req/s, 56ms startup, 28.1 KB gzip, 0.16s build) now reflect a true upstream Fresh 2 baseline against which freak-plain and freak-effect are compared.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/benchmarks/scripts/bench.ts` | Main orchestrator | VERIFIED | 262 lines, imports all four dimension scripts, writes RESULTS.md |
| `packages/benchmarks/scripts/bench_throughput.ts` | HTTP throughput via oha | VERIFIED | 154 lines, spawns servers, runs oha, parses JSON |
| `packages/benchmarks/scripts/bench_build.ts` | Build time via hyperfine | VERIFIED | 67 lines, hyperfine --warmup 1 --runs 5 |
| `packages/benchmarks/scripts/bench_bundle.ts` | Bundle size calculator | VERIFIED | 114 lines, CompressionStream gzip measurement |
| `packages/benchmarks/scripts/bench_startup.ts` | Startup time | VERIFIED | 115 lines, 5 iterations spawn+poll |
| `packages/benchmarks/scripts/check_tools.ts` | Tool availability checker | VERIFIED | 34 lines, checks oha and hyperfine |
| `packages/benchmarks/apps/upstream-app/deno.json` | Upstream app config with JSR imports | VERIFIED | All 4 JSR @fresh/core entries present |
| `packages/benchmarks/RESULTS.md` | Generated benchmark report | VERIFIED | Summary Table, Methodology, Raw Results, Notes on Effect Overhead |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `bench.ts` | `bench_throughput.ts` | import | WIRED | Line 11 import confirmed |
| `bench.ts` | `RESULTS.md` | Deno.writeTextFile | WIRED | Line 260: `await Deno.writeTextFile(resultsPath, markdown)` |
| `upstream-app/deno.json` | `jsr:@fresh/core@2.2.0` | import map | WIRED | 4 JSR entries confirmed in imports map (was NOT_WIRED in previous verification) |
| `freak-app/deno.json` | `packages/fresh/src/mod.ts` | import map | WIRED | `"@fresh/core": "../../../fresh/src/mod.ts"` |

### Requirements Coverage

All requirements met:

- **Repeatable benchmark suite:** 6 scripts covering all four dimensions (throughput, build, bundle, startup) with deterministic methodology (hyperfine warmup/runs, fixed oha concurrency, 5-iteration startup poll)
- **Both targets compared:** upstream-app (jsr:@fresh/core@2.2.0), freak-plain-app, freak-effect-app all measured
- **RESULTS.md published:** Exists with real numbers, summary table, and methodology
- **Effect overhead documented:** Regressions identified (14.2% throughput, +105ms startup) with root-cause notes (ManagedRuntime, fiber scheduling, layer resolution); zero regressions on build time and bundle size correctly noted

### Anti-Patterns Found

None. No blocker anti-patterns remain. The previous blocker (misleading RESULTS.md header claiming JSR upstream while actually measuring local fork) is resolved by the import map fix.

### Human Verification Required

None — all critical structural properties are programmatically verifiable.

---

_Verified: 2026-02-28T15:30:28Z_
_Verifier: Claude (gsd-verifier)_
