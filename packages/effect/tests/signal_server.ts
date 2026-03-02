/**
 * Minimal EffectApp server fixture for signal_test.ts.
 *
 * Prints "READY:<port>" to stdout once listening, then serves until the
 * signal handler (registered by registerSignalDisposal inside createEffectApp)
 * receives SIGTERM or SIGINT and calls Deno.exit(0).
 *
 * This file is spawned as a subprocess by signal_test.ts.
 * It must NOT import from the test harness (FakeServer, etc.).
 */

import { createEffectApp } from "../src/mod.ts";
import { Layer } from "effect";

const app = createEffectApp({ layer: Layer.empty });
app.get("/health", () => new Response("ok"));

const handler = app.handler();

const server = Deno.serve(
  {
    port: 0,
    onListen: (addr) => {
      // Signal readiness to the parent test process.
      // Use console.log to write to stdout.
      // deno-lint-ignore no-console
      console.log(`READY:${addr.port}`);
    },
  },
  handler,
);

// Keep the process alive until the signal handler fires.
// registerSignalDisposal will call runtime.dispose() then Deno.exit(0).
await server.finished;
