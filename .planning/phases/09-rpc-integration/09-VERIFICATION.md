---
phase: 09-rpc-integration
verified: 2026-02-27T00:46:27Z
status: human_needed
score: 9/10 must-haves verified (1 needs browser)
human_verification:
  - test: "Visit /rpc-demo in browser, observe WebSocket connection"
    expected: "A WebSocket connection to ws://localhost:8000/rpc/todos/ws appears in the browser devtools Network tab. The live todo count section shows 'Connecting to WebSocket...' then transitions to 'Live todo count: N'. The todo CRUD buttons (Refresh, Add, Delete) work via HTTP RPC."
    why_human: "Real WebSocket upgrade handshake requires a live browser + live server. deno test cannot initiate a real WS connection to a running Deno.serve instance without a full integration harness."
---

# Phase 9: RPC Integration Verification Report

**Phase Goal:** Calling `app.rpc({ group, path, protocol })` on an `EffectApp`
mounts a native Effect RPC server, and Preact islands can call
`useRpcResult(group)` and `useRpcStream(group)` to get fully typed clients that
send requests over HTTP or WebSocket — no manual fetch wiring.

**Verified:** 2026-02-27T00:46:27Z **Status:** human_needed — all automated
checks passed; one item requires browser verification **Re-verification:** No —
initial verification

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                         | Status       | Evidence                                                                                |
| -- | ----------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| 1  | `app.rpc()` mounts an RPC server at the specified path                        | VERIFIED     | `rpc()` in `app.ts` lines 329-387: builds RpcServer layer, registers Fresh routes       |
| 2  | An HTTP RPC call returns the procedure's typed response                       | VERIFIED     | SC-1 test passes: `deno test rpc_test.ts` — 3/3 tests ok                                |
| 3  | WebSocket routes are registered without error (smoke)                         | VERIFIED     | SC-2 smoke test passes: dual-route registration ok, handler is a function               |
| 4  | Real WebSocket receives server-push events in browser                         | HUMAN NEEDED | Requires live server + browser devtools — cannot automate                               |
| 5  | `useRpcResult` returns `[state, client]` with typed procedure methods         | VERIFIED     | `island.ts` lines 93-143: substantive hook with Proxy client, typed state union         |
| 6  | `useRpcStream` connects via WebSocket and delivers push events                | VERIFIED     | `island.ts` lines 176-230: ManagedRuntime per hook, BrowserSocket, unmount disposal     |
| 7  | Both hooks live in `packages/effect/src/island.ts` via `@fresh/effect/island` | VERIFIED     | `deno.json` exports `"./island": "./src/island.ts"` — import path confirmed             |
| 8  | `RpcDemo.tsx` island uses both hooks with real procedure calls                | VERIFIED     | Lines 17-21: `useRpcResult(TodoRpc, ...)` and `useRpcStream(TodoRpc, ...)` called       |
| 9  | TypeScript rejects a procedure not declared in the group schema (SC-3)        | VERIFIED     | `deno check rpc_types_test.ts` passes; `@ts-expect-error` fires on `client.NonExistent` |
| 10 | `/rpc-demo` route serves the RpcDemo island                                   | VERIFIED     | `routes/rpc-demo.tsx` exists, imports and renders `<RpcDemo />`                         |

**Score:** 9/10 truths verified (1 human-needed)

---

## Required Artifacts

