/**
 * /query-demo — demonstrates useRpcQuery + useMutation with optimistic updates.
 *
 * Contrast with /rpc-demo (manual trigger, no cache) and / (atom hydration SSR).
 * This page is purely client-side: the island fetches on mount, caches the result,
 * and applies optimistic updates without any server-side data loading.
 */

import QueryMutationDemo from "../islands/QueryMutationDemo.tsx";

export default function QueryDemoPage() {
  return (
    <div style="padding: 1rem; font-family: sans-serif; max-width: 600px; margin: 0 auto">
      <h1>useQuery + useMutation Demo</h1>
      <p style="color:#6b7280;margin-bottom:1.5rem">
        The list loads automatically on mount (<code>useRpcQuery</code>). Adding
        and deleting todos use <code>useMutation</code>{" "}
        with optimistic updates — the UI updates before the server responds and
        rolls back on error.
      </p>
      <QueryMutationDemo />
      <p style="margin-top: 2rem; font-size: 0.9em">
        <a href="/rpc-demo">RPC Demo (useRpcResult / useRpcStream)</a>
        {" \u2014 "}
        <a href="/streaming-modes">Streaming Modes Demo</a>
        {" \u2014 "}
        <a href="/">Home</a>
      </p>
    </div>
  );
}
