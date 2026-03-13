/**
 * Verifies that the @freak/core root entry point does NOT import Effect.
 *
 * This guards against accidental re-introduction of Effect exports into the
 * root package, which would force all consumers (including plain-Fresh users)
 * to pull Effect into their module graph.
 *
 * Run: deno test -A packages/fresh/tests/effect_boundary_test.ts
 */

Deno.test("@freak/core root entry has no Effect in module graph", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["info", "--json", new URL("../../src/mod.ts", import.meta.url).pathname],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await cmd.output();
  const output = new TextDecoder().decode(result.stdout);
  const info = JSON.parse(output);

  // Walk the module graph and collect all specifiers
  const specifiers: string[] = [];
  function walk(node: { specifier?: string; dependencies?: unknown[] }) {
    if (node.specifier) specifiers.push(node.specifier);
    if (Array.isArray(node.dependencies)) {
      for (const dep of node.dependencies) walk(dep as typeof node);
    }
  }
  if (info.modules) {
    for (const mod of info.modules) walk(mod);
  }
  if (info.roots) {
    walk({ dependencies: info.roots });
  }

  const effectSpecifiers = specifiers.filter(
    (s) => s.includes("npm:effect") || s.includes("/effect/")
  );

  if (effectSpecifiers.length > 0) {
    throw new Error(
      `@freak/core root entry pulled in Effect module(s):\n` +
      effectSpecifiers.map((s) => `  - ${s}`).join("\n") +
      `\n\nEffect exports must live ONLY in the @freak/core/effect entry point.`
    );
  }
});
