// deno-lint-ignore-file no-console
/**
 * bench_startup.ts — Startup time measurement.
 *
 * For each app: builds once, then 5 iterations of spawn -> poll until 200 -> measure elapsed.
 */

export interface StartupResult {
  name: string;
  meanMs: number;
  runs: number;
}

const APPS = [
  { name: "upstream", dir: "apps/upstream-app", port: 8003 },
  { name: "freak-plain", dir: "apps/freak-plain-app", port: 8002 },
  { name: "freak-effect", dir: "apps/freak-app", port: 8001 },
] as const;

const RUNS = 5;

async function killPort(port: number): Promise<void> {
  const cmd = new Deno.Command("sh", {
    args: ["-c", `lsof -ti:${port} | xargs kill -9 2>/dev/null; true`],
    stdout: "null",
    stderr: "null",
  });
  await cmd.output();
}

async function waitForServer(
  url: string,
  maxAttempts = 100,
  intervalMs = 50,
): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      await res.body?.cancel();
      if (res.status < 500) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export async function runStartupBench(
  benchRoot: string,
): Promise<StartupResult[]> {
  const results: StartupResult[] = [];

  for (const app of APPS) {
    const appDir = `${benchRoot}/${app.dir}`;
    console.log(`\n[startup] Building ${app.name} once...`);

    // Build once before loop
    const buildCmd = new Deno.Command("deno", {
      args: ["run", "-A", `${appDir}/dev.ts`, "build"],
      cwd: benchRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    const buildResult = await buildCmd.output();
    if (!buildResult.success) {
      throw new Error(`Build failed for ${app.name}`);
    }

    const times: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      console.log(`[startup] ${app.name} run ${i + 1}/${RUNS}...`);

      // Kill any existing process on port
      await killPort(app.port);

      const start = performance.now();

      const cp = new Deno.Command("deno", {
        args: [
          "serve",
          "-A",
          `--port=${app.port}`,
          "_fresh/server.js",
        ],
        cwd: appDir,
        stdout: "piped",
        stderr: "piped",
      }).spawn();

      try {
        const ready = await waitForServer(`http://127.0.0.1:${app.port}/`);
        const end = performance.now();

        if (!ready) {
          console.warn(`[startup] ${app.name} run ${i + 1} timed out`);
        } else {
          times.push(end - start);
        }
      } finally {
        cp.kill("SIGTERM");
        await cp.status;
        // Cancel streams to avoid resource leak
        await cp.stdout.cancel();
        await cp.stderr.cancel();
      }
    }

    const meanMs = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    results.push({ name: app.name, meanMs, runs: times.length });
    console.log(
      `[startup] ${app.name}: mean=${meanMs}ms over ${times.length} runs`,
    );
  }

  return results;
}
