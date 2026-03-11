import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

/**
 * Shared reactive atoms across host + plugin sub-apps.
 *
 * These are serializable so server handlers can hydrate initial values into
 * islands on first render via setAtom(ctx, atom, value).
 */

export const counterAtom = Atom.serializable(Atom.make(0), {
  key: "counter",
  schema: Schema.Number,
});

export const greetingAtom = Atom.serializable(Atom.make(""), {
  key: "greeting",
  schema: Schema.String,
});

/**
 * Shared integration status: both plugins update this.
 * Islands in different sub-apps read/write this atom to demonstrate cross-plugin
 * shared state and reactivity.
 */
export const platformStatusAtom = Atom.serializable(Atom.make("idle"), {
  key: "platformStatus",
  schema: Schema.String,
});
