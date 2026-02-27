/**
 * /rpc-demo route — demonstrates Effect RPC integration with useRpcResult
 * and useRpcStream hooks.
 *
 * SC-2 browser verification: visit this page and observe the WebSocket
 * connection in browser devtools Network tab. The RpcDemo island uses
 * useRpcStream(TodoRpc, { url: "ws://...", procedure: "WatchTodos" }) to
 * establish a live WebSocket connection.
 */

import RpcDemo from "../islands/RpcDemo.tsx";

export default function RpcDemoPage() {
  return (
    <div style="padding: 1rem; font-family: sans-serif; max-width: 600px; margin: 0 auto">
      <h1>RPC Demo</h1>
      <p>
        Todo CRUD via <code>useRpcResult</code> (HTTP) and live updates via{" "}
        <code>useRpcStream</code> (WebSocket).
      </p>
      <RpcDemo />
      <p style="margin-top: 2rem">
        <a href="/">Back to home</a>
      </p>
    </div>
  );
}
