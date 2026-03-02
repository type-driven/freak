// deno-lint-ignore-file no-console
/**
 * check_tools.ts — Verify required CLI tools are installed before running benchmarks.
 */

const REQUIRED_TOOLS: Array<{ name: string; install: string }> = [
  { name: "oha", install: "brew install oha" },
  { name: "hyperfine", install: "brew install hyperfine" },
];

export async function checkTools(): Promise<void> {
  const missing: Array<{ name: string; install: string }> = [];

  for (const tool of REQUIRED_TOOLS) {
    const cmd = new Deno.Command("which", {
      args: [tool.name],
      stdout: "null",
      stderr: "null",
    });
    const { code } = await cmd.output();
    if (code !== 0) {
      missing.push(tool);
    }
  }

  if (missing.length > 0) {
    console.error("Missing required tools:");
    for (const tool of missing) {
      console.error(`  - ${tool.name}: ${tool.install}`);
    }
    throw new Error(
      `Missing required tools: ${
        missing.map((t) => t.name).join(", ")
      }. Install them and try again.`,
    );
  }
}
