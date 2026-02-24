import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";
import { TodoSchema } from "./types.ts";
import type { Todo } from "./types.ts";

export const todoListAtom = Atom.serializable(
  Atom.make<Todo[]>([]),
  {
    key: "todo-list",
    schema: Schema.mutable(Schema.Array(TodoSchema)),
  },
);
