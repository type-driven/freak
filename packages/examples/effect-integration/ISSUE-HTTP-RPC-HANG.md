# Bug: HTTP RPC calls hang forever in browser (useRpcQuery / useRpcResult)

## Status

- **RESOLVED** — root cause: `Queue.collect` bug in `effect@4.0.0-beta.0` +
  `layerJson` double-wrapping

## Symptom

`useRpcQuery` and `useRpcResult` islands never display data. The network tab
shows no fetch requests to `/rpc/todos`.

Confirmed via `Effect.runPromiseExit` + 3 s race: the Promise never resolves or
rejects (genuine hang, not immediate error).

## What works

- `useRpcStream` (WebSocket) — works correctly in browser
- All four transport modes on the server side (curl-verified)
- 28 Deno integration/E2E tests all pass

## What doesn't work

Any call pattern that goes through `RpcClient.make` + an HTTP procedure:

```typescript
// Hangs (Promise never resolves):
Effect.runPromise(
  Effect.scoped(Effect.gen(function* () {
    const client = yield* RpcClient.make(TodoRpc);
    return yield* client.ListTodos(); // ← hangs here
  })).pipe(Effect.provide(protocolLayer)),
);
```

Both `Effect.runPromise(effect.pipe(Effect.provide(layer)))` and
`ManagedRuntime.make(layer).runPromise(effect)` exhibit the same hang.

## Key fact

`fetch` is **never called** — confirmed by monkey-patching `globalThis.fetch` in
the browser console. No network request is ever issued.

## Execution trace (theoretical — everything looks correct, yet hangs)

1. `Effect.runPromise` creates root fiber F0 with `defaultServices`.
2. `Effect.provide(protocolLayer)` builds the layer synchronously (all layers
   are sync):
   - `FetchHttpClient.layer` → captures `fetch_ = globalThis.fetch` (from F0 at
     build time)
   - `RpcSerialization.layerJson` → parsed serializer
   - `RpcClient.layerProtocolHttp` → via `withRun`, creates `Protocol` service
     with:
     - `send` = actual HTTP POST function (calls `client.post()` →
       `Effect.tryPromise` → `fetch_`)
     - `write` = initially a buffer function (queues response items)
     - `run(g)` = sets `write = g`, replays buffer, then `Effect.never`
3. `Effect.scoped(gen)` creates `innerScope`; gen runs.
4. `yield* RpcClient.make(TodoRpc)`:
   - Gets `Protocol` service → destructures `{ run, send }`
   - Forks run fiber via `forkScoped` (deferred: `setTimeout(0)`)
   - Returns client proxy
5. `yield* client.ListTodos()` → `onEffectRequest` →
   `Effect.callback(register)`:
   - `register(resumeF0)` runs **synchronously** inside F0's eval loop
   - Creates fiber B via `Effect.runForkWith(parentFiber.services)` — starts
     **immediately**
   - Fiber B runs `send_effect` synchronously until `Effect.tryPromise`
   - `callbackOptions[evaluate](fiberB)` calls `tryRegister(resumeB)`:
     - Should call `fetch(url, { method: "POST", ... })` here ← **never
       happens**
   - Fiber B suspends, `register` returns
   - F0 suspends (genuinely awaiting async callback)

Everything in the trace **should** work, but `fetch` is never called.

## Candidates for root cause

### A. Fiber B fails before reaching `Effect.tryPromise`

Something in `encodePayload` → `Effect.provideServices` → `send(encodedReq)` →
`makeProtocolHttpSend` → `client.post()` throws or returns a defect
synchronously. Fiber B then fires its observer (`exit._tag === "Failure"`) which
calls `resume(failureExit)`. But this should cause F0 to **fail**, not hang.
Unless the observer is somehow missed.

### B. `Effect.runForkWith` doesn't start fiber B immediately

Maybe in certain builds/environments, `runForkWith(services)(effect)` defers
fiber B via the scheduler. If fiber B and the run fiber (from `forkScoped`) are
both deferred, the relative ordering or interaction might cause a deadlock.

### C. `withRun` semaphore or buffer interaction

If `run(g)` is forkScoped and the semaphore becomes unavailable (e.g. already
held), the run fiber would hang at `withPermits(1)`. Then `write` is never set
to `handler`. Response items buffer, never get replayed. F0 waits forever.

This can't be a direct cause on first call (fresh semaphore, 1 permit), but
might matter on re-runs if scopes are shared.

### D. `Effect.timeout(5000)` interaction

The current `useRpcQuery` wraps the call with
`Effect.timeout(5000).pipe(Effect.option)`. If the timer fiber itself is
blocked, the whole thing could hang. But the 5 s timeout SHOULD beat the hung
network call.

### E. `keepAlive.setInterval` conflict

`Effect.callback` increments `keepAlive` (starts a `setInterval`) before
yielding. Two callbacks are in flight (F0 and fiber B). This shouldn't block
`setTimeout(0)` for the run fiber but is worth checking.

## Debugging plan for next session

### Step 1 — Confirm fetch is never called

