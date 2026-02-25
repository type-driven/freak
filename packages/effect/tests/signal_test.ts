/**
 * SC-3: SIGTERM causes clean shutdown with exit code 0.
 *
 * Spawns signal_server.ts as a subprocess, waits for "READY" on stdout,
 * sends SIGTERM, and asserts the process exits with code 0.
 *
 * The registerSignalDisposal function inside createEffectApp registers
 * SIGTERM/SIGINT handlers that call runtime.dispose() then Deno.exit(0).
 *
 * Run: deno test --allow-env --allow-net --allow-run packages/effect/tests/signal_test.ts
 */

import { assertEquals } from "jsr:@std/assert@1";

Deno.test("SC-3: SIGTERM causes clean shutdown with exit code 0", async () => {
  const cp = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-net",
      "--allow-env",
      new URL("./signal_server.ts", import.meta.url).pathname,
    ],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  // Read stdout until we see "READY"
  const reader = cp.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
    if (output.includes("READY")) break;
  }
  reader.releaseLock();

  // Send SIGTERM — the signal handler calls runtime.dispose() then Deno.exit(0)
  cp.kill("SIGTERM");

  // Wait for process to exit
  const status = await cp.status;

  // Cancel remaining streams to avoid resource leak errors from Deno's test runner
  await cp.stdout.cancel();
  await cp.stderr.cancel();

  assertEquals(status.code, 0, `Expected exit code 0, got ${status.code}`);
});
