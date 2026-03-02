# Phase 9: RPC Integration - Research

**Researched:** 2026-02-26 **Domain:** Effect v4 RPC (RpcServer, RpcClient,
RpcGroup) + Fresh island hooks **Confidence:** HIGH — all findings verified
directly from source in platform-deno-smol

## Summary

Effect v4 ships a complete RPC subsystem (`effect/unstable/rpc`) with
`RpcServer.layerHttp` as the primary integration point. The server-side pattern
is nearly identical to the `httpApi` mount already in `EffectApp`: build a
Layer, call `HttpRouter.toWebHandler()`, register a Fresh route at the path
prefix. The only difference is that `RpcServer.layerHttp` requires
`RpcSerialization` and `HttpRouter.HttpRouter` as dependencies instead of
`HttpApiBuilder` infrastructure.

The browser client side uses `RpcClient.make(group)` wired to a `Protocol`
layer. For HTTP, this is `RpcClient.layerProtocolHttp({ url })`. For WebSocket,
it is `RpcClient.layerProtocolSocket()` composed with
`BrowserSocket.layerWebSocket(url)`. Both require `RpcSerialization` on the
client side as well. There is NO pre-built "Effect atom + RPC" hook that matches
the `useRpcResult`/`useRpcStream` API the user wants — `AtomRpc.Service` exists
in `effect/unstable/reactivity/AtomRpc` but targets a different usage pattern
(atom-based queries with reactivity keys). The hooks in `@fresh/effect` must be
written from scratch using `preact/hooks`.

For testing, `RpcTest.makeClient` provides an in-process client-server that
requires no HTTP — it wires `RpcServer.makeNoSerialization` and
`RpcClient.makeNoSerialization` together directly. For the `rpc_test.ts`, this
is cleaner than using `FakeServer` + real HTTP stack. The FakeServer approach
(from httpapi_test.ts) also works if desired (via `HttpRouter.toWebHandler` +
posting JSON to the handler function directly).

**Primary recommendation:** Use `RpcServer.layerHttp` with `protocol: 'http'`
for request/response and `protocol: 'websocket'` (the default) for streaming.
Model `app.rpc()` on `app.httpApi()` exactly — build the Layer, call
`HttpRouter.toWebHandler()`, mount at the path prefix. For SC-1 integration test
use `RpcTest.makeClient` (in-process, no HTTP needed).

---

## Standard Stack

### Core (server-side)

| Module             | Import Path            | Purpose                                             |
| ------------------ | ---------------------- | --------------------------------------------------- |
| `Rpc`              | `effect/unstable/rpc`  | Define individual procedures with `Rpc.make()`      |
| `RpcGroup`         | `effect/unstable/rpc`  | Collect procedures with `RpcGroup.make()`           |
| `RpcServer`        | `effect/unstable/rpc`  | Mount server with `RpcServer.layerHttp()`           |
| `RpcSerialization` | `effect/unstable/rpc`  | Serialization format (ndjson for WS, json for HTTP) |
| `HttpRouter`       | `effect/unstable/http` | Required by `layerHttp`; already used in httpApi    |

### Core (client-side, browser islands)

| Module              | Import Path                | Purpose                                                             |
| ------------------- | -------------------------- | ------------------------------------------------------------------- |
| `RpcClient`         | `effect/unstable/rpc`      | `RpcClient.make(group)`, `layerProtocolHttp`, `layerProtocolSocket` |
| `BrowserSocket`     | `@effect/platform-browser` | `BrowserSocket.layerWebSocket(url)` for WS                          |
| `BrowserHttpClient` | `@effect/platform-browser` | `BrowserHttpClient.layerFetch` for HTTP                             |
| `RpcSerialization`  | `effect/unstable/rpc`      | Must match server serialization format                              |

### Testing

| Module    | Import Path           | Purpose                                         |
| --------- | --------------------- | ----------------------------------------------- |
| `RpcTest` | `effect/unstable/rpc` | `RpcTest.makeClient` — in-process client/server |

