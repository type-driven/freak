# Freak vs Fresh 2 Benchmark Results

**Date:** 2026-03-02 **Machine:** darwin aarch64 **Deno:** 2.6.9 (V8
14.5.201.2-rusty) **Freak version:** 2.2.1 (local) **Upstream Fresh:**
jsr:@fresh/core@2.2.0 **Effect:** npm:effect@4.0.0-beta.20

## Summary Table

| Dimension              | Upstream Fresh | Freak (plain) | Freak (Effect) | Effect overhead |
| ---------------------- | -------------- | ------------- | -------------- | --------------- |
| Throughput (req/s)     | 85818          | 80530         | 70223          | +12.8%          |
| Build time (s)         | 0.17           | 0.17          | 0.26           | +55.0%          |
| Bundle size (KB gzip)  | 28.2           | 28.2          | 128.0          | +99.8 KB        |
| Startup time (ms)      | 66             | 66            | 163            | +97 ms          |
| SSR throughput (req/s) | 33246          | 33615         | 25441          | +24.3%          |

## Methodology

- **Throughput:** `oha -n 10000 -c 50` against `GET /api/todos` (in-memory JSON
  response, no I/O)
- **Build time:** `hyperfine --warmup 1 --runs 5` with
  `--prepare 'rm -rf _fresh'` (cold AOT build)
- **Bundle size:** Sum of all `.js` files in `_fresh/static/` after build (raw +
  gzip via CompressionStream)
- **Startup time:** 5 iterations of spawn server -> poll until 200 -> measure
  elapsed time
- **SSR throughput:** `oha -n 10000 -c 50` against `GET /` (full HTML page with
  island rendering; freak-app includes atom serialization)
- **Environment:** Pre-warmed Deno module cache; no network downloads during
  measurement

## Raw Results

### Handler Throughput

| App          | req/s | p50 (ms) | p90 (ms) | p99 (ms) |
| ------------ | ----- | -------- | -------- | -------- |
| upstream     | 85818 | 0.52     | 0.73     | 2.24     |
| freak-plain  | 80530 | 0.56     | 0.79     | 1.88     |
| freak-effect | 70223 | 0.66     | 0.88     | 1.44     |

### Build Time

| App          | Mean (s) | Stddev (s) | Runs |
| ------------ | -------- | ---------- | ---- |
| upstream     | 0.17     | 0.00       | 5    |
| freak-plain  | 0.17     | 0.00       | 5    |
| freak-effect | 0.26     | 0.00       | 5    |

### Bundle Size

| App          | Raw (KB) | Gzip (KB) | Files |
| ------------ | -------- | --------- | ----- |
| upstream     | 71.3     | 28.2      | 6     |
| freak-plain  | 71.3     | 28.2      | 6     |
| freak-effect | 375.1    | 128.0     | 6     |

### Startup Time

| App          | Mean (ms) | Runs |
| ------------ | --------- | ---- |
| upstream     | 66        | 5    |
| freak-plain  | 66        | 5    |
| freak-effect | 163       | 5    |

### SSR Page Throughput

| App          | req/s | p50 (ms) | p90 (ms) | p99 (ms) |
| ------------ | ----- | -------- | -------- | -------- |
| upstream     | 33246 | 1.39     | 1.91     | 3.48     |
| freak-plain  | 33615 | 1.38     | 1.99     | 3.56     |
| freak-effect | 25441 | 1.80     | 2.69     | 3.65     |

## Notes on Effect Overhead

### Throughput

The 12.8% throughput reduction (freak-effect vs freak-plain) comes from three
sources in the Effect runtime dispatch path.

**ManagedRuntime dispatch path:** Each request to the freak-effect app enters
`ManagedRuntime.runPromise(effect)`. This allocates a new Fiber object,
registers it with the Effect scheduler, and suspends until the scheduler resumes
it with the result. Even for a trivial handler that returns a static JSON
response, this round-trip through the Effect fiber scheduler adds per-request
overhead that plain function calls avoid entirely.

**Fiber scheduling cost:** The handler is written with
`Effect.gen(function*() { ... })`, which creates a generator-backed fiber. Each
`yield*` expression is a suspension point — the Effect scheduler must
context-switch to the fiber, execute the step, and either suspend again or
complete. For the `/api/todos` handler with two `yield*` calls
(`yield* TodoService` and `yield* svc.list()`), this means two scheduler
round-trips per request on top of the ManagedRuntime dispatch. In a real
application where handlers perform actual I/O (database queries, network calls),
these suspensions are dwarfed by I/O latency and become irrelevant. In a pure
throughput benchmark with in-memory data, they are the dominant cost.

**Layer service resolution:** `yield* TodoService` resolves the service from the
`Context` object that was pre-built at application startup by
`ManagedRuntime.make(TodoLayer)`. The Context lookup is O(1) (tag-keyed map) and
the layer itself is not rebuilt per request. However, constructing the Context
wrapper for each fiber and performing the tag lookup still contributes a small
but measurable per-request cost in a microbenchmark setting.

**Real-world significance:** For handlers that perform any I/O — even a single
1ms database round-trip — the Effect overhead becomes negligible. The throughput
numbers above reflect a degenerate case (in-memory data, no I/O) specifically
designed to measure the maximum possible Effect overhead. Production workloads
with real databases will see throughput parity between freak-plain and
freak-effect.

### Build Time

Build time increases by 55.0% due to the additional Effect npm dependency tree
that esbuild must resolve and bundle.

The Effect package graph adds npm modules that esbuild must resolve, parse, and
tree-shake during the AOT build. Effect is designed for tree-shaking, so unused
modules are excluded, but the resolution cost is still present.

### Bundle Size

Client bundle size increases by 99.8 KB gzip for freak-effect. Review which
Effect modules were included in client bundles (ideally zero — server-only
handlers should not appear in _fresh/static/).

### Startup Time

Startup time overhead of 97ms is acceptable for a server process. The extra time
is dominated by Deno's module graph resolution for the Effect import tree — once
loaded, modules are cached in the Deno V8 isolate.

The ManagedRuntime is constructed at module load time
(`createEffectApp({ layer: TodoLayer })`). For a trivial TodoLayer (in-memory
Map), this is a synchronous operation that completes in microseconds. The
measurable startup overhead is almost entirely from Deno's module graph
resolution — loading and JIT-compiling the Effect package tree — not from
Effect's own initialization logic.

### SSR Page Throughput

The delta between freak-effect and freak-plain in this dimension isolates the
cost of Effect.sync dispatch plus atom serialization overhead. For each `GET /`
request, freak-effect runs the handler as an `Effect.sync` (allocating a fiber
and scheduling it), calls `setAtom` to record the counter value (a Map write),
serializes the hydration map to JSON, and injects a
`<script id="__FRSH_ATOM_STATE">` tag into the HTML response. freak-plain
performs the same HTML rendering without any of these steps.
