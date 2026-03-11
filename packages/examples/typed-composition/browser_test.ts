/**
 * browser_test.ts — Puppeteer-style browser E2E tests for typed composition.
 *
 * Uses @astral/astral (Deno's headless browser automation) to validate:
 *   1. RENDERING    — index page loads with correct title and links
 *   2. STATE        — counter increments, resets; auth state flows through greet
 *   3. REACTIVITY   — sequential requests observe correct accumulated state
 *   4. COMPOSITION  — two plugins on one host, no route conflicts
 *   5. PERFORMANCE  — p50 / p95 / p99 latency for API endpoints
 *
 * Design: starts the EffectApp in-process with Deno.serve on a random port.
 * No build step — tests JSON API routes and SSR HTML; island client JS is not
 * exercised because the islands are static (display-only, no hydration needed).
 *
 * Browser tests navigate to the server origin first so that same-origin fetch()
 * calls in page.evaluate() work without CORS issues.
 *
 * Run:
 *   deno test -A packages/examples/typed-composition/browser_test.ts
 */

import { launch } from "@astral/astral";
import { expect } from "@std/expect";
import { App } from "@fresh/core";
import { createEffectApp } from "@fresh/core/effect";
import * as Layer from "effect/Layer";
import { CounterLive, createCounterPlugin } from "./counter_plugin.tsx";
import { createGreetingPlugin, GreetingLive } from "./greeting_plugin.tsx";

// ---------------------------------------------------------------------------
// Shared auth state type (mirrors main.ts)
// ---------------------------------------------------------------------------

interface AuthState {
  requestId: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Build a fresh EffectApp with both plugins mounted and AuthState middleware.
 * Includes a simple /index route so page.goto(base) has a page to land on.
 * Returns { handler, dispose } — dispose() tears down the managed runtime.
 */
function makeApp() {
  const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);
  type AppR = typeof combinedLayer extends
    Layer.Layer<infer A, infer _E, infer _R> ? A
    : never;

  const effectApp = createEffectApp<AuthState, AppR>({ layer: combinedLayer });

  // Auth middleware: set typed state fields on every request
  effectApp.use((ctx) => {
    ctx.state.requestId = "test-req-" + Date.now();
    ctx.state.userId = "test-user";
    return ctx.next();
  });

  effectApp.mountApp("/counter", createCounterPlugin<AuthState>());
  effectApp.mountApp("/greeting", createGreetingPlugin<AuthState>());

  // Add a minimal index route so the browser has a page to navigate to.
  // This lets page.evaluate() fetch same-origin without CORS issues.
  // (fsRoutes() is not used here — would require a full build step.)
  const indexApp = new App<AuthState>();
  indexApp.get("/", (_ctx) =>
    new Response(
      `<!DOCTYPE html><html><head><title>Typed Composition Demo</title></head>
<body>
  <h1>Typed Composition Demo</h1>
  <p>Two plugins mounted on one EffectApp with typed AuthState.</p>
  <ul>
    <li><a href="/counter/count">GET /counter/count</a></li>
    <li><a href="/greeting/greet">GET /greeting/greet</a></li>
  </ul>
</body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ));
  effectApp.mountApp("", indexApp);

  return { handler: effectApp.handler(), dispose: () => effectApp.dispose() };
}

/**
 * Start Deno.serve on a random port and return the base URL and a stop fn.
 */
function startServer(): { base: string; stop: () => Promise<void> } {
  const { handler, dispose } = makeApp();
  const aborter = new AbortController();

  const server = Deno.serve(
    {
      hostname: "localhost",
      port: 0,
      signal: aborter.signal,
      onListen: () => {},
    },
    handler,
  );

  const base = `http://localhost:${server.addr.port}`;
  const stop = async () => {
    aborter.abort();
    await server.finished;
    await dispose();
  };
  return { base, stop };
}

/**
 * Launch a headless browser.
 * --disable-web-security allows page.evaluate() to fetch to same-origin localhost.
 */
function openBrowser() {
  return launch({
    headless: true,
    args: [
      "--disable-web-security",
      "--allow-insecure-localhost",
      ...((Deno.env.get("CI") && Deno.build.os === "linux")
        ? ["--no-sandbox"]
        : []),
    ],
  });
}

// ---------------------------------------------------------------------------
// Performance helpers
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function measureLatency(
  fn: () => Promise<void>,
  n: number,
): Promise<{ p50: number; p95: number; p99: number; mean: number }> {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  return {
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    mean,
  };
}

// ---------------------------------------------------------------------------
// 1. RENDERING — index page and API routes
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: index page renders with correct title",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const title = await page.evaluate(() => document.title);
      expect(title).toBe("Typed Composition Demo");

      const h1 = await page.evaluate(
        () => document.querySelector("h1")?.textContent ?? "",
      );
      expect(h1).toBe("Typed Composition Demo");
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: index page lists both plugin API links",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll("a")).map((a) =>
          a.getAttribute("href")
        )
      );

      expect(links).toContain("/counter/count");
      expect(links).toContain("/greeting/greet");
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: GET /counter/count returns JSON with numeric count",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      // Navigate to origin first so same-origin fetch works from evaluate
      await page.goto(base, { waitUntil: "load" });

      const result = await page.evaluate(async (url: string) => {
        const res = await fetch(`${url}/counter/count`);
        return { status: res.status, body: await res.json() };
      }, { args: [base] });

      expect(result.status).toBe(200);
      expect(typeof result.body.count).toBe("number");
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: GET /greeting/greet returns greeting with auth state",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const result = await page.evaluate(async (url: string) => {
        const res = await fetch(`${url}/greeting/greet`);
        return { status: res.status, body: await res.json() };
      }, { args: [base] });

      expect(result.status).toBe(200);
      expect(result.body.greeting).toBe("Hello, World!");
      expect(result.body.userId).toBe("test-user");
      expect(typeof result.body.requestId).toBe("string");
      expect(result.body.requestId.startsWith("test-req-")).toBe(true);
    } finally {
      await browser.close();
      await stop();
    }
  },
});

