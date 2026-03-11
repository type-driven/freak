/**
 * SC-3: SIGTERM causes clean shutdown with exit code 0.
 *
 * Spawns signal_server.ts as a subprocess, waits for "READY" on stdout,
 * sends SIGTERM, and asserts the process exits with code 0.
 *
 * The registerSignalDisposal function inside createEffectApp registers
 * SIGTERM/SIGINT handlers that call runtime.dispose() then Deno.exit(0).
 *
 * Run: deno test --allow-env --allow-net --allow-run packages/fresh/tests/effect_signal_test.ts
 */

import { assertEquals } from "jsr:@std/assert@1";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (error) => {
        clearTimeout(id);
        reject(error);
      },
    );
  });
}

Deno.test("SC-3: SIGTERM causes clean shutdown with exit code 0", async () => {
  const cp = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--config",
      new URL("../deno.json", import.meta.url).pathname,
      "--allow-net",
      "--allow-env",
      new URL("./signal_server_fixture.ts", import.meta.url).pathname,
    ],
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const stderrDecoder = new TextDecoder();
  const stderrChunks: string[] = [];
  const stderrDrain = (async () => {
    const reader = cp.stderr.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        stderrChunks.push(stderrDecoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }
  })();

  await withTimeout(
    (async () => {
      // Read stdout until we see "READY"
      const reader = cp.stdout.getReader();
      const decoder = new TextDecoder();
      let output = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          output += decoder.decode(value);
          if (output.includes("READY")) break;
        }
      } finally {
        reader.releaseLock();
      }
    })(),
    30000,
    "Waiting for signal server readiness",
  );

  // Send SIGTERM — the signal handler calls runtime.dispose() then Deno.exit(0)
  cp.kill("SIGTERM");

  // Wait for process to exit
  const status = await withTimeout(cp.status, 15000, "Waiting for process exit");

  // Best-effort cleanup of child pipes.
  cp.stdout.cancel().catch(() => {});
  cp.stderr.cancel().catch(() => {});
  stderrDrain.catch(() => {});

  assertEquals(
    status.code,
    0,
    `Expected exit code 0, got ${status.code}\n${stderrChunks.join("")}`,
  );
});