**Installation:** No new packages needed for server-side (all in
`npm:effect@4.0.0-beta.0`). For browser client in islands,
`@effect/platform-browser` must be added to deno.json imports if WebSocket
support is needed. For HTTP-only RPC, `FetchHttpClient` from
`effect/unstable/http/FetchHttpClient` suffices.

The `deno.json` needs new import entries:

```json
"effect/unstable/rpc": "npm:effect@4.0.0-beta.0/unstable/rpc",
"effect/unstable/rpc/RpcMessage": "npm:effect@4.0.0-beta.0/unstable/rpc/RpcMessage"
```

For browser WS support (if `BrowserSocket` is needed outside of `effect`):

```json
"@effect/platform-browser": "npm:@effect/platform-browser@..."
```

Check the actual version against
`platform-deno-smol/packages/platform-browser/package.json`.

---

## Architecture Patterns

### app.rpc() Server-Side Implementation

`RpcServer.layerHttp` is the key function:

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/rpc/RpcServer.ts
export const layerHttp = <Rpcs extends Rpc.Any>(options: {
  readonly group: RpcGroup.RpcGroup<Rpcs>
  readonly path: HttpRouter.PathInput
  readonly protocol?: "http" | "websocket" | undefined  // default: "websocket"
  readonly disableTracing?: boolean | undefined
  readonly concurrency?: number | "unbounded" | undefined
}): Layer.Layer<
  never,
  never,
  | RpcSerialization.RpcSerialization
  | HttpRouter.HttpRouter
  | Rpc.ToHandler<Rpcs>
  | Rpc.Middleware<Rpcs>
  | Rpc.ServicesServer<Rpcs>
>
```

`layerHttp` is a convenience over `layer(group) + layerProtocolHttp(path)` or
`layer(group) + layerProtocolWebsocket(path)`. Internally it:

1. Creates a `Protocol` service (HTTP or WS)
2. Registers a route on `HttpRouter.HttpRouter` at the given path (POST for
   HTTP, GET+upgrade for WS)
3. Forks the server loop

The **dependencies** it requires are:

- `RpcSerialization.RpcSerialization` — serialization format (provide
  `layerNdjson` for WS, `layerJson` for HTTP)
- `HttpRouter.HttpRouter` — the router instance (provided by
  `HttpRouter.toWebHandler`)
- `Rpc.ToHandler<Rpcs>` — handler implementations from `group.toLayer(...)`
- `Rpc.ServicesServer<Rpcs>` — any extra services handlers need

### Full Composition Pattern for app.rpc()

```typescript
// Source: verified from RpcServer.ts + app.ts httpApi() pattern
function rpc(options: {
  group: RpcGroup.RpcGroup<any>;
  path: string;
  protocol: "http" | "websocket";
  handlerLayer: Layer.Layer<any>;
}) {
  // 1. Build full layer: RpcServer + handlers + serialization + HttpRouter infra
  const serverLayer = RpcServer.layerHttp({
    group: options.group,
    path: options.path,
    protocol: options.protocol,
  }).pipe(
    Layer.provide(options.handlerLayer),
    Layer.provide(
      options.protocol === "http"
        ? RpcSerialization.layerJson
        : RpcSerialization.layerNdjson, // WS needs framing
    ),
    Layer.provide(HttpServer.layerServices), // same as httpApi()
  );

  // 2. Convert to web handler (same as httpApi)
  const { handler, dispose } = HttpRouter.toWebHandler(serverLayer, {
    memoMap: this.#runtime.memoMap,
  });

  // 3. Store dispose for cleanup (same as httpApi)
  this.#rpcDisposers.push(dispose);

  // 4. Mount at path prefix (same as httpApi)
  this.#app.all(options.path + "/*", async (ctx) => {
    const url = new URL(ctx.req.url);
    url.pathname = url.pathname.slice(options.path.length) || "/";
    const rewritten = new Request(url.toString(), ctx.req);
    return await handler(rewritten);
  });
  // Also mount exact path for WS upgrade (no trailing /*)
  // WS uses GET at the exact path, not a sub-path
}
```

**Critical note on WebSocket route registration:** `layerProtocolWebsocket`
registers a GET route at exactly `options.path` on the `HttpRouter`. The Fresh
middleware must NOT strip the prefix for WS (since there is no sub-path), or the
route registration inside Effect's HttpRouter won't match. This is different
from the HttpApi pattern where routes are under a prefix. Need to verify the
exact path matching behavior.

**Alternative approach for WS:** Use `RpcServer.toHttpEffectWebsocket(group)`
directly instead of `layerHttp`, which gives back an `httpEffect` that can be
mounted manually. This avoids the routing mismatch concern.

### RpcGroup Definition Pattern

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/rpc/Rpc.ts
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { Schema } from "effect";

// Streaming procedure: stream: true means successSchema becomes RpcSchema.Stream
const GetStream = Rpc.make("GetStream", {
  success: Schema.String,
  stream: true, // handler must return Stream<string, ...>
});

// Request/response procedure
const GetTodos = Rpc.make("GetTodos", {
  success: Schema.Array(TodoSchema),
});

const CreateTodo = Rpc.make("CreateTodo", {
  payload: { text: Schema.String },
  success: TodoSchema,
  error: TodoError, // typed error returned via Result branch
});

const TodoRpc = RpcGroup.make(GetTodos, CreateTodo, GetStream);
```

