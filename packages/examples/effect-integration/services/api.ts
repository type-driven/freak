/**
 * HttpApi definition and group implementation for the example app.
 *
 * Defines TodoApi with three endpoints:
 * - GET /todos/   — list all todos
 * - GET /todos/:id — get one todo by ID (returns 404 if not found)
 * - POST /todos/   — create a new todo
 *
 * TodosLive implements each handler using TodoService.
 */

import { Effect, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { TodoService } from "./TodoService.ts";
import { TodoSchema } from "../types.ts";

// ---------------------------------------------------------------------------
// API definition
// ---------------------------------------------------------------------------

export const TodoApi = HttpApi.make("todoApi").add(
  HttpApiGroup.make("todos")
    .add(
      HttpApiEndpoint.get("list", "/todos/", {
        success: Schema.Array(TodoSchema),
      }),
    )
    .add(
      HttpApiEndpoint.get("getById", "/todos/:id", {
        params: { id: Schema.String },
        success: TodoSchema,
        error: HttpApiError.NotFound,
      }),
    )
    .add(
      HttpApiEndpoint.post("create", "/todos/", {
        payload: Schema.Struct({ text: Schema.String }),
        success: TodoSchema,
      }),
    ),
);

// ---------------------------------------------------------------------------
// Group implementation
// ---------------------------------------------------------------------------

export const TodosLive = HttpApiBuilder.group(
  TodoApi,
  "todos",
  (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const svc = yield* TodoService;
          return yield* svc.list();
        }))
      .handle("getById", ({ params }) =>
        Effect.gen(function* () {
          const svc = yield* TodoService;
          const todos = yield* svc.list();
          const todo = todos.find((t) => t.id === params.id);
          if (!todo) return yield* new HttpApiError.NotFound({});
          return todo;
        }))
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const svc = yield* TodoService;
          return yield* svc.create(payload.text);
        })),
);
