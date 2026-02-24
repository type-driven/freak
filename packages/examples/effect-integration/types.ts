import * as Schema from "effect/Schema";

export const TodoSchema = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  done: Schema.Boolean,
});

export type Todo = typeof TodoSchema.Type;
