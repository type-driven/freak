/**
 * StreamingModesDemo island — compares all four RPC streaming transports
 * side-by-side: WebSocket, HTTP-stream, SSE, and polling.
 *
 * Each panel subscribes to the same WatchTodos (or ListTodos for polling)
 * procedure and shows the latest todo count + list. When you add or delete
 * todos on the RPC Demo page, all four panels update within ~2 seconds.
 *
 * Server endpoints required (all use RpcWithDeps / TodoRpc):
 *   /rpc/todos/ws     — websocket
 *   /rpc/todos/stream — http-stream
 *   /rpc/todos/sse    — sse
 *   /rpc/todos        — http (for polling via ListTodos)
 */

import {
  useRpcHttpStream,
  useRpcPolled,
  useRpcSse,
  useRpcStream,
  type RpcStreamState,
} from "@fresh/effect/island";
import { TodoRpc } from "../services/rpc.ts";
import type { Todo } from "../types.ts";

// WebSocket URL built at runtime — switches ws/wss based on page protocol.
const wsBase = typeof window !== "undefined"
  ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`
  : "ws://localhost:8000";

function StatusBadge({ state }: { state: RpcStreamState<unknown, unknown> }) {
  const styles: Record<string, string> = {
    connecting: "background:#f59e0b;color:white",
    connected: "background:#22c55e;color:white",
    error: "background:#ef4444;color:white",
    closed: "background:#6b7280;color:white",
  };
  return (
    <span
      style={`${styles[state._tag] ?? ""};padding:0.15rem 0.5rem;border-radius:4px;font-size:0.75em;font-weight:600`}
    >
      {state._tag}
    </span>
  );
}

function TodoList({ state }: { state: RpcStreamState<unknown, unknown> }) {
  if (state._tag !== "connected" || state.latest === null) {
    return <p style="color:#9ca3af;font-size:0.85em;margin:0">—</p>;
  }
  if (state._tag === "error") {
    return <p style="color:#ef4444;font-size:0.8em;margin:0">Error: {String((state as { error: unknown }).error)}</p>;
  }
  const todos = state.latest as Todo[];
  if (todos.length === 0) {
    return <p style="color:#9ca3af;font-size:0.85em;margin:0">No todos yet.</p>;
  }
  return (
    <ul style="padding:0;list-style:none;margin:0;font-size:0.85em">
      {todos.map((t) => (
        <li
          key={t.id}
          style={`padding:0.2rem 0;${t.done ? "text-decoration:line-through;color:#9ca3af" : ""}`}
        >
          {t.text}
        </li>
      ))}
    </ul>
  );
}

function ModePanel(
  { title, badge, transport, state }: {
    title: string;
    badge: string;
    transport: string;
    state: RpcStreamState<unknown, unknown>;
  },
) {
  const count = state._tag === "connected" && state.latest !== null
    ? (state.latest as Todo[]).length
    : null;

  return (
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:1rem;flex:1;min-width:200px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.25rem">
        <span style="font-size:0.65em;font-weight:700;letter-spacing:0.05em;background:#f3f4f6;padding:0.1rem 0.4rem;border-radius:3px;color:#374151">
          {badge}
        </span>
        <h3 style="margin:0;font-size:1rem">{title}</h3>
      </div>
      <p style="margin:0 0 0.75rem;font-size:0.7em;color:#9ca3af;font-family:monospace;word-break:break-all">
        {transport}
      </p>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.75rem">
        <StatusBadge state={state} />
        {count !== null && (
          <span style="font-size:0.85em;color:#6b7280">
            {count} {count === 1 ? "todo" : "todos"}
          </span>
        )}
      </div>
      <TodoList state={state} />
    </div>
  );
}

export default function StreamingModesDemo() {
  const wsState = useRpcStream(TodoRpc, {
    url: `${wsBase}/rpc/todos/ws`,
    procedure: "WatchTodos",
  });

  const httpStreamState = useRpcHttpStream(TodoRpc, {
    url: "/rpc/todos/stream",
    procedure: "WatchTodos",
  });

  const sseState = useRpcSse(TodoRpc, {
    url: "/rpc/todos/sse",
    procedure: "WatchTodos",
  });

  const pollState = useRpcPolled(TodoRpc, {
    url: "/rpc/todos",
    procedure: "ListTodos",
    interval: 2000,
  });

  return (
    <div style="font-family:sans-serif">
      <p style="color:#6b7280;margin:0 0 1.25rem;font-size:0.9em">
        All four panels subscribe to the same todo list. Add or delete todos on
        the{" "}
        <a href="/rpc-demo" style="color:#3b82f6">RPC Demo page</a>{" "}
        to see all four update within ~2 seconds.
      </p>
      <div style="display:flex;gap:1rem;flex-wrap:wrap">
        <ModePanel
          title="WebSocket"
          badge="WS"
          transport={`useRpcStream · ${wsBase}/rpc/todos/ws`}
          state={wsState}
        />
        <ModePanel
          title="HTTP-stream"
          badge="NDJSON"
          transport="useRpcHttpStream · POST /rpc/todos/stream"
          state={httpStreamState}
        />
        <ModePanel
          title="Server-Sent Events"
          badge="SSE"
          transport="useRpcSse · GET /rpc/todos/sse?p=WatchTodos"
          state={sseState}
        />
        <ModePanel
          title="HTTP Polling"
          badge="POLL"
          transport="useRpcPolled · POST /rpc/todos (2 s)"
          state={pollState}
        />
      </div>
    </div>
  );
}
