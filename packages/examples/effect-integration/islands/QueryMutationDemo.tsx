/**
 * QueryMutationDemo island — demonstrates the new data-fetching primitives:
 *
 * - `useRpcQuery`  — auto-fetches on mount; caches result under "todos" key
 * - `useMutation`  — runs an RPC call; invalidates the cache on success
 * - Optimistic updates via `getCacheData` / `setCacheData` / rollback in `onError`
 *
 * Contrast with RpcDemo which uses `useRpcResult` (manual trigger, no cache)
 * and `useRpcStream` (WebSocket push). This island is purely request/response
 * but the list loads automatically and stays consistent after mutations.
 */

import { useState } from "preact/hooks";
import {
  getCacheData,
  makeRpcHttpLayer,
  setCacheData,
  useMutation,
  useRpcQuery,
} from "@fresh/effect/island";
import { Effect } from "effect";
import { RpcClient } from "effect/unstable/rpc";
import { TodoRpc } from "../services/rpc.ts";
import type { Todo } from "../types.ts";

// Cache key shared by useRpcQuery and useMutation.invalidates.
const TODOS_KEY = "todos";
const RPC_URL = "/rpc/todos";

// Built once at module load; shared memoMap in getBrowserRuntime handles dedup.
const rpcLayer = makeRpcHttpLayer(RPC_URL);

// ---------------------------------------------------------------------------
// Typed mutation helpers
// ---------------------------------------------------------------------------

function createTodoEffect(text: string): Effect.Effect<Todo, unknown, never> {
  return Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TodoRpc);
      return yield* client.CreateTodo({ text });
    }),
  ).pipe(Effect.provide(rpcLayer)) as Effect.Effect<Todo, unknown, never>;
}

function deleteTodoEffect(id: string): Effect.Effect<void, unknown, never> {
  return Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(TodoRpc);
      yield* client.DeleteTodo({ id });
    }),
  ).pipe(Effect.provide(rpcLayer)) as Effect.Effect<void, unknown, never>;
}

// ---------------------------------------------------------------------------
// Island component
// ---------------------------------------------------------------------------