### Handler Implementation Pattern

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/rpc/RpcGroup.ts
const TodoHandlers = TodoRpc.toLayer({
  GetTodos: () =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.list();
    }),
  CreateTodo: ({ text }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.create(text);
    }),
  // Stream handler returns Stream<A, E, R>
  GetStream: () => Stream.fromIterable(["hello", "world"]),
});
// Result: Layer.Layer<Rpc.ToHandler<typeof TodoRpc>, never, TodoService>
```

### TypeScript Rejection of Invalid Calls (SC-3)

The `RpcClient.RpcClient<Rpcs>` type is keyed by the `_tag` of each `Rpc` in the
group. Accessing a procedure not in the group produces a TypeScript error:
`Property 'NonExistent' does not exist on type 'RpcClient<...>'`.

For SC-3, a test file with a deliberate invalid call (e.g.,
`client.NonExistent({})`) and `tsc --noEmit` verification is the correct
approach. The key is that `RpcClient.make` is typed via
`RpcClient.From<Rpcs, E>` which only has keys for declared procedure tags.

---

## Browser Island Hooks Design

The `AtomRpc.Service` pattern from `effect/unstable/reactivity/AtomRpc` is NOT a
fit for `useRpcResult`/`useRpcStream` because it targets atom-based reactive
queries, not one-shot Preact hooks. The hooks must be built from scratch using
`preact/hooks`.

### useRpcResult — Request/Response Hook

Design: Imperative trigger, returns `[result, call]` where `result` is a
loading/ok/err state. This fits the pattern better than a reactive query atom,
since RPC calls are user-triggered.

```typescript
// Source: pattern derived from existing useAtom + RpcClient API
import { useState, useCallback } from "preact/hooks"
import type { RpcGroup } from "effect/unstable/rpc"
import { RpcClient } from "effect/unstable/rpc"

type RpcResult<A, E> =
  | { readonly _tag: "idle" }
  | { readonly _tag: "loading" }
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "err"; readonly error: E }

function useRpcResult<Rpcs, Group extends RpcGroup.RpcGroup<Rpcs>>(
  group: Group,
  options: { url: string }
): RpcResult<...>
```

**Implementation approach:** Each call to a procedure creates a scoped Effect
runtime, runs `RpcClient.make(group)` with `layerProtocolHttp({ url })`, invokes
the procedure, maps success/failure to the `Result` type, and sets state. The
Effect runtime is disposed after each call (HTTP is stateless).

**Loading state:** Use `useState` for result state (idle/loading/ok/err). The
hook returns both the current state and a stable caller function.

**Cleanup:** On component unmount (`useEffect` cleanup), cancel in-flight
requests via `AbortController` or fiber interruption.

### useRpcStream — WebSocket Streaming Hook

Design: Starts a WS connection on mount, delivers push events reactively.
Returns the stream state: latest value (or array of values), error, and
connected status.

```typescript
type RpcStreamResult<A, E> =
  | { readonly _tag: "connecting" }
  | { readonly _tag: "connected"; readonly latest: A | null }
  | { readonly _tag: "error"; readonly error: E }
  | { readonly _tag: "closed" };
