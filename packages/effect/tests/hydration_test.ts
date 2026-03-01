/**
 * Unit tests for server-side atom hydration primitives in @fresh/effect.
 *
 * Tests:
 * 1. setAtom stores encoded value in per-request map
 * 2. serializeAtomHydration returns JSON string
 * 3. serializeAtomHydration returns null when no atoms set
 * 4. setAtom throws on non-serializable atom
 * 5. setAtom throws on duplicate key in same request
 * 6. setAtom lazily creates hydration map on first call
 * 7. multiple atoms serialize correctly
 * 8. initAtomHydrationMap is idempotent — second call does not reset the map
 */

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

Deno.test("setAtom lazily creates hydration map on first call", () => {
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "lazy-count",
    schema: Schema.Number,
  });

  const ctx = { state: {} };
  // Note: intentionally NOT calling initAtomHydrationMap(ctx)

  // Should not throw — lazily creates the Map
  setAtom(ctx, countAtom, 99);

  const json = serializeAtomHydration(ctx);
  assertEquals(json, JSON.stringify({ "lazy-count": 99 }));
});

Deno.test("initAtomHydrationMap is idempotent — second call does not reset the map", () => {
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "idem-count",
    schema: Schema.Number,
  });

  const ctx = { state: {} };
  initAtomHydrationMap(ctx);
  setAtom(ctx, countAtom, 42);

  // Second app / second call — must not reset the Map
  initAtomHydrationMap(ctx);

  const json = serializeAtomHydration(ctx);
  assertEquals(json, JSON.stringify({ "idem-count": 42 }));
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
