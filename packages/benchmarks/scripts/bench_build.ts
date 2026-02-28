/**
 * bench_build.ts — Build time benchmark via hyperfine.
 *
 * Runs hyperfine with --warmup 1 --runs 5 per app with cold build (rm -rf _fresh).
 */

export interface BuildResult {
  name: string;
  meanSecs: number;
  stddevSecs: number;
  runs: number;
}

const APPS = [
  { name: "upstream", dir: "apps/upstream-app" },
  { name: "freak-plain", dir: "apps/freak-plain-app" },
  { name: "freak-effect", dir: "apps/freak-app" },
] as const;

export async function runBuildTimeBench(
  benchRoot: string,
): Promise<BuildResult[]> {
  const results: BuildResult[] = [];

  for (const app of APPS) {
    const appDir = `${benchRoot}/${app.dir}`;
    const tmpFile = `/tmp/bench_build_${app.name}.json`;
    console.log(`\n[build] Benchmarking build time for ${app.name}...`);

    const cmd = new Deno.Command("hyperfine", {
      args: [
        "--warmup", "1",
        "--runs", "5",
        "--prepare", `rm -rf ${appDir}/_fresh`,
        `deno run -A ${appDir}/dev.ts build`,
        "--export-json", tmpFile,
      ],
      cwd: benchRoot,
      stdout: "inherit",
      stderr: "inherit",
    });

    const result = await cmd.output();
    if (!result.success) {
      throw new Error(`hyperfine failed for ${app.name}`);
    }

    // Parse hyperfine JSON output
    const raw = await Deno.readTextFile(tmpFile);
    // deno-lint-ignore no-explicit-any
    const parsed = JSON.parse(raw) as any;
    const r = parsed.results[0];

    results.push({
      name: app.name,
      meanSecs: r.mean,
      stddevSecs: r.stddev,
      runs: r.times?.length ?? 5,
    });

    console.log(
      `[build] ${app.name}: mean=${r.mean.toFixed(2)}s stddev=${r.stddev.toFixed(2)}s`,
    );
  }

  return results;
}