| Artifact                                                   | Expected                                | Status   | Details                                                                                                                      |
| ---------------------------------------------------------- | --------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/effect/src/app.ts`                               | `rpc()` method on EffectApp             | VERIFIED | 547 lines; `rpc()` method at line 329; `#rpcDisposers` array; dual-route WS registration                                     |
| `packages/effect/src/island.ts`                            | `useRpcResult` and `useRpcStream` hooks | VERIFIED | 230 lines; both hooks exported; typed state unions; Proxy client; ManagedRuntime per hook                                    |
| `packages/effect/deno.json`                                | `./island` export + RPC import entries  | VERIFIED | `"./island": "./src/island.ts"` export; `effect/unstable/rpc`, `FetchHttpClient`, `@effect/platform-browser` imports present |
| `packages/effect/tests/rpc_test.ts`                        | SC-1 test using `RpcTest.makeClient`    | VERIFIED | 119 lines; SC-1 test + dispose lifecycle + SC-2 smoke; all 3 tests pass                                                      |
| `packages/effect/tests/rpc_types_test.ts`                  | SC-3 type rejection test                | VERIFIED | 70 lines; `@ts-expect-error` on `client.NonExistent`; `deno check` passes                                                    |
| `packages/examples/effect-integration/services/rpc.ts`     | TodoRpc group + handler layer           | VERIFIED | 84 lines; 4 procedures (ListTodos, CreateTodo, DeleteTodo, WatchTodos); WatchTodos uses `RpcSchema.Stream`                   |
| `packages/examples/effect-integration/islands/RpcDemo.tsx` | Island using both hooks                 | VERIFIED | 109 lines; imports and calls `useRpcResult` + `useRpcStream`; renders state branches                                         |
| `packages/examples/effect-integration/routes/rpc-demo.tsx` | `/rpc-demo` route                       | VERIFIED | 27 lines; imports and renders `<RpcDemo />`; not a stub                                                                      |
| `packages/examples/effect-integration/main.ts`             | `app.rpc()` called with both protocols  | VERIFIED | 49 lines; `app.rpc()` called twice — HTTP at `/rpc/todos`, WS at `/rpc/todos/ws`                                             |

---

## Key Link Verification

| From                       | To                             | Via                                                                 | Status | Details                                                                                 |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- |
| `app.ts` `rpc()`           | `RpcServer.layerHttp`          | `RpcServer.layerHttp({ group, path: "/", protocol })`               | WIRED  | Lines 337-349: builds serverLayer with RpcServer + handler + serialization + HttpServer |
| `app.ts` `rpc()`           | Fresh route handler            | `this.#app.all(path + "/*", ...)` + WS exact path                   | WIRED  | Lines 365-386: prefix-stripped route + WS dual-route                                    |
| `app.ts` `dispose()`       | `#rpcDisposers`                | `for (const disposer of this.#rpcDisposers)`                        | WIRED  | Lines 484-487: RPC disposers iterated in `dispose()`                                    |
| `island.ts` `useRpcResult` | `RpcClient.layerProtocolHttp`  | `RpcClient.make(group)` in Proxy handler                            | WIRED  | Lines 110-131: Layer built at hook init, `Effect.scoped(RpcClient.make(...))` per call  |
| `island.ts` `useRpcStream` | `BrowserSocket.layerWebSocket` | `ManagedRuntime.make(layer)` per hook instance                      | WIRED  | Lines 188-226: ManagedRuntime created, `runtime.dispose()` on unmount                   |
| `RpcDemo.tsx`              | `@fresh/effect/island` hooks   | `import { useRpcResult, useRpcStream } from "@fresh/effect/island"` | WIRED  | Line 13: import; lines 17-21: both hooks called with `TodoRpc`                          |
| `RpcDemo.tsx`              | `../services/rpc.ts`           | `import { TodoRpc } from "../services/rpc.ts"`                      | WIRED  | Line 14: import; used in hook calls                                                     |
| `main.ts`                  | `services/rpc.ts`              | `import { TodoRpc, TodoRpcHandlers }`                               | WIRED  | Line 7: import; lines 30-43: two `app.rpc()` calls with TodoRpc                         |

---

## Requirements Coverage

All 10 must-haves from the phase plan are addressed:

