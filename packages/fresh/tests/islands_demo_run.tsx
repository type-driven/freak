// deno-lint-ignore-file no-console
/** @jsxImportSource preact */
/**
 * Quick demo: run this to see island markers in SSR output.
 *   deno run --allow-env packages/fresh/tests/islands_demo_run.tsx
 */
import { App } from "@freak/core";
import { setBuildCache } from "../src/internals.ts";
import { MockBuildCache } from "../src/test_utils.ts";

// Simulate a component from an external plugin package
function DemoCounter({ count }: { count: number }) {
  return <p class="output">{count}</p>;
}

// ---- Outer app (consuming app) ----
const outer = new App();

// ---- Inner "plugin" sub-app ----
const inner = new App();
// Plugin declares its own islands programmatically
inner.islands({ DemoCounter }, "plugin-counter");

inner.get("/widget", (ctx) =>
  ctx.render(
    <html>
      <head>
        <title>Demo</title>
      </head>
      <body>
        <h1>Plugin Widget</h1>
        <DemoCounter count={42} />
      </body>
    </html>,
  ));

// Mount inner plugin onto outer app
outer.mountApp("/plugin", inner);

// Wire up build cache — propagated island registrations are applied here
const cache = new MockBuildCache([], "production");
setBuildCache(outer, cache, "production");

// Serve a request and print the HTML
const handler = outer.handler();
const res = await handler(new Request("http://localhost/plugin/widget"));
const html = await res.text();

console.log("=== Island registry after setBuildCache ===");
for (const [fn, entry] of cache.islandRegistry) {
  console.log(
    `  ${fn.name} → { file: "${entry.file}", name: "${entry.name}", exportName: "${entry.exportName}" }`,
  );
}

console.log("\n=== SSR HTML (full) ===");
console.log(html);

console.log("\n=== Island markers found ===");
const markers = html.match(/<!--frsh:[^>]+-->/g) ?? [];
if (markers.length === 0) {
  console.log("  NONE (island not in registry)");
} else {
  for (const m of markers) console.log(" ", m);
}
