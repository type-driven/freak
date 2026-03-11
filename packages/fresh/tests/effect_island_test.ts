/**
 * Export and type verification tests for island-atoms.ts hooks in @fresh/core/effect.
 *
 * Tests:
 * 1. Export verification — runtime checks that hooks are exported as functions
 * 2. Type-level tests — useAtomValue signature via expectTypeOf
 * 3. No preact/compat verification — confirms island.ts does not depend on preact/compat
 *
 * Note: Parameter type tests for useAtomSet and useAtom are omitted.
 * The Effect v4 beta Writable type includes a NodeInspectSymbol member that
 * causes expect-type's generic constraint to reject Writable<R,W> as a type
 * argument to toMatchTypeOf<>. Return-type assertions are unaffected.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { expectTypeOf } from "expect-type";
import { useAtom, useAtomSet, useAtomValue } from "../src/effect/island-atoms.ts";
import type { Atom } from "effect/unstable/reactivity/Atom";

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

// --- Category 2: Type-level tests ---

Deno.test("useAtomValue accepts Atom<A> and returns A", () => {
  expectTypeOf(useAtomValue<number>).parameter(0).toMatchTypeOf<Atom<number>>();
  expectTypeOf(useAtomValue<number>).returns.toEqualTypeOf<number>();
});

Deno.test("useAtomSet returns a setter function (value: W) => void", () => {
  expectTypeOf(useAtomSet<string, string>).returns.toEqualTypeOf<
    (value: string) => void
  >();
});

Deno.test("useAtom returns readonly [R, (value: W) => void]", () => {
  expectTypeOf(useAtom<number, number>).returns.toEqualTypeOf<
    readonly [number, (value: number) => void]
  >();
});

// --- Category 3: No preact/compat dependency ---

Deno.test("island.ts has no preact/compat dependency", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["info", "--json", "packages/fresh/src/effect/island.ts"],
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