```

**Implementation approach:** On mount, create an Effect runtime with
`RpcClient.layerProtocolSocket()` + `BrowserSocket.layerWebSocket(url)` +
`RpcSerialization.layerNdjson`. Run `RpcClient.make(group)` to get a client,
then call the streaming procedure to get a `Stream<A, E>`. Run the stream via
`Stream.runForEach` in a fiber, calling `setState` on each chunk. On unmount,
interrupt the fiber.

**Key insight:** `BrowserSocket.layerWebSocket` from `@effect/platform-browser`
wraps `globalThis.WebSocket` (the browser native API). This is the canonical way
to get browser WebSocket support in Effect.

### Where Hooks Live

Both hooks go in `packages/effect/src/` as a new `island.ts` file (client-only).
The `mod.ts` does NOT export them (server-side safe). The example app imports
from `@fresh/effect/island` (requires adding an `island.ts` export to
`deno.json`).

```json
// packages/effect/deno.json exports
{
  ".": "./src/mod.ts",
  "./island": "./src/island.ts"
}
```

The `island.ts` file uses `preact/hooks` (client-only), same pattern as
`plugin-effect/src/island.ts` which is the existing atom hooks file.

---

## Don't Hand-Roll

| Problem                  | Don't Build             | Use Instead                                   | Why                                    |
| ------------------------ | ----------------------- | --------------------------------------------- | -------------------------------------- |
| RPC serialization        | Custom JSON codec       | `RpcSerialization.layerNdjson` or `layerJson` | Handles framing, streaming, msgpack    |
| WS protocol              | Raw WebSocket           | `BrowserSocket.layerWebSocket(url)`           | Handles reconnect, ping/pong, errors   |
| RPC message framing      | Custom framing protocol | NDJSON (`layerNdjson`) for WS                 | Effect handles multi-message frames    |
| In-process test client   | Fake HTTP + real HTTP   | `RpcTest.makeClient`                          | No serialization overhead, no HTTP     |
| Stream backpressure      | Manual queue            | `RpcClient.layerProtocolSocket`               | Built-in ack/backpressure support      |
| TypeScript type checking | Runtime type guards     | Schema-based `Rpc.make()` definitions         | TS rejects wrong calls at compile time |

**Key insight:** `RpcTest.makeClient` is the right tool for SC-1 automated
testing. It wires server and client in-process without HTTP. The FakeServer
pattern (httpapi_test.ts) works but adds unnecessary
serialization/deserialization overhead for unit tests.

---

## Common Pitfalls

### Pitfall 1: WS Path Routing Mismatch

**What goes wrong:** The `RpcServer.layerProtocolWebsocket(path)` registers a
GET route at exactly `path` on Effect's `HttpRouter`. When `app.rpc()` mounts a
Fresh route at `path + "/*"` and strips the prefix before forwarding, the WS
upgrade request arrives at `/` inside Effect's router, but the registered route
is `path`. Result: 404.

**Why it happens:** HTTP RPC uses sub-paths (POST to the path). WS uses the
exact path for the upgrade handshake. These have different routing semantics.

**How to avoid:** For WS, mount a Fresh route at exactly `path` (not
`path + "/*"`) and forward without stripping the prefix. Alternatively, use
`RpcServer.toHttpEffectWebsocket` to get the raw httpEffect and mount it
directly — this bypasses the internal path registration concern.

**Warning signs:** WS connection immediately closes with 404.

### Pitfall 2: Serialization Format Mismatch (Server vs Client)

**What goes wrong:** Server uses `layerNdjson` (framed), client uses `layerJson`
(single message). Parsing fails silently.

**Why it happens:** HTTP RPC can use `layerJson` (single request/response) but
WS needs `layerNdjson` (newline-delimited, supports streaming frames). Using
`layerHttp` with `protocol: "websocket"` internally defaults to framed. Client
must match.

**How to avoid:** Always use `layerNdjson` when the server uses WebSocket or
when `includesFraming` matters. For HTTP RPC, `layerJson` on both sides works.

**Warning signs:** Client gets empty responses or parse errors.

### Pitfall 3: ManagedRuntime Not Shared for RPC Handler Services

**What goes wrong:** RPC handler needs `TodoService` but `TodoService` is in the
main `AppLayer`. The RPC layer doesn't see it.

**Why it happens:** Same issue as httpApi Phase 8. `HttpRouter.toWebHandler`
creates its own runtime. The `memoMap` option allows sharing memoized service
instances, but the services must be explicitly composed into the handler layer.

**How to avoid:** Pre-compose: `Layer.provide(TodoHandlers, AppLayer)` before
passing to `app.rpc()`. This is identical to the Phase 8 `TodosWithDeps`
pattern.

**Warning signs:** `Service not found` errors at runtime in RPC handlers.

### Pitfall 4: Browser-Side Effect Runtime Lifecycle

**What goes wrong:** Creating a new Effect `ManagedRuntime` on every hook call
leaks resources. Streams never get cleaned up.

**Why it happens:** `RpcClient.make` is scoped (requires `Scope.Scope`). Running
it without proper scope management leaves WS connections open after unmount.

**How to avoid:**

- For `useRpcResult` (HTTP): Use `Effect.scoped` + `Effect.runPromise` for each
  call. HTTP is stateless, so a scoped effect per-call is fine.
- For `useRpcStream` (WS): Use a single `ManagedRuntime` per hook instance,
  created on mount and disposed on unmount via `useEffect` cleanup.

**Warning signs:** WS connections accumulate in browser devtools, memory grows.

### Pitfall 5: `RpcClient.Protocol` Not Provided

**What goes wrong:** `RpcClient.make` fails with "Service not found: Protocol".

**Why it happens:** `RpcClient.make` requires `RpcClient.Protocol` in context.
It is provided by `layerProtocolHttp` or `layerProtocolSocket`. Forgetting to
compose this layer is a common mistake.

**How to avoid:** Always wrap `RpcClient.make` with its protocol layer before
running. The `RpcClient.Protocol` service is always required.

**Warning signs:** TypeScript surface:
`Effect.Effect<..., never, Protocol | ...>` — the `Protocol` in the requirements
means the layer is missing.

---

## Code Examples

### Defining Procedures

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/rpc/Rpc.ts
import { Rpc, RpcGroup } from "effect/unstable/rpc";
import { Schema } from "effect";

const TodoSchema = Schema.Struct({ id: Schema.String, text: Schema.String });

// Request/response procedure
const ListTodos = Rpc.make("ListTodos", {
  success: Schema.Array(TodoSchema),
});

const CreateTodo = Rpc.make("CreateTodo", {
  payload: { text: Schema.String },
  success: TodoSchema,
  error: Schema.TaggedStruct("TodoError", { message: Schema.String }),
});

// Streaming procedure (server push)
const WatchTodos = Rpc.make("WatchTodos", {
  success: Schema.Array(TodoSchema),
  stream: true, // handler returns Stream<Todo[], never, ...>
});

const TodoRpc = RpcGroup.make(ListTodos, CreateTodo, WatchTodos);
```