// ---------------------------------------------------------------------------
// 2. STATE — counter increments, resets; auth state flows
// ---------------------------------------------------------------------------

Deno.test({
  name: "browser: counter state increments correctly across sequential POSTs",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const counts = await page.evaluate(async (url: string) => {
        async function post(path: string) {
          const res = await fetch(`${url}${path}`, { method: "POST" });
          return (await res.json()).count as number;
        }
        const a = await post("/counter/increment");
        const b = await post("/counter/increment");
        const c = await post("/counter/increment");
        return [a, b, c];
      }, { args: [base] });

      expect(counts).toEqual([1, 2, 3]);
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: counter resets to 0 after increment",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const result = await page.evaluate(async (url: string) => {
        async function post(path: string) {
          const res = await fetch(`${url}${path}`, { method: "POST" });
          return (await res.json()).count as number;
        }
        async function get(path: string) {
          const res = await fetch(`${url}${path}`);
          return (await res.json()).count as number;
        }
        const afterIncrement = await post("/counter/increment");
        const afterReset = await post("/counter/reset");
        const afterGet = await get("/counter/count");
        return { afterIncrement, afterReset, afterGet };
      }, { args: [base] });

      expect(result.afterIncrement).toBe(1);
      expect(result.afterReset).toBe(0);
      expect(result.afterGet).toBe(0);
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: auth state requestId is set on every request",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const ids = await page.evaluate(async (url: string) => {
        // Sequential fetches to avoid sharing a requestId timestamp
        const results: string[] = [];
        for (let i = 0; i < 3; i++) {
          const res = await fetch(`${url}/greeting/greet`);
          const body = await res.json() as { requestId: string };
          results.push(body.requestId);
        }
        return results;
      }, { args: [base] });

      for (const id of ids) {
        expect(typeof id).toBe("string");
        expect(id.startsWith("test-req-")).toBe(true);
      }
    } finally {
      await browser.close();
      await stop();
    }
  },
});

// ---------------------------------------------------------------------------
// 3. REACTIVITY — page navigation reflects updated server state
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "browser: navigating to counter/count after increments reflects updated count",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      // Increment twice via same-origin fetch from the browser
      await page.evaluate(async (url: string) => {
        await fetch(`${url}/counter/increment`, { method: "POST" });
        await fetch(`${url}/counter/increment`, { method: "POST" });
      }, { args: [base] });

      // Navigate to the count page — should show count=2 in the JSON body
      await page.goto(`${base}/counter/count`, { waitUntil: "load" });
      const bodyText = await page.evaluate(() => document.body.innerText ?? "");
      const parsed = JSON.parse(bodyText);
      expect(parsed.count).toBe(2);
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: greeting reflects current userId after auth state injection",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(`${base}/greeting/greet`, { waitUntil: "load" });

      const bodyText = await page.evaluate(() => document.body.innerText ?? "");
      const parsed = JSON.parse(bodyText);

      // Middleware sets userId = "test-user" on every request
      expect(parsed.userId).toBe("test-user");
      expect(parsed.greeting).toBe("Hello, World!");
    } finally {
      await browser.close();
      await stop();
    }
  },
});

// ---------------------------------------------------------------------------
// 4. COMPOSITION — two plugins, no route conflicts
// ---------------------------------------------------------------------------

