// deno-lint-ignore-file no-console
/**
 * bench_bundle.ts — Bundle size calculator.
 *
 * Builds each app then sums all .js files in _fresh/static/ for raw + gzip size.
 */

export interface BundleResult {
  name: string;
  totalRawKB: number;
  totalGzipKB: number;
  fileCount: number;
}

const APPS = [
  { name: "upstream", dir: "apps/upstream-app" },
  { name: "freak-plain", dir: "apps/freak-plain-app" },
  { name: "freak-effect", dir: "apps/freak-app" },
] as const;

async function gzipSize(data: Uint8Array): Promise<number> {
  // Use Response + CompressionStream to avoid TypeScript generic variance issues
  // Deno.readFile returns Uint8Array<ArrayBufferLike>, but CompressionStream.writable
  // expects ArrayBuffer-backed data. We create a new ArrayBuffer-backed copy.
  const buf = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const bufView = new Uint8Array(buf);
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  // deno-lint-ignore no-explicit-any
  writer.write(bufView as any);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
  } finally {
    reader.releaseLock();
  }

  return chunks.reduce((sum, c) => sum + c.byteLength, 0);
}

async function walkJsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        const sub = await walkJsFiles(path);
        files.push(...sub);
      } else if (entry.isFile && entry.name.endsWith(".js")) {
        files.push(path);
      }
    }
  } catch {
    // Directory may not exist if no JS files built there
  }
  return files;
}

export async function runBundleSizeBench(
  benchRoot: string,
): Promise<BundleResult[]> {
  const results: BundleResult[] = [];

  for (const app of APPS) {
    const appDir = `${benchRoot}/${app.dir}`;
    console.log(`\n[bundle] Building ${app.name}...`);

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

    const staticDir = `${appDir}/_fresh/static`;
    const files = await walkJsFiles(staticDir);

    let totalRaw = 0;
    let totalGzip = 0;

    for (const file of files) {
      const data = await Deno.readFile(file);
      totalRaw += data.byteLength;
      totalGzip += await gzipSize(data);
    }

    const totalRawKB = Math.round((totalRaw / 1024) * 10) / 10;
    const totalGzipKB = Math.round((totalGzip / 1024) * 10) / 10;

    results.push({
      name: app.name,
      totalRawKB,
      totalGzipKB,
      fileCount: files.length,
    });

    console.log(
      `[bundle] ${app.name}: ${files.length} files, raw=${totalRawKB}KB gzip=${totalGzipKB}KB`,
    );
  }

  return results;
}
