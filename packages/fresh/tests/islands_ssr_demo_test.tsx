/**
 * End-to-end SSR demo: App.islands() → island markers in HTML output.
 *
 * Proves that components registered via app.islands() receive Fresh's
 * island hydration markers (<!--frsh:island:...--> comments) when
 * rendered through ctx.render(). No browser required — checks raw HTML.
 *
 * This is the critical link in the chain:
 *   app.islands({ MyComponent }, "chunk")
 *     ↓ setBuildCache
 *   cache.islandRegistry.set(MyComponent, { file, name, ... })
 *     ↓ ctx.render(<MyComponent />)
 *   setRenderState(state)  ← enables island hooks
 *     ↓ preact_hooks intercepts MyComponent
 *   "<!--frsh:island:MyComponent:...-->" in HTML
 */

/** @jsxImportSource preact */
import { expect } from "@std/expect";
import { App } from "@freak/core";
import { setBuildCache } from "../src/internals.ts";
import { MockBuildCache } from "../src/test_utils.ts";
import type { ComponentType } from "preact";

// ---------------------------------------------------------------------------
// Fixture island components (simple, no required props for clean types)
// ---------------------------------------------------------------------------

function DemoCounter({ count }: { count: number }) {
  return <p class="output">{count}</p>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp() {
  const app = new App();
  const cache = new MockBuildCache([], "production");
  setBuildCache(app, cache, "production");
  return { app, cache };
}

async function renderPage(
  app: App<unknown>,
  path: string,
): Promise<string> {
  const handler = app.handler();
  const res = await handler(new Request(`http://localhost${path}`));
  return await res.text();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("SSR: island NOT in registry → no island markers in HTML", async () => {
  const { app } = makeApp();
  // DemoCounter is not registered — renders as plain HTML, no markers
  app.get("/", (ctx) =>
    ctx.render(
      <html>
        <body>
          <DemoCounter count={5} />
        </body>
      </html>,
    ));

  const html = await renderPage(app, "/");
  expect(html).toContain("5"); // SSR content present
  expect(html).not.toContain("frsh:island"); // no hydration markers
});

Deno.test("SSR: app.islands() → island markers appear in ctx.render() output", async () => {
  const app = new App();

  // Register via app.islands() BEFORE setBuildCache
  app.islands({ DemoCounter }, "demo-counter-chunk");

  const cache = new MockBuildCache([], "production");
  setBuildCache(app, cache, "production"); // triggers deferred registration

  // Verify registry was populated
  expect(cache.islandRegistry.has(DemoCounter as ComponentType)).toBe(true);

  app.get("/", (ctx) =>
    ctx.render(
      <html>
        <body>
          <DemoCounter count={42} />
        </body>
      </html>,
    ));

  const html = await renderPage(app, "/");

  // Content SSR'd
  expect(html).toContain("42");
  // Island hydration markers injected by Fresh's preact_hooks
  expect(html).toContain("frsh:island");
  expect(html).toContain("DemoCounter");
});

Deno.test("SSR: mountApp propagates island registrations — inner app islands hydrate", async () => {
  const outer = new App();
  const inner = new App();

  // Inner "plugin" app registers its islands
  inner.islands({ DemoCounter }, "plugin-counter-chunk");

  // Inner routes use ctx.render() — needs access to outer's build cache
  inner.get("/widget", (ctx) =>
    ctx.render(
      <html>
        <body>
          <DemoCounter count={99} />
        </body>
      </html>,
    ));

  // Mount inner onto outer — propagates island registrations
  outer.mountApp("/plugin", inner);

  // Wire up build cache on outer — applies merged island registrations
  const cache = new MockBuildCache([], "production");
  setBuildCache(outer, cache, "production");

  // Verify the inner app's island made it into the outer registry
  expect(cache.islandRegistry.has(DemoCounter as ComponentType)).toBe(true);

  const html = await renderPage(outer, "/plugin/widget");

  expect(html).toContain("99");
  expect(html).toContain("frsh:island");
  expect(html).toContain("DemoCounter");
});

Deno.test("SSR: FreshScripts component is exported from @freak/core", async () => {
  // Proves the public export works — consuming apps can import FreshScripts
  // to get island hydration <script> tags injected automatically
  const { FreshScripts } = await import("@freak/core");
  expect(typeof FreshScripts).toBe("function");
});