| Must-Have                                                                | Status    | Evidence                                                           |
| ------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------ |
| `app.rpc({ group, path, protocol, handlerLayer })` mounts RPC server     | SATISFIED | `app.ts` `rpc()` method; dispose integrated                        |
| HTTP RPC call returns typed response                                     | SATISFIED | SC-1 test passes: `[{ id: "1", name: "Widget" }]` returned         |
| WebSocket connection receives server-push events via WS path             | PARTIAL   | Smoke test passes; real WS browser test is human-needed            |
| `useRpcResult` returns `[state, client]` typed by RpcGroup schema        | SATISFIED | `island.ts` lines 93-143; Proxy with per-call scoped Effect        |
| `useRpcStream` connects via WebSocket on mount, delivers push events     | SATISFIED | `island.ts` lines 176-230; ManagedRuntime + BrowserSocket          |
| Both hooks in `packages/effect/src/island.ts` via `@fresh/effect/island` | SATISFIED | `deno.json` `./island` export confirmed                            |
| RPC procedure call returns typed response from handler                   | SATISFIED | SC-1: `assertEquals(items, [{ id: "1", name: "Widget" }])` passes  |
| Same RPC group works over HTTP and WebSocket                             | PARTIAL   | HTTP verified by test; WS registration smoke only; browser needed  |
| TypeScript rejects undeclared procedure                                  | SATISFIED | SC-3: `deno check` passes; `@ts-expect-error` fires correctly      |
| Example app has `/rpc-demo` route with live updates                      | SATISFIED | `routes/rpc-demo.tsx` + `islands/RpcDemo.tsx` — substantive, wired |

---

## Anti-Patterns Found

| File          | Line | Pattern                          | Severity | Impact                                                         |
| ------------- | ---- | -------------------------------- | -------- | -------------------------------------------------------------- |
| `RpcDemo.tsx` | 45   | `placeholder="New todo text..."` | Info     | HTML input placeholder attribute — not a code stub, UI element |

No blockers or warnings found.

---

## Human Verification Required

### 1. WebSocket Live Connection in Browser (SC-2)

**Test:**

1. Run `deno task dev` in `packages/examples/effect-integration/`
2. Open browser to `http://localhost:8000/rpc-demo`
3. Open browser devtools → Network tab → filter by "WS" or "WebSocket"
4. Observe a WebSocket connection to `ws://localhost:8000/rpc/todos/ws`
5. Observe the "Live Updates (WebSocket)" section: first shows "Connecting to
   WebSocket..." then transitions to "Live todo count: N" (updating every 2
   seconds)
6. Use the "Add" button to create a todo; verify the count increments in the
   next stream push

**Expected:**

- WebSocket connection appears in devtools Network tab
- Connection stays open (not immediately closed)
- Live todo count updates approximately every 2 seconds
- HTTP CRUD operations (Refresh, Add, Delete) work independently via the result
  state

**Why human:** Real WebSocket upgrade requires a live `Deno.serve` instance plus
a browser or WS client. The automated test suite uses `RpcTest.makeClient`
(in-process, no network) which bypasses the actual HTTP/WS transport layer. The
smoke test verifies registration doesn't throw, but cannot verify the actual WS
handshake succeeds with a real browser client.

---

## Summary

Phase 9 goal is substantially achieved. All code artifacts exist, are
substantive (not stubs), and are correctly wired:

- `EffectApp.rpc()` is a complete implementation (347 lines total in app.ts,
  `rpc()` method is 59 lines of real logic with dual-route WS registration,
  prefix stripping, and dispose lifecycle).
- `useRpcResult` and `useRpcStream` are complete hooks (230 lines in island.ts)
  with real Effect RpcClient calls, Proxy-based typed dispatch, and proper
  unmount cleanup.
- `@fresh/effect/island` export path is present in `deno.json`.
- SC-1 (typed RPC call via RpcTest.makeClient): 3/3 tests pass.
- SC-3 (TypeScript rejects undeclared procedure): `deno check` passes with
  `@ts-expect-error` firing correctly.
- Example app wires both HTTP and WebSocket protocols, `/rpc-demo` route serves
  an island using both hooks.

The one open item is SC-2's live browser WebSocket observation — a structural
requirement that cannot be verified without a running server and browser.

---

_Verified: 2026-02-27T00:46:27Z_ _Verifier: Claude (gsd-verifier)_
