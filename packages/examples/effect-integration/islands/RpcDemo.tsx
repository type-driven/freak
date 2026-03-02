/**
 * RpcDemo island — demonstrates todo CRUD via useRpcResult and live updates
 * via useRpcStream.
 *
 * - useRpcResult: typed HTTP request/response (ListTodos, CreateTodo, DeleteTodo)
 * - useRpcStream: WebSocket streaming (WatchTodos) for live todo count updates
 *
 * SC-2 browser verification: the useRpcStream call initiates a real WebSocket
 * connection observable in browser devtools when visiting /rpc-demo.
 */

import { useState } from "preact/hooks";
import { useRpcResult, useRpcStream } from "@fresh/effect/island";
import { TodoRpc } from "../services/rpc.ts";

export default function RpcDemo() {
  const [result, client] = useRpcResult(TodoRpc, { url: "/rpc/todos" });
  const streamState = useRpcStream(TodoRpc, {
    url: `ws://${
      typeof window !== "undefined" ? window.location.host : "localhost:8000"
    }/rpc/todos/ws`,
    procedure: "WatchTodos",
  });
  const [text, setText] = useState("");

  const loadTodos = () => client.ListTodos();
  const createTodo = () => {
    if (text.trim()) {
      client.CreateTodo({ text: text.trim() });
      setText("");
    }
  };
  const deleteTodo = (id: string) => () => {
    client.DeleteTodo({ id });
  };

  return (
    <div style="padding: 1rem; font-family: sans-serif">
      <h2>RPC Todo List</h2>

      {/* CRUD section using useRpcResult */}
      <div style="margin-bottom: 1rem">
        <input
          type="text"
          value={text}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          placeholder="New todo text..."
          style="margin-right: 0.5rem; padding: 0.25rem"
        />
        <button type="button" onClick={createTodo} style="margin-right: 0.5rem">
          Add
        </button>
        <button type="button" onClick={loadTodos}>Refresh</button>
      </div>

      {result._tag === "idle" && (
        <p style="color: gray">Click Refresh to load todos.</p>
      )}
      {result._tag === "loading" && <p>Loading...</p>}
      {result._tag === "ok" && Array.isArray(result.value) && (
        <ul>
          {(result.value as Array<{ id: string; text: string; done: boolean }>)
            .map((todo) => (
              <li key={todo.id} style="margin-bottom: 0.25rem">
                <span style={todo.done ? "text-decoration: line-through" : ""}>
                  {todo.text}
                </span>{" "}
                <button
                  type="button"
                  onClick={deleteTodo(todo.id)}
                  style="font-size: 0.8em"
                >
                  Delete
                </button>
              </li>
            ))}
        </ul>
      )}
      {result._tag === "ok" && !Array.isArray(result.value) && (
        <p style="color: green">
          Created: {(result.value as { text: string }).text}
        </p>
      )}
      {result._tag === "err" && (
        <p style="color: red">Error: {String(result.error)}</p>
      )}

      {/* Live updates section using useRpcStream (WebSocket) */}
      <h3 style="margin-top: 1.5rem">Live Updates (WebSocket)</h3>
      <p style="font-size: 0.85em; color: gray">
        Open browser devtools Network tab to observe the WebSocket connection.
      </p>
      {streamState._tag === "connecting" && (
        <p style="color: orange">Connecting to WebSocket...</p>
      )}
      {streamState._tag === "connected" && (
        <p style="color: green">
          Live todo count: {streamState.latest !== null
            ? (streamState.latest as unknown[]).length
            : "—"}
        </p>
      )}
      {streamState._tag === "error" && (
        <p style="color: red">
          Stream error: {String(streamState.error)}
        </p>
      )}
      {streamState._tag === "closed" && (
        <p style="color: gray">Stream closed.</p>
      )}
    </div>
  );
}
