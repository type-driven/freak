import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";
import {
  ATOM_HYDRATION_KEY,
  initAtomHydrationMap,
  serializeAtomHydration,
  setAtom,
} from "../src/hydration.ts";

Deno.test("setAtom stores encoded value in per-request map", () => {
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "count",
    schema: Schema.Number,
  });

  const ctx = { state: {} };
  initAtomHydrationMap(ctx);
  setAtom(ctx, countAtom, 42);

  const map = (ctx.state as Record<string | symbol, unknown>)[
    ATOM_HYDRATION_KEY
  ] as Map<string, unknown>;
  assertEquals(map.has("count"), true);
  assertEquals(map.get("count"), 42);
});

Deno.test("serializeAtomHydration returns JSON string", () => {
  const nameAtom = Atom.serializable(Atom.make(""), {
    key: "name",
    schema: Schema.String,
  });

  const ctx = { state: {} };
  initAtomHydrationMap(ctx);
  setAtom(ctx, nameAtom, "Alice");

  const result = serializeAtomHydration(ctx);
  assertEquals(result, JSON.stringify({ name: "Alice" }));
});

Deno.test("serializeAtomHydration returns null when no atoms set", () => {
  const ctx = { state: {} };
  initAtomHydrationMap(ctx);

  const result = serializeAtomHydration(ctx);
  assertEquals(result, null);
});

Deno.test("setAtom throws on non-serializable atom", () => {
  const plainAtom = Atom.make(0);

  const ctx = { state: {} };
  initAtomHydrationMap(ctx);

  assertThrows(
    () => setAtom(ctx, plainAtom, 5),
    Error,
    "serializable",
  );
});

Deno.test("setAtom throws on duplicate key in same request", () => {
  const atomA = Atom.serializable(Atom.make(0), {
    key: "shared-key",
    schema: Schema.Number,
  });
  const atomB = Atom.serializable(Atom.make(0), {
    key: "shared-key",
    schema: Schema.Number,
  });

  const ctx = { state: {} };
  initAtomHydrationMap(ctx);
  setAtom(ctx, atomA, 1);

  assertThrows(
    () => setAtom(ctx, atomB, 2),
    Error,
    "Duplicate atom key",
  );
});

Deno.test("setAtom throws when hydration map not initialized", () => {
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "count",
    schema: Schema.Number,
  });

  const ctx = { state: {} };
  // Note: intentionally NOT calling initAtomHydrationMap(ctx)

  assertThrows(
    () => setAtom(ctx, countAtom, 1),
    Error,
    "not initialized",
  );
});

Deno.test("multiple atoms serialize correctly", () => {
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "count",
    schema: Schema.Number,
  });
  const labelAtom = Atom.serializable(Atom.make(""), {
    key: "label",
    schema: Schema.String,
  });

  const ctx = { state: {} };
  initAtomHydrationMap(ctx);
  setAtom(ctx, countAtom, 7);
  setAtom(ctx, labelAtom, "hello");

  const result = serializeAtomHydration(ctx);
  assertEquals(typeof result, "string");

  const parsed = JSON.parse(result!);
  assertEquals(parsed.count, 7);
  assertEquals(parsed.label, "hello");
});
