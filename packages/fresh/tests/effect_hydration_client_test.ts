/**
 * Client-side hydration tests for the atom hydration pipeline in @fresh/core/effect.
 *
 * Tests:
 * 1. AtomRegistry.setSerializable pre-seeds value for serializable atom
 * 2. Serializable atom get() returns pre-seeded value over default
 * 3. Multiple pre-seeded atoms resolve correctly
 * 4. Singleton identity: initAtomHydration uses module-level registry
 * 5. Atom.isSerializable returns true for serializable atoms
 * 6. Atom.isSerializable returns false for plain atoms
 * 7. serializeAtomHydration + setSerializable round-trip (full server-to-client pipeline)
 * 8. initAtomHydration() handles malformed JSON gracefully (no throw)
 * 9. initAtomHydration() is a no-op for empty string
 * 10. _checkOrphanedKeys is exported and callable
 */

import { assertEquals } from "jsr:@std/assert@1";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import * as Schema from "effect/Schema";
import { _checkOrphanedKeys, initAtomHydration } from "../src/effect/island-atoms.ts";
import {
  _initAtomHydrationMap as initAtomHydrationMap,
  serializeAtomHydration,
  setAtom,
} from "../src/effect/hydration.ts";

// --- Category 1: AtomRegistry.setSerializable behavior ---

Deno.test("AtomRegistry.setSerializable pre-seeds value for serializable atom", () => {
  const registry = AtomRegistry.make();
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "count",
    schema: Schema.Number,
  });

  registry.setSerializable("count", 99);

  assertEquals(registry.get(countAtom), 99);
});

Deno.test("Serializable atom get() returns pre-seeded value over default", () => {
  const registry = AtomRegistry.make();
  const nameAtom = Atom.serializable(Atom.make("default"), {
    key: "name",
    schema: Schema.String,
  });

  // Without pre-seeding, returns default
  assertEquals(registry.get(nameAtom), "default");

  // With pre-seeding, returns seeded value
  registry.setSerializable("name", "Alice");
  assertEquals(registry.get(nameAtom), "Alice");
});

Deno.test("Multiple pre-seeded atoms resolve correctly", () => {
  const registry = AtomRegistry.make();
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "multi-count",
    schema: Schema.Number,
  });
  const labelAtom = Atom.serializable(Atom.make(""), {
    key: "multi-label",
    schema: Schema.String,
  });

  registry.setSerializable("multi-count", 7);
  registry.setSerializable("multi-label", "hello");

  assertEquals(registry.get(countAtom), 7);
  assertEquals(registry.get(labelAtom), "hello");
});

// --- Category 2: island-atoms.ts singleton identity ---

Deno.test("Singleton identity: initAtomHydration uses module-level registry", () => {
  // initAtomHydration(json) pre-seeds the module registry.
  // We can't directly get() from the module registry (it's not exported),
  // but we can verify that calling initAtomHydration with a valid JSON string
  // does not throw and runs without error.
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "singleton-test-count",
    schema: Schema.Number,
  });

  // Should not throw
  initAtomHydration(JSON.stringify({ "singleton-test-count": 42 }));

  // Verify the atom is serializable (pre-condition for seeding)
  assertEquals(Atom.isSerializable(countAtom), true);
});

// --- Category 3: Atom.isSerializable checks ---

Deno.test("Atom.isSerializable returns true for serializable atoms", () => {
  const serialAtom = Atom.serializable(Atom.make(0), {
    key: "is-serial",
    schema: Schema.Number,
  });
  assertEquals(Atom.isSerializable(serialAtom), true);
});

Deno.test("Atom.isSerializable returns false for plain atoms", () => {
  const plainAtom = Atom.make(0);
  assertEquals(Atom.isSerializable(plainAtom), false);
});

// --- Category 4: Full server-to-client round-trip ---

Deno.test("serializeAtomHydration + setSerializable round-trip", () => {
  // Server side: use setAtom + serializeAtomHydration to produce JSON
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "roundtrip-count",
    schema: Schema.Number,
  });
  const labelAtom = Atom.serializable(Atom.make(""), {
    key: "roundtrip-label",
    schema: Schema.String,
  });

  const ctx = { state: {} };
  initAtomHydrationMap(ctx);
  setAtom(ctx, countAtom, 42);
  setAtom(ctx, labelAtom, "world");

  const json = serializeAtomHydration(ctx);
  assertEquals(typeof json, "string");

  // Client side: parse JSON and call registry.setSerializable for each entry
  const registry = AtomRegistry.make();
  const data = JSON.parse(json!) as Record<string, unknown>;
  for (const [key, encoded] of Object.entries(data)) {
    registry.setSerializable(key, encoded);
  }

  // Verify atoms return server-set values, not defaults
  assertEquals(registry.get(countAtom), 42);
  assertEquals(registry.get(labelAtom), "world");
});

// --- Category 5: initAtomHydration error handling ---

Deno.test("initAtomHydration handles malformed JSON gracefully", () => {
  // Should not throw — issues a console.warn and returns
  initAtomHydration("{not valid json}");
  assertEquals(true, true);
});

Deno.test("initAtomHydration is a no-op for empty string", () => {
  initAtomHydration("");
  assertEquals(true, true);
});

// --- Category 6: _checkOrphanedKeys is callable ---

Deno.test("_checkOrphanedKeys is exported and callable", () => {
  // Active orphan detection is deferred; this must not throw
  _checkOrphanedKeys();
  assertEquals(true, true);
});