export default function QueryMutationDemo() {
  const [newText, setNewText] = useState("");

  // ── 1. useRpcQuery ─────────────────────────────────────────────────────────
  // Fetches ListTodos on mount. Result is cached under TODOS_KEY.
  // Re-fetches automatically whenever the cache entry is invalidated.
  const { data: todos, isLoading, error, refetch } = useRpcQuery(TodoRpc, {
    key: TODOS_KEY,
    url: RPC_URL,
    procedure: "ListTodos",
  });

  // ── 2. useMutation: CreateTodo with optimistic update ──────────────────────
  // onMutate: immediately adds a placeholder todo to the cache (no flicker).
  // onError: rolls back to the previous list if the server call fails.
  // invalidates: after success, marks the cache stale → useRpcQuery refetches.
  const createMutation = useMutation(
    (text: string) => createTodoEffect(text),
    {
      onMutate: (text) => {
        const prev = getCacheData<Todo[]>(TODOS_KEY);
        const optimistic: Todo = {
          id: `temp-${Date.now()}`,
          text,
          done: false,
        };
        setCacheData(TODOS_KEY, [...(prev ?? []), optimistic]);
        return { prev };
      },
      onError: (_err, _text, ctx) => {
        setCacheData(TODOS_KEY, ctx.prev ?? []);
      },
      invalidates: [TODOS_KEY],
    },
  );

  // ── 3. useMutation: DeleteTodo with optimistic update ──────────────────────
  const deleteMutation = useMutation(
    (id: string) => deleteTodoEffect(id),
    {
      onMutate: (id) => {
        const prev = getCacheData<Todo[]>(TODOS_KEY);
        setCacheData(TODOS_KEY, (prev ?? []).filter((t) => t.id !== id));
        return { prev };
      },
      onError: (_err, _id, ctx) => {
        setCacheData(TODOS_KEY, ctx.prev ?? []);
      },
      invalidates: [TODOS_KEY],
    },
  );

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleAdd(e: Event) {
    e.preventDefault();
    const text = newText.trim();
    if (!text) return;
    setNewText("");
    createMutation.mutate(text);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const list = (todos as Todo[] | undefined) ?? [];
  const isPending = createMutation.isPending || deleteMutation.isPending;

  return (
    <div style="font-family: sans-serif; max-width: 480px">
      {/* Status bar */}
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;font-size:0.8em;color:#6b7280">
        {isLoading && !isPending
          ? <span style="color:#3b82f6">⟳ fetching…</span>
          : isPending
          ? <span style="color:#f59e0b">⟳ saving…</span>
          : <span style="color:#22c55e">✓ up to date</span>}
        <button
          type="button"
          onClick={refetch}
          style="margin-left:auto;font-size:0.85em;cursor:pointer;background:none;border:1px solid #d1d5db;border-radius:4px;padding:0.1rem 0.4rem;color:#374151"
        >
          refetch
        </button>
      </div>

      {/* Error */}
      {error && (
        <p style="color:#ef4444;font-size:0.85em;margin-bottom:0.75rem">
          Error: {String(error)}
        </p>
      )}

      {/* Add form */}
      <form
        onSubmit={handleAdd}
        style="display:flex;gap:0.5rem;margin-bottom:1rem"
      >
        <input
          type="text"
          value={newText}
          onInput={(e) => setNewText((e.target as HTMLInputElement).value)}
          placeholder="New todo…"
          style="flex:1;padding:0.35rem 0.5rem;border:1px solid #d1d5db;border-radius:4px;font-size:0.9em"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          style="padding:0.35rem 0.75rem;background:#3b82f6;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.9em"
        >
          Add
        </button>
      </form>

      {/* List */}
      {isLoading && list.length === 0
        ? <p style="color:#9ca3af;font-size:0.9em">Loading…</p>
        : list.length === 0
        ? (
          <p style="color:#9ca3af;font-size:0.9em">
            No todos yet. Add one above!
          </p>
        )
        : (
          <ul style="list-style:none;padding:0;margin:0">
            {list.map((todo) => {
              const isTemp = todo.id.startsWith("temp-");
              return (
                <li
                  key={todo.id}
                  style={`display:flex;align-items:center;gap:0.75rem;padding:0.4rem 0;border-bottom:1px solid #f3f4f6;${
                    isTemp ? "opacity:0.55" : ""
                  }`}
                >
                  <span
                    style={`flex:1;font-size:0.9em;${
                      todo.done
                        ? "text-decoration:line-through;color:#9ca3af"
                        : ""
                    }`}
                  >
                    {todo.text}
                    {isTemp && (
                      <span style="margin-left:0.4rem;font-size:0.7em;color:#d97706">
                        saving…
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => !isTemp && deleteMutation.mutate(todo.id)}
                    disabled={isTemp || deleteMutation.isPending}
                    style="font-size:0.75em;color:#ef4444;background:none;border:none;cursor:pointer;padding:0"
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}

      {/* Legend */}
      <details style="margin-top:1.5rem;font-size:0.75em;color:#6b7280">
        <summary style="cursor:pointer;user-select:none">How it works</summary>
        <ul style="margin-top:0.5rem;padding-left:1.2rem;line-height:1.8">
          <li>
            <code>useRpcQuery</code> fetches <code>ListTodos</code>{" "}
            on mount and caches it under <code>"todos"</code>.
          </li>
          <li>
            <code>useMutation</code> (Create) calls <code>onMutate</code>{" "}
            synchronously — appends a placeholder via <code>setCacheData</code>
            {" "}
            before the server responds.
          </li>
          <li>
            On success, <code>invalidates: ["todos"]</code>{" "}
            marks the cache stale → <code>useRpcQuery</code>{" "}
            refetches and replaces the placeholder.
          </li>
          <li>
            On error, <code>onError</code> calls <code>setCacheData(prev)</code>
            {" "}
            to roll back the optimistic change.
          </li>
          <li>
            Delete works the same way: removes the item optimistically, rolls
            back if the server call fails.
          </li>
        </ul>
      </details>
    </div>
  );
}
