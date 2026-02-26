# Phase 9: RPC Integration - Context

**Gathered:** 2026-02-26
**Status:** Ready for planning

<domain>
## Phase Boundary

`app.rpc({ group, path, protocol })` mounts a native Effect RpcServer on an `EffectApp`.
Preact islands call `useRpcResult(group, { url })` for typed request/response RPCs (HTTP)
and `useRpcStream(group, { url })` for server-push streaming (WebSocket). No manual fetch
wiring. TypeScript rejects calls to undeclared procedures at the call site.

Covered: registration API, two island hooks, dual-protocol support (HTTP + WS), integration
test, example app demo with live todo updates.
Not covered: RPC auth/middleware, per-procedure caching, RPC-over-SSE, browser HMR for WS.

</domain>

<decisions>
## Implementation Decisions

### Island hook API
- Two hooks with protocol-explicit names:
  - `useRpcResult(group, { url })` — request/response (HTTP), returns `Result<Data, Error>`
  - `useRpcStream(group, { url })` — server-push streaming (WebSocket), return shape at Claude's discretion
- Both return `Result` type (not raw Promise throw) — island handles ok/error branches explicitly
- Both hooks live in `@fresh/effect` island.ts alongside `useAtom` / `useAtomValue`
- Claude decides internal hook design (reactive vs imperative, loading state handling) based on what fits Effect + Preact idioms best; atoms are available as a building block

### app.rpc() registration
- Path is always **explicit**: `app.rpc({ group: TodoRpc, path: '/rpc/todos', protocol: ... })`
  — same convention as `httpApi(prefix, api, ...layers)`, no auto-derivation
- Protocol value: Claude picks what fits Effect's RpcServer.layerHttp / layerWebSocket natively
- `app.rpc()` returns **void** (not `this`) — called for side effect, no chaining
- Two separate `app.rpc()` calls to register HTTP and WS on the same group (if dual-protocol):
  `app.rpc({ group, path: '/rpc/todos', protocol: 'http' })`
  `app.rpc({ group, path: '/rpc/todos/ws', protocol: 'ws' })`
  (or whatever structure the Effect RPC API makes natural — Claude decides)

### Dual-protocol
- SC-2 requires a **real browser WebSocket** — observable in browser devtools
- Both protocols must be verified working (not just type-checked)
- Claude decides registration shape based on what Effect's RpcServer API natively exposes

### Example app demo
- **Todo CRUD via RPC + live updates** in the existing example app:
  - `useRpcResult` for list / create / delete operations
  - `useRpcStream` for a server-push channel that broadcasts updated todo list to all connected islands
  - A typed RPC error demo — handler returns typed error; island receives it via the Result branch
- SC-1 verified by **automated integration test** (FakeServer pattern, same as `httpapi_test.ts`)
- SC-2 verified in-browser (real WS connection observable in devtools)

### Verification approach
- Automated: `rpc_test.ts` with FakeServer covering SC-1 (typed response), SC-2 logic, SC-3 (TS rejection)
- Browser: example app `/rpc-demo` or enhanced todo page demonstrating live WS updates

### Claude's Discretion
- Internal hook implementation (signal-based vs useState, subscription management)
- Exact protocol param value (`'http'` string vs Effect enum vs inferred from path)
- How `useRpcStream` delivers push events (callback, async iterator, atom, signal)
- RpcGroup naming conventions in example app
- Whether the live update stream is on the main todo page or a separate `/live` route

</decisions>

<specifics>
## Specific Ideas

- The hook naming `useRpcResult` / `useRpcStream` is the user's own proposal — keep these exact names
- Live todo updates: when any client creates/deletes a todo, server pushes the updated list to all connected islands (real-time sync, not just a ticker)
- Atoms are available as a building block in island files — Claude can use them internally if it fits

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-rpc-integration*
*Context gathered: 2026-02-26*
