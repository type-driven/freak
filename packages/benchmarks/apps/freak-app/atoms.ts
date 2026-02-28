import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

export const counterAtom = Atom.serializable(
  Atom.make(0),
  { key: "bench-counter", schema: Schema.Number },
);
