/**
 * Export and type verification tests for island.ts atom hooks.
 *
 * Tests:
 * 1. Export verification — runtime checks that hooks are exported as functions
 * 2. Type-level tests — expectTypeOf assertions for hook signatures
 * 3. No preact/compat verification — confirms island.ts does not depend on preact/compat
 */

import { assertEquals } from "jsr:@std/assert@1";
import { expectTypeOf } from "expect-type";
import { useAtom, useAtomSet, useAtomValue } from "../src/island.ts";
import type { Atom, Writable } from "effect/unstable/reactivity/Atom";

// --- Category 1: Export verification (runtime) ---

Deno.test("useAtomValue is exported as a function", () => {
  assertEquals(typeof useAtomValue, "function");
});

Deno.test("useAtomSet is exported as a function", () => {
  assertEquals(typeof useAtomSet, "function");
});

Deno.test("useAtom is exported as a function", () => {
  assertEquals(typeof useAtom, "function");
});

// --- Category 2: Type-level tests (expect-type) ---

Deno.test("useAtomValue accepts Atom<A> and returns A", () => {
  expectTypeOf(useAtomValue<number>).parameter(0).toMatchTypeOf<Atom<number>>();
  expectTypeOf(useAtomValue<number>).returns.toEqualTypeOf<number>();
});

Deno.test("useAtomSet accepts Writable<R, W> and returns setter", () => {
  expectTypeOf(useAtomSet<string, string>).parameter(0).toMatchTypeOf<
    Writable<string, string>
  >();
  expectTypeOf(useAtomSet<string, string>).returns.toEqualTypeOf<
    (value: string) => void
  >();
});

Deno.test("useAtom accepts Writable<R, W> and returns [R, setter]", () => {
  expectTypeOf(useAtom<number, number>).parameter(0).toMatchTypeOf<
    Writable<number, number>
  >();
  expectTypeOf(useAtom<number, number>).returns.toEqualTypeOf<
    readonly [number, (value: number) => void]
  >();
});

// --- Category 3: No preact/compat verification ---

Deno.test("island.ts has no preact/compat dependency", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["info", "--json", "packages/plugin-effect/src/island.ts"],
    stdout: "piped",
  });
  const output = await cmd.output();
  const text = new TextDecoder().decode(output.stdout);
  assertEquals(
    text.includes("preact/compat"),
    false,
    "island.ts must not depend on preact/compat",
  );
});