### Implementing Handlers

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/rpc/RpcGroup.ts
const TodoHandlers = TodoRpc.toLayer({
  ListTodos: () =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.list();
    }),
  CreateTodo: ({ text }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.create(text);
    }),
  WatchTodos: () => broadcastStream, // Stream<Todo[], never, never>
});
// Returns: Layer.Layer<Rpc.ToHandler<typeof TodoRpc>, never, TodoService>
```

### Server Mount in EffectApp

```typescript
// Pattern: mirrors httpApi() in app.ts
// Source: platform-deno-smol/packages/effect/src/unstable/rpc/RpcServer.ts

// HTTP protocol (request/response)
app.rpc({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
  handlerLayer: Layer.provide(TodoHandlers, AppLayer),
});

// WebSocket protocol (streaming)
app.rpc({
  group: TodoRpc,
  path: "/rpc/todos/ws",
  protocol: "websocket",
  handlerLayer: Layer.provide(TodoHandlers, AppLayer),
});
```

### RpcServer.layerHttp Composition

```typescript
// Source: RpcServer.ts lines 735-758
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { HttpRouter, HttpServer } from "effect/unstable/http";

const rpcLayer = RpcServer.layerHttp({
  group: TodoRpc,
  path: "/rpc/todos",
  protocol: "http",
}).pipe(
  Layer.provide(TodoHandlers), // handler implementations
  Layer.provide(RpcSerialization.layerJson), // serialization
  Layer.provide(HttpServer.layerServices), // same infra as httpApi
);

