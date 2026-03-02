// deno-lint-ignore-file no-console
/**
 * bench_ssr.ts — SSR page throughput benchmark via oha.
 *
 * For each app: build, start server, warmup, measure with oha JSON output, kill server.
 * Targets GET / (full HTML page with island rendering; freak-app includes atom serialization).
 */

export interface SsrResult {
  name: string;
  requestsPerSec: number;
  latencyP50: number; // ms
  latencyP90: number; // ms
  latencyP99: number; // ms
}

const APPS = [
  { name: "upstream", dir: "apps/upstream-app", port: 8003 },
  { name: "freak-plain", dir: "apps/freak-plain-app", port: 8002 },
  { name: "freak-effect", dir: "apps/freak-app", port: 8001 },
] as const;

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
  maxAttempts = 50,
  intervalMs = 100,
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

export async function runSsrBench(
  benchRoot: string,
): Promise<SsrResult[]> {
  const results: SsrResult[] = [];

  for (const app of APPS) {
    const appDir = `${benchRoot}/${app.dir}`;
    console.log(`\n[ssr] Building ${app.name}...`);

    // Build app
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

    // Kill any existing process on port
    await killPort(app.port);

    console.log(`[ssr] Starting server for ${app.name} on :${app.port}...`);

    // Start server
    const server = new Deno.Command("deno", {
      args: [
        "serve",
        "-A",
        `--port=${app.port}`,
        "_fresh/server.js",
      ],
      cwd: appDir,
      stdout: "null",
      stderr: "null",
    }).spawn();

    try {
      // Poll until ready (use 127.0.0.1 to avoid IPv6 issues)
      const ready = await waitForServer(`http://127.0.0.1:${app.port}/`);
      if (!ready) {
        throw new Error(`Server for ${app.name} did not start in time`);
      }

      console.log(`[ssr] Warming up ${app.name}...`);

      // Warmup
      const warmupCmd = new Deno.Command("oha", {
        args: [
          "-n",
          "2000",
          "-c",
          "10",
          "--no-tui",
          "--ipv4",
          `http://127.0.0.1:${app.port}/`,
        ],
        stdout: "null",
        stderr: "null",
      });
      await warmupCmd.output();

      console.log(`[ssr] Measuring ${app.name}...`);

      // Measurement
      const measureCmd = new Deno.Command("oha", {
        args: [
          "-n",
          "10000",
          "-c",
          "50",
          "--no-tui",
          "--ipv4",
          "--output-format",
          "json",
          `http://127.0.0.1:${app.port}/`,
        ],
        stdout: "piped",
        stderr: "null",
      });
      const measureResult = await measureCmd.output();
      if (!measureResult.success) {
        throw new Error(
          `[ssr] oha exited with code ${measureResult.code} for ${app.name}`,
        );
      }
      const raw = new TextDecoder().decode(measureResult.stdout);
      // deno-lint-ignore no-explicit-any
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          `[ssr] oha produced non-JSON output for ${app.name}: ${
            raw.slice(0, 200)
          }`,
        );
      }

      const requestsPerSec = parsed.summary?.requestsPerSec ?? 0;
      // oha latencyPercentiles are in seconds — convert to milliseconds
      const latencyP50 = (parsed.latencyPercentiles?.p50 ?? 0) * 1000;
      const latencyP90 = (parsed.latencyPercentiles?.p90 ?? 0) * 1000;
      const latencyP99 = (parsed.latencyPercentiles?.p99 ?? 0) * 1000;

      results.push({
        name: app.name,
        requestsPerSec,
        latencyP50,
        latencyP90,
        latencyP99,
      });

      console.log(
        `[ssr] ${app.name}: ${requestsPerSec.toFixed(0)} req/s, p50=${
          latencyP50.toFixed(2)
        }ms`,
      );
    } finally {
      server.kill("SIGTERM");
      await server.status;
    }
  }

  return results;
}