```javascript
const orig = globalThis.fetch;
let calls = [];
globalThis.fetch = (...a) => {
  calls.push(a[0]?.toString?.());
  return orig(...a);
};
// ... run the effect for 3 s ...
console.log("fetch calls:", calls); // should be non-empty
globalThis.fetch = orig;
```

### Step 2 — Confirm fiber B starts and runs

Add `console.log` inside the `Effect.callback(register => { ... })` in
`onEffectRequest`:

```typescript
// Temporary patch in island.ts makeRpcEffect:
const effect = Effect.scoped(Effect.gen(function* () {
  console.log("[A] before RpcClient.make");
  const client = yield* RpcClient.make(group as any);
  console.log("[B] got client");
  const result = yield* (client as any)[procedure](payload);
  console.log("[C] got result:", result);
  return result;
})).pipe(Effect.provide(protocolLayer));
```

Observe which logs appear. If `[B]` logs but `[C]` never appears → hang is
inside the RPC call.

### Step 3 — Test if `forkScoped` run fiber fires

```typescript
Effect.scoped(Effect.gen(function* () {
  console.log("[X] before forkScoped");
  yield* Effect.sync(() => console.log("[Y] sync after fork")).pipe(
    Effect.forkScoped,
  );
  yield* Effect.sleep(100); // give fork time to fire
  console.log("[Z] after sleep");
}));
```

If `[Y]` never logs → `forkScoped` fibers don't fire in this context.

### Step 4 — Bypass RpcClient, call Protocol.send directly

```typescript
Effect.scoped(Effect.gen(function* () {
  const svc = yield* Protocol.Protocol;
  console.log("[P] got Protocol:", Object.keys(svc));
  const result = yield* svc.send({
    _tag: "Request",
    id: "1",
    tag: "ListTodos",
    payload: undefined,
    headers: [],
  });
  console.log("[Q] send done:", result);
})).pipe(Effect.provide(protocolLayer));
```

If `[Q]` doesn't log → the Protocol.send Effect hangs.

### Step 5 — Test `Effect.tryPromise` standalone

```typescript
Effect.runPromise(
  Effect.tryPromise({
    try: () =>
      fetch("/rpc/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          _tag: "Request",
          id: "1",
          tag: "ListTodos",
          payload: null,
          headers: [],
        }),
      }),
    catch: (e) => e,
  }),
).then(
  (r) => console.log("fetch worked:", r.status),
  (e) => console.log("fetch failed:", e),
);
```

If this hangs → `Effect.tryPromise` itself is broken in the browser. If this
works → the issue is upstream (layers / RpcClient).

## Root Cause (found)

### Queue.collect double-push bug in effect@4.0.0-beta.0

`Queue.collect` (Queue.ts lines 1115–1119) has a bug in its `step` function:

```typescript
step(items: Arr.NonEmptyArray<A>) {
  out.push(...items)           // pushes all items
  for (let i = 0; i < items.length; i++) {
    out.push(items[i])         // BUG: pushes each item again
  }
}
```

`RpcServer.layerHttp` with `RpcSerialization.layerJson` uses `Queue.collect`
(non-framed path, `includesFraming = false`). For a single-response RPC call
this produces `[Exit, Exit]` instead of `[Exit]`.

The client's `layerJson.decode` wraps the entire parsed JSON in an outer array:

```typescript
decode: ((bytes) => [JSON.parse(bytes)]);
// Server sends "[{Exit},{Exit}]" (JSON array)
// decode returns [[{Exit},{Exit}]]  ← double-wrapped
```

In `makeProtocolHttp`: `u = [[{Exit},{Exit}]]`, so `writeResponse(u[0])` is
called with `[{Exit},{Exit}]` (an array, not an Exit object). The run handler's
switch on `message._tag` falls to `default: Effect.void`. `entry.resume` is
never called. F0 (the caller fiber) hangs forever.

`useRpcStream` (WebSocket) was unaffected because it uses the Socket protocol,
not `Queue.collect`.

**Note**: "fetch is never called" in the original report was incorrect —
confirmed via Deno test that fetch IS called and the server responds 200. The
hang is in response processing.

## Fix

Switch `RpcSerialization.layerJson` → `RpcSerialization.layerNdjson` on both
server and client.

`layerNdjson` sets `includesFraming = true`, causing the server to use the
streaming path (`Queue.takeAll` + NDJSON framing) instead of `Queue.collect`.
The client uses the framed reader path. No doubling occurs.

Changes applied:

- `packages/fresh/src/effect/app.ts` — server, `protocol: "http"` handler
- `packages/fresh/src/effect/island.ts` `makeRpcHttpLayer` — client layer builder
- `packages/examples/effect-integration/islands/QueryMutationDemo.tsx`
  `makeRpcEffect` — demo island

## Files involved

- `packages/fresh/src/effect/island.ts` — `useQuery`, `useMutation`, `useRpcQuery`,
  `useRpcResult`
- `packages/examples/effect-integration/islands/QueryMutationDemo.tsx` — demo
  island
- `packages/examples/effect-integration/routes/query-demo.tsx` — demo route