const { handler, dispose } = HttpRouter.toWebHandler(rpcLayer, {
  memoMap: runtime.memoMap,
});
```

### Browser Hook: useRpcResult (HTTP)

```typescript
// Pattern: preact/hooks + RpcClient over HTTP fetch
// Source: RpcClient.ts layerProtocolHttp
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Effect } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import { FetchHttpClient } from "effect/unstable/http/FetchHttpClient";
import { HttpClient } from "effect/unstable/http";
import type { RpcGroup } from "effect/unstable/rpc";

type RpcResultState<A, E> =
  | { readonly _tag: "idle" }
  | { readonly _tag: "loading" }
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "err"; readonly error: E };

export function useRpcResult<Rpcs>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: { url: string },
) {
  // Returns [state, client] where client is type-safe per group
  // Each procedure call is a separate scoped Effect
}
```

### In-Process Test Client (RpcTest.makeClient)

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/rpc/RpcTest.ts
import { RpcTest } from "effect/unstable/rpc";
import { Effect } from "effect";

Deno.test("SC-1: RPC call returns typed response", async () => {
  const app = makeTestApp();
  // app.rpc() registers handlers

  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      const todos = yield* client.ListTodos({});
      assertEquals(todos, [{ id: "1", text: "Test" }]);
    }),
  ).pipe(
    Effect.provide(TodoHandlers), // same handler layer as server
    Effect.runPromise,
  );
  await app.dispose();
});
```

### WS Serialization: NDJSON is Required

```typescript
// Source: RpcSerialization.ts — ndjson has includesFraming: true
// WebSocket protocol requires framed serialization for streaming

// Server side: provide layerNdjson (not layerJson)
Layer.provide(RpcSerialization.layerNdjson);

// Client side: must match
Layer.provide(RpcSerialization.layerNdjson);
// Or use layerMsgPack on both sides for binary efficiency
```

---

## State of the Art

| Aspect             | Current Approach                                                      |
| ------------------ | --------------------------------------------------------------------- |
| RPC definition     | `Rpc.make("Tag", { payload, success, error, stream? })`               |
| Streaming          | `stream: true` flag on `Rpc.make` — handler returns `Stream<A, E, R>` |
| Server mount       | `RpcServer.layerHttp({ group, path, protocol })`                      |
| In-process testing | `RpcTest.makeClient(group)` — no HTTP needed                          |
| Browser WS         | `BrowserSocket.layerWebSocket(url)` from `@effect/platform-browser`   |
| Browser HTTP       | `FetchHttpClient.layer` from `effect/unstable/http/FetchHttpClient`   |

**Key finding:** The `RpcServer.layerHttp` API accepts
`protocol?: "http" | "websocket"` with `"websocket"` as the default. One call
handles both protocols — the protocol is determined by the option, not the path.

---

## Open Questions

1. **WS path routing for Fresh**
   - What we know: `layerProtocolWebsocket(path)` registers `GET path` on
     Effect's HttpRouter. The httpApi pattern strips path prefix before
     forwarding.
   - What's unclear: Does stripping the prefix break WS because the GET path
     becomes `/` but Effect registered it at `path`?
   - Recommendation: Test in the first plan task. If it breaks, use
     `RpcServer.toHttpEffectWebsocket(group)` which returns a raw `httpEffect`
     that can be mounted WITHOUT path registration inside Effect's HttpRouter.

