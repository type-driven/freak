#!/usr/bin/env -S deno run -A
/**
 * Patches effect@4.0.0-beta.20's json.decode in RpcSerialization.js.
 *
 * Root cause: json.decode returns [JSON.parse(bytes)] always, but the server
 * encodes the response as JSON.stringify([...messages...]) — an array. So the
 * client gets [[...messages...]] (double-wrapped) and writeResponse receives
 * the inner array, whose ._tag is undefined, gets silently dropped, and
 * entry.resume is never called → permanent hang.
 *
 * Fix: if the parsed JSON is already an array, return it directly.
 *
 * Upstream issue: https://github.com/Effect-TS/effect (to be reported)
 */

import { join } from "@std/path";

const target = join(
  import.meta.dirname!,
  "../node_modules/.deno/effect@4.0.0-beta.20/node_modules/effect/dist/unstable/rpc/RpcSerialization.js",
);

let src = await Deno.readTextFile(target);

const before = `      decode: bytes => [JSON.parse(typeof bytes === "string" ? bytes : decoder.decode(bytes))],`;
const after  = `      decode: bytes => { const parsed = JSON.parse(typeof bytes === "string" ? bytes : decoder.decode(bytes)); return Array.isArray(parsed) ? parsed : [parsed]; },`;

if (src.includes(after)) {
  console.log("✓ effect json.decode patch already applied");
  Deno.exit(0);
}
if (!src.includes(before)) {
  console.error("✗ Could not find the target line — effect version may have changed, check the patch.");
  Deno.exit(1);
}

src = src.replace(before, after);
await Deno.writeTextFile(target, src);
console.log("✓ Patched effect json.decode in RpcSerialization.js");
