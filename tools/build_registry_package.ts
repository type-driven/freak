import { parseArgs } from "@std/cli/parse-args";
import { copy, ensureDir, walk } from "@std/fs";
import * as path from "@std/path";

interface DenoPackageJson {
  version?: string;
  exports?: Record<string, string>;
  imports?: Record<string, string>;
}

const args = parseArgs(Deno.args, {
  boolean: ["help"],
  string: ["out-dir", "package-name", "version"],
  alias: { h: "help" },
});

if (args.help) {
  // deno-lint-ignore no-console
  console.log(`
Build the Freak npm package artifact used for Gitea package publishing.

Usage:
  deno run -A tools/build_registry_package.ts [--out-dir path] [--package-name @scope/name] [--version x.y.z]

Environment variables:
  FREAK_NPM_OUT_DIR
  FREAK_NPM_PACKAGE
  FREAK_NPM_VERSION
  FREAK_REPOSITORY_URL
`);
  Deno.exit(0);
}

const rootDir = path.resolve(path.fromFileUrl(new URL("..", import.meta.url)));
const sourcePackageDir = path.join(rootDir, "packages", "fresh");
const sourceDenoJsonPath = path.join(sourcePackageDir, "deno.json");

const sourceDenoJson = JSON.parse(
  await Deno.readTextFile(sourceDenoJsonPath),
) as DenoPackageJson;
const rootDenoJson = JSON.parse(
  await Deno.readTextFile(path.join(rootDir, "deno.json")),
) as DenoPackageJson;

if (
  sourceDenoJson.exports === undefined || sourceDenoJson.version === undefined
) {
  throw new Error(
    `Expected "exports" and "version" in ${sourceDenoJsonPath}.`,
  );
}

const outDir = path.resolve(
  String(
    args["out-dir"] ??
      Deno.env.get("FREAK_NPM_OUT_DIR") ??
      path.join(rootDir, "dist", "npm", "freak"),
  ),
);
const packageName = String(
  args["package-name"] ?? Deno.env.get("FREAK_NPM_PACKAGE") ??
    "@type-driven/freak",
);
const version = String(
  args.version ?? Deno.env.get("FREAK_NPM_VERSION") ?? sourceDenoJson.version,
);
const repositoryUrl = Deno.env.get("FREAK_REPOSITORY_URL") ??
  "ssh://git@gitea.platform.typedriven.dev:2222/type-driven/freak.git";

const sourceDir = path.join(sourcePackageDir, "src");
const outSourceDir = path.join(outDir, "src");
const mappings = buildMappings(
  {
    ...(rootDenoJson.imports ?? {}),
    ...(sourceDenoJson.imports ?? {}),
  },
  packageName,
  version,
);

await Deno.remove(outDir, { recursive: true }).catch(() => {});
await ensureDir(outDir);
await copy(sourceDir, outSourceDir, {
  overwrite: true,
  preserveTimestamps: true,
});

for await (
  const entry of walk(outSourceDir, {
    includeDirs: false,
    followSymlinks: false,
  })
) {
  if (isTestFile(entry.path)) {
    await Deno.remove(entry.path);
  }
}

let replacedSpecifiers = 0;
for await (
  const entry of walk(outSourceDir, {
    includeDirs: false,
    followSymlinks: false,
  })
) {
  if (!/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) continue;

  const original = await Deno.readTextFile(entry.path);
  const rewritten = rewriteModuleSpecifiers(original, mappings);
  if (rewritten.value !== original) {
    await Deno.writeTextFile(entry.path, rewritten.value);
    replacedSpecifiers += rewritten.count;
  }
}

const exportsMap = Object.fromEntries(
  Object.entries(sourceDenoJson.exports).map(([specifier, target]) => [
    specifier,
    {
      types: target,
      default: target,
    },
  ]),
);
const mainEntry = sourceDenoJson.exports["."] ?? "./src/mod.ts";

const npmPackageJson = {
  name: packageName,
  version,
  description:
    "Freak framework core (Fresh fork with integrated typed Effect runtime primitives).",
  license: "MIT",
  type: "module",
  repository: {
    type: "git",
    url: repositoryUrl,
  },
  sideEffects: false,
  files: ["src", "README.md", "LICENSE", "deno.json"],
  exports: exportsMap,
  types: mainEntry,
  engines: {
    deno: ">=2.0.0",
  },
};

await Deno.writeTextFile(
  path.join(outDir, "package.json"),
  `${JSON.stringify(npmPackageJson, null, 2)}\n`,
);

await Deno.copyFile(
  path.join(rootDir, "LICENSE"),
  path.join(outDir, "LICENSE"),
);
await Deno.copyFile(sourceDenoJsonPath, path.join(outDir, "deno.json"));

await Deno.writeTextFile(
  path.join(outDir, "README.md"),
  createPackageReadme(packageName, version),
);

// deno-lint-ignore no-console
console.log(`Built registry package: ${outDir}`);
// deno-lint-ignore no-console
console.log(`Package name: ${packageName}`);
// deno-lint-ignore no-console
console.log(`Version: ${version}`);
// deno-lint-ignore no-console
console.log(`Rewritten module specifiers: ${replacedSpecifiers}`);

function buildMappings(
  imports: Record<string, string>,
  pkgName: string,
  pkgVersion: string,
): Array<[string, string]> {
  const withPackageAliases: Record<string, string> = {
    ...imports,
    "fresh": `npm:${pkgName}@${pkgVersion}`,
    "@fresh/core": `npm:${pkgName}@${pkgVersion}`,
  };

  return Object.entries(withPackageAliases).sort((a, b) =>
    b[0].length - a[0].length
  );
}

function isTestFile(filePath: string): boolean {
  return /(?:^|\/)[^/]*_test\.(?:[cm]?[jt]sx?)$/.test(
    filePath.replaceAll("\\", "/"),
  );
}

function rewriteModuleSpecifiers(
  sourceText: string,
  mappings: Array<[string, string]>,
): { value: string; count: number } {
  let count = 0;

  const rewrite = (
    input: string,
    pattern: RegExp,
  ): string =>
    input.replace(
      pattern,
      (full, prefix: string, specifier: string, suffix: string) => {
        const resolved = resolveSpecifier(specifier, mappings);
        if (resolved === specifier) return full;
        count++;
        return `${prefix}${resolved}${suffix}`;
      },
    );

  let value = rewrite(sourceText, /(from\s*["'])([^"']+)(["'])/g);
  value = rewrite(value, /(import\s*\(\s*["'])([^"']+)(["'])/g);
  value = rewrite(value, /(import\s*\(\s*type\s*["'])([^"']+)(["'])/g);

  return { value, count };
}

function resolveSpecifier(
  specifier: string,
  mappings: Array<[string, string]>,
): string {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.includes(":")
  ) {
    return specifier;
  }

  for (const [key, target] of mappings) {
    if (specifier === key) return target;
    if (specifier.startsWith(`${key}/`)) {
      return `${target}${specifier.slice(key.length)}`;
    }
  }

  return specifier;
}

function createPackageReadme(packageName: string, version: string): string {
  return `# ${packageName}

Internal npm distribution of the \`freak\` framework core.

This package is intended for Deno consumers via a private npm registry.

## Deno setup

Add the package in your app import map:

\`\`\`json
{
  "imports": {
    "fresh": "npm:${packageName}@${version}",
    "fresh/": "npm:${packageName}@${version}/"
  }
}
\`\`\`

Then import as usual:

\`\`\`ts
import { createEffectApp } from "fresh/effect";
\`\`\`
`;
}