2. **`@effect/platform-browser` version in freak**
   - What we know: The source is in platform-deno-smol at
     `packages/platform-browser`.
   - What's unclear: The exact npm version string to add to deno.json imports.
   - Recommendation: Check `packages/platform-browser/package.json` for the
     version, or use the same version as `effect` (they're in the same
     monorepo).

3. **`HttpServer.layerServices` needed for RPC?**
   - What we know: `httpApi()` adds `HttpServer.layerServices` to its composed
     layer.
   - What's unclear: Whether `RpcServer.layerHttp` already includes this
     internally.
   - Looking at RpcServer imports: it imports `HttpRouter` but NOT `HttpServer`.
     So `HttpServer.layerServices` likely still needs to be provided explicitly
     (same as httpApi pattern).
   - Recommendation: Include it. If it's already there, it's a no-op (service is
     idempotent).

4. **`useRpcStream` push model**
   - What we know: The user wants server-push broadcasting (all connected
     islands see todo updates).
   - What's unclear: The best internal design — a shared atom, direct state
     update, or an async iterator.
   - Recommendation (Claude's discretion): Use `useState` for the latest value,
     update via `Stream.runForEach` in a `useEffect` fiber. For broadcast, the
     server streams the full todo list on every change; the island just renders
     the latest value.

---

## Sources

### Primary (HIGH confidence)

- `platform-deno-smol/packages/effect/src/unstable/rpc/RpcServer.ts` — Full
  RpcServer API including `layerHttp`, `layerProtocolWebsocket`,
  `layerProtocolHttp`, `toHttpEffectWebsocket`
- `platform-deno-smol/packages/effect/src/unstable/rpc/RpcClient.ts` —
  `RpcClient.make`, `layerProtocolHttp`, `layerProtocolSocket`, `Protocol`
  service
- `platform-deno-smol/packages/effect/src/unstable/rpc/RpcGroup.ts` —
  `RpcGroup.make`, `toLayer`, `toHandlers`
- `platform-deno-smol/packages/effect/src/unstable/rpc/Rpc.ts` — `Rpc.make` with
  payload/success/error/stream options
- `platform-deno-smol/packages/effect/src/unstable/rpc/RpcSerialization.ts` —
  `layerJson`, `layerNdjson`, `layerMsgPack`
- `platform-deno-smol/packages/effect/src/unstable/rpc/RpcTest.ts` —
  `RpcTest.makeClient` in-process testing
- `platform-deno-smol/packages/effect/src/unstable/reactivity/AtomRpc.ts` —
  AtomRpc.Service (NOT used, but researched)
- `platform-deno-smol/packages/platform-browser/src/BrowserSocket.ts` —
  `layerWebSocket(url)` for browser WS
- `freak/packages/effect/src/app.ts` — `httpApi()` implementation (model for
  `rpc()`)
- `freak/packages/effect/tests/httpapi_test.ts` — FakeServer pattern, dispose
  lifecycle
- `freak/packages/plugin-effect/src/island.ts` — existing atom hook pattern for
  islands

### Secondary (MEDIUM confidence)

- `platform-deno-smol/packages/platform-browser/src/BrowserHttpClient.ts` —
  `layerFetch` for browser HTTP client (verified source exists, not deeply
  tested)

---

## Metadata

**Confidence breakdown:**

- Standard stack (server RpcServer APIs): HIGH — read source directly
- Architecture (mount pattern mirrors httpApi): HIGH — read both source files
- WS routing: MEDIUM — know the registration mechanism, interaction with Fresh
  routing not yet verified
- Browser hooks design: MEDIUM — pattern is clear from source, but exact
  implementation TBD
- Testing with RpcTest.makeClient: HIGH — source read, API clear

**Research date:** 2026-02-26 **Valid until:** 2026-03-28 (30 days — effect-smol
is beta but source is pinned to 4.0.0-beta.0)
