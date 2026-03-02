/**
 * /streaming-modes — side-by-side comparison of all four RPC streaming transports.
 *
 * Each panel uses a different hook from @fresh/effect/island:
 *   - WebSocket     → useRpcStream
 *   - HTTP-stream   → useRpcHttpStream  (framed NDJSON POST)
 *   - SSE           → useRpcSse         (EventSource GET)
 *   - Polling       → useRpcPolled      (HTTP POST on interval)
 */

import StreamingModesDemo from "../islands/StreamingModesDemo.tsx";

export default function StreamingModesPage() {
  return (
    <div style="padding: 1.5rem; font-family: sans-serif; max-width: 960px; margin: 0 auto">
      <h1 style="margin: 0 0 0.5rem">Streaming Modes</h1>
      <p style="color: #6b7280; margin: 0 0 2rem">
        Four ways to receive server-push data via{" "}
        <code style="background:#f3f4f6;padding:0.1rem 0.3rem;border-radius:3px">
          @fresh/effect
        </code>{" "}
        RPC. Pick the transport that fits your environment.
      </p>

      <StreamingModesDemo />

      <table style="margin-top: 2rem; border-collapse: collapse; width: 100%; font-size: 0.85em">
        <thead>
          <tr style="border-bottom: 2px solid #e5e7eb; text-align: left">
            <th style="padding: 0.5rem 0.75rem">Transport</th>
            <th style="padding: 0.5rem 0.75rem">Hook</th>
            <th style="padding: 0.5rem 0.75rem">Protocol</th>
            <th style="padding: 0.5rem 0.75rem">Best for</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom: 1px solid #f3f4f6">
            <td style="padding: 0.5rem 0.75rem">WebSocket</td>
            <td style="padding: 0.5rem 0.75rem; font-family: monospace">
              useRpcStream
            </td>
            <td style="padding: 0.5rem 0.75rem">ws:// bidirectional</td>
            <td style="padding: 0.5rem 0.75rem">
              Full-duplex, low-latency push
            </td>
          </tr>
          <tr style="border-bottom: 1px solid #f3f4f6">
            <td style="padding: 0.5rem 0.75rem">HTTP-stream</td>
            <td style="padding: 0.5rem 0.75rem; font-family: monospace">
              useRpcHttpStream
            </td>
            <td style="padding: 0.5rem 0.75rem">POST + NDJSON body</td>
            <td style="padding: 0.5rem 0.75rem">
              Streaming where WebSocket is unavailable
            </td>
          </tr>
          <tr style="border-bottom: 1px solid #f3f4f6">
            <td style="padding: 0.5rem 0.75rem">SSE</td>
            <td style="padding: 0.5rem 0.75rem; font-family: monospace">
              useRpcSse
            </td>
            <td style="padding: 0.5rem 0.75rem">GET text/event-stream</td>
            <td style="padding: 0.5rem 0.75rem">
              Auto-reconnect, proxy-friendly
            </td>
          </tr>
          <tr>
            <td style="padding: 0.5rem 0.75rem">Polling</td>
            <td style="padding: 0.5rem 0.75rem; font-family: monospace">
              useRpcPolled
            </td>
            <td style="padding: 0.5rem 0.75rem">POST on interval</td>
            <td style="padding: 0.5rem 0.75rem">
              Simple, no persistent connection
            </td>
          </tr>
        </tbody>
      </table>

      <p style="margin-top: 2rem">
        <a href="/" style="color: #3b82f6">← Home</a>
        {" · "}
        <a href="/rpc-demo" style="color: #3b82f6">RPC Demo</a>
      </p>
    </div>
  );
}