Deno.test({
  name:
    "browser: counter and greeting routes respond independently (no conflicts)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const results = await page.evaluate(async (url: string) => {
        const [counter, greeting] = await Promise.all([
          fetch(`${url}/counter/count`).then((r) => r.json()),
          fetch(`${url}/greeting/greet`).then((r) => r.json()),
        ]);
        return { counter, greeting };
      }, { args: [base] });

      expect(typeof results.counter.count).toBe("number");
      expect(results.greeting.greeting).toBe("Hello, World!");
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: plugin routes do not conflict under concurrent load",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      // Fire 10 concurrent requests across both plugins from the browser
      const results = await page.evaluate((url: string) => {
        const reqs = [
          ...Array.from(
            { length: 5 },
            () =>
              fetch(`${url}/counter/count`).then((r) => ({
                plugin: "counter",
                status: r.status,
              })),
          ),
          ...Array.from(
            { length: 5 },
            () =>
              fetch(`${url}/greeting/greet`).then((r) => ({
                plugin: "greeting",
                status: r.status,
              })),
          ),
        ];
        return Promise.all(reqs);
      }, { args: [base] });

      for (const r of results) {
        expect(r.status).toBe(200);
      }
      expect(results.filter((r) => r.plugin === "counter")).toHaveLength(5);
      expect(results.filter((r) => r.plugin === "greeting")).toHaveLength(5);
    } finally {
      await browser.close();
      await stop();
    }
  },
});

Deno.test({
  name: "browser: unknown routes return 404",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const browser = await openBrowser();

    try {
      await using page = await browser.newPage();
      await page.goto(base, { waitUntil: "load" });

      const status = await page.evaluate(async (url: string) => {
        const res = await fetch(`${url}/counter/nonexistent`);
        return res.status;
      }, { args: [base] });

      expect(status).toBe(404);
    } finally {
      await browser.close();
      await stop();
    }
  },
});

// ---------------------------------------------------------------------------
// 5. PERFORMANCE — p50 / p95 / p99 latency benchmarks (direct server fetch)
// ---------------------------------------------------------------------------

Deno.test({
  name: "perf: GET /counter/count — 50 iterations, report p50/p95/p99",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();

    try {
      const stats = await measureLatency(async () => {
        const res = await fetch(`${base}/counter/count`);
        await res.body?.cancel();
      }, 50);

      // deno-lint-ignore no-console
      console.log(
        `GET /counter/count — p50=${stats.p50.toFixed(2)}ms  p95=${
          stats.p95.toFixed(2)
        }ms  p99=${stats.p99.toFixed(2)}ms  mean=${stats.mean.toFixed(2)}ms`,
      );

      // Generous budget: p99 < 200ms in-process
      expect(stats.p99).toBeLessThan(200);
    } finally {
      await stop();
    }
  },
});

Deno.test({
  name: "perf: GET /greeting/greet — 50 iterations, report p50/p95/p99",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();

    try {
      const stats = await measureLatency(async () => {
        const res = await fetch(`${base}/greeting/greet`);
        await res.body?.cancel();
      }, 50);

      // deno-lint-ignore no-console
      console.log(
        `GET /greeting/greet — p50=${stats.p50.toFixed(2)}ms  p95=${
          stats.p95.toFixed(2)
        }ms  p99=${stats.p99.toFixed(2)}ms  mean=${stats.mean.toFixed(2)}ms`,
      );

      expect(stats.p99).toBeLessThan(200);
    } finally {
      await stop();
    }
  },
});

Deno.test({
  name: "perf: POST /counter/increment — 50 iterations, report p50/p95/p99",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();

    try {
      const stats = await measureLatency(async () => {
        const res = await fetch(`${base}/counter/increment`, {
          method: "POST",
        });
        await res.body?.cancel();
      }, 50);

      // deno-lint-ignore no-console
      console.log(
        `POST /counter/increment — p50=${stats.p50.toFixed(2)}ms  p95=${
          stats.p95.toFixed(2)
        }ms  p99=${stats.p99.toFixed(2)}ms  mean=${stats.mean.toFixed(2)}ms`,
      );

      expect(stats.p99).toBeLessThan(200);
    } finally {
      await stop();
    }
  },
});

Deno.test({
  name:
    "perf: concurrent requests — both plugins, 20 parallel, report throughput",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { base, stop } = await startServer();
    const CONCURRENCY = 20;
    const ROUNDS = 5;

    try {
      const roundTimes: number[] = [];

      for (let round = 0; round < ROUNDS; round++) {
        const t0 = performance.now();
        await Promise.all([
          ...Array.from(
            { length: CONCURRENCY / 2 },
            () => fetch(`${base}/counter/count`).then((r) => r.body?.cancel()),
          ),
          ...Array.from(
            { length: CONCURRENCY / 2 },
            () => fetch(`${base}/greeting/greet`).then((r) => r.body?.cancel()),
          ),
        ]);
        roundTimes.push(performance.now() - t0);
      }

      const avgMs = roundTimes.reduce((s, t) => s + t, 0) / roundTimes.length;
      const rps = (CONCURRENCY / (avgMs / 1000)).toFixed(0);

      // deno-lint-ignore no-console
      console.log(
        `Concurrent ${CONCURRENCY} requests — avg batch=${
          avgMs.toFixed(2)
        }ms  ~${rps} req/s`,
      );

      // At least 100 req/s in-process
      expect(Number(rps)).toBeGreaterThan(100);
    } finally {
      await stop();
    }
  },
});
