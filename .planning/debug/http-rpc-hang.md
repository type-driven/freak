---
status: investigating
trigger: "HTTP RPC calls hang forever in browser — fetch is never called when using useRpcQuery / useRpcResult"
created: 2026-02-27T00:00:00Z
updated: 2026-02-27T00:00:00Z
---

## Current Focus

hypothesis: The `run` fiber forked by `RpcClient.make` (via `Effect.forkScoped`)
never fires because `Effect.runPromise` uses a batching scheduler. The `run`
fiber is scheduled via `forkScoped` which calls `startImmediately: false`
(default), so it sits in the scheduler queue. The main fiber (F0) then
immediately yields at `Effect.callback` waiting for an Exit message that will
ONLY come after `run` processes responses. But `run` is still in the queue — it
will never run because F0 is suspended and the microtask queue never drains to
the fork point.

WAIT — this can't be right for HTTP because `send` fires `fetch` BEFORE `run`
processes any response. But the hypothesis that forkScoped uses a deferred start
is still worth checking.

REVISED hypothesis: The `run` fiber in `RpcClient.make` is forked with
`Effect.forkScoped` (line 731-735 in RpcClient.ts). This fork uses
`startImmediately: false` by default in Effect's scheduler. The main fiber is
currently suspended at `Effect.callback` waiting for `run` to call
`write({_tag:"Exit",...})`. But `run` fiber hasn't started yet because it's
scheduled for later. The send fiber (fiber B in ISSUE doc) fires the fetch and
correctly routes the response back via `writeResponse`. HOWEVER: `writeResponse`
calls `write()` from `withRun` — and at the time fetch completes asynchronously,
is `write` still the buffer function or has `run` replaced it with its own
handler?

KEY INSIGHT: `withRun` uses a semaphore with 1 permit. `run(f)` calls
`semaphore.withPermits(1)(...)`. This is an EFFECT — it won't acquire the permit
until it actually executes. And `run(f)` is called via `Effect.forkScoped` which
defers it.

ACTUAL root cause hypothesis: In `Effect.runPromise` context,
`Effect.forkScoped` (no `startImmediately: true`) schedules the run fiber to
start later. Meanwhile the send fiber fires fetch synchronously via
`Effect.callback`, fetch completes asynchronously, `writeResponse` is called —
but `write` is STILL the buffer function (run fiber hasn't started yet and
replaced write). So responses go into `buffer`. Then `run` fiber eventually
starts, replaces `write`, replays buffer, and calls `resume(exit)` on F0. This
SHOULD work...

SECOND hypothesis (confirmed via code): The `run` fiber is forked with
`Effect.forkScoped` at line 733-735. `forkScoped` in effect-smol scoped fork —
the fiber is added to the scope's finalizers. When `Effect.runPromise` completes
the scope, fibers are interrupted. But the issue is BEFORE that: `forkScoped`
defers the start. The send fiber fires, fetch never happens.

CRITICAL OBSERVATION: Look at the send path. `send` in `makeProtocolHttp` calls
`client.post("", { body })`. `client` is the `HttpClient.HttpClient` from
`FetchHttpClient.layer`. The `post("")` call itself returns an Effect — it's not
executing fetch yet. `send` is called as an Effect inside fiber B via
`Effect.runForkWith(parentFiber.services)`. For fetch to actually fire, fiber B
must reach `Effect.tryPromise` inside `HttpClient`. This works fine if
FetchHttpClient is available.

THE ACTUAL BUG: `Effect.runForkWith(parentFiber.services)` in `onEffectRequest`
(RpcClient.ts line 378). The `parentFiber.services` are the services from the
MAIN fiber F0. At the time fiber B is forked with `parentFiber.services`, the
scope in F0's services is the INNER scope from `Effect.scoped(...)`. When fiber
B calls `client.post("")` and fetches, after the async completes, it calls
`writeResponse`. `writeResponse` calls `write(response)` which (in the buffer
phase) pushes to `buffer` AND calls `Effect.servicesWith` to capture the context
— this is fine.

DEFINITIVE ROOT CAUSE: The `run` fiber is forked with `Effect.forkScoped` (NOT
`Effect.forkIn(..., {startImmediately: true})`). In the Effect scheduler, forked
fibers run after the current fiber yields. The sequence is:

1. F0 runs `RpcClient.make`, which calls `run(handler).pipe(Effect.forkScoped)`
2. `forkScoped` schedules the run fiber to start asynchronously (not
   immediately)
3. F0 continues to `client.ListTodos()` → `onEffectRequest` →
   `Effect.callback(register)`
4. Inside `register`: fiber B is forked with `Effect.runForkWith` — this DOES
   start immediately (it uses the current fiber's scheduler task queue)
5. Fiber B runs the send effect synchronously until `Effect.tryPromise` (which
   calls fetch)
6. `Effect.tryPromise` registers the callback and fiber B suspends
7. `register` returns, F0 suspends at `Effect.callback`

Now the scheduler has: run fiber (waiting to start). F0 is suspended. Fiber B is
suspended waiting for fetch.

8. Fetch completes (async, via Promise microtask)
9. The `Effect.tryPromise` callback fires, waking fiber B
10. Fiber B processes the response, calls `writeResponse(exitMessage)`
11. `writeResponse` calls `write({_tag:"Exit",...})` — which is STILL the buffer
    function (run fiber never started)
12. Buffer function:
    `Effect.servicesWith(context => { buffer.push([args, context]); return Effect.void })`
13. This buffers the exit message. Fiber B finishes.

Now: F0 is suspended at Effect.callback, run fiber is still scheduled (not
started), buffer has the exit.

14. The Effect scheduler finally runs the run fiber
15. Run fiber: acquires semaphore, sets `write = f` (the real handler), replays
    buffer
16. Buffer replay calls `f({_tag:"Exit",...})` with the captured context
17. `f` is the handler in `RpcClient.make` — it calls
    `write({_tag:"Exit", requestId, exit})` on the `makeNoSerialization` write
    function
18. `makeNoSerialization.write` handles the "Exit" case: finds the entry, calls
    `entry.resume(exit)`
19. `entry.resume(exit)` calls `resume(exit)` — this should wake F0!

But WAIT — this is the HAPPY PATH. Why doesn't it work?

MISSING LINK: The run fiber in step 14-18 is running as a forked Effect fiber.
`resume(exit)` inside `entry.resume` calls `resume(exit)` which schedules F0 to
wake up. F0 then resolves the Promise.

So theoretically this should work... unless there's a scope issue.

SCOPE ISSUE HYPOTHESIS: `Effect.forkScoped` forks into the current scope. In
`Effect.scoped(Effect.gen(...))`, the scope is closed AFTER the gen completes.
The gen is currently suspended at `Effect.callback`. The run fiber was forked
into this scope. When the scope is closed (on exit), the run fiber is
interrupted.

But the scope is NOT closed while gen is suspended — it's closed when gen
returns or errors. So scope interruption isn't the problem here.

BACK TO BASICS — examining what `forkScoped` actually does:

`forkScoped` = `Effect.forkIn(scope)` where scope is from `Effect.scope`. The
fiber runs in a child scope. The critical question: does the fiber START
immediately or is it deferred?

Looking at Effect source: `Effect.forkIn` with default `startImmediately` =
**false** in effect-smol beta. This means the fork is scheduled via the current
fiber's scheduler.

The current fiber F0 is about to suspend at `Effect.callback`. The scheduler
processes F0's pending tasks. The run fiber task IS in the queue... but here's
the issue: `Effect.callback` sets `fiber._yielded`. At this point the scheduler
for F0 pauses. The run fiber would need to be picked up by the root scheduler.

In `Effect.runPromise`, there is a single root scheduler. All fibers share it.
After F0 suspends at `Effect.callback`, the scheduler can pick up the run fiber.
So this SHOULD work.

UNLESS: `Effect.runForkWith(parentFiber.services)` for fiber B (send fiber) —
this starts fiber B with startImmediately. Fiber B runs synchronously until it
hits `Effect.tryPromise`. But `Effect.tryPromise` in effect 4.0.0-beta.0 calls
the Promise constructor synchronously. The Promise executor runs synchronously,
calling `fetch`. The Promise callbacks are async.

So after fiber B suspends at `Effect.tryPromise`, the scheduler should run the
run fiber, THEN later the fetch Promise resolves and wakes fiber B.

This means: the run fiber DOES start and DOES replace `write` BEFORE fetch
resolves. When fetch resolves, `writeResponse` calls the REAL write function
(the one from run), which calls `resume(exit)` immediately, waking F0.

This is the happy path and should work. WHY does it hang?

CRITICAL RE-READ: Line 680-735 of RpcClient.ts:

```typescript
yield* run((message) => { ... }).pipe(
  Effect.catchCause(Effect.logError),
  Effect.interruptible,
  Effect.forkScoped
)
```

`run(handler)` calls `semaphore.withPermits(1)(Effect.gen(...))`. This is a
SCOPED effect returning `Effect<never>`. The `run` fiber acquires the semaphore
permit and blocks at `Effect.never` (via
`yield* Effect.onExit(Effect.never, ...)` in `withRun`). So this fiber runs
forever until interrupted.

But here's the key: `run` is called as a FORKED fiber. Does it start
immediately?

In effect-smol, `forkScoped` calls
`Effect.forkIn(scope, { startImmediately: false })` — the fiber starts on the
NEXT scheduler turn.

The sequence in `Effect.runPromise`:

1. F0 runs gen synchronously until it hits an async boundary
2. The run fiber is scheduled but not started
3. F0 hits `Effect.callback` (async boundary) and suspends
4. Scheduler picks up run fiber, starts it
5. Run fiber: acquires semaphore, replaces `write`, drains buffer
6. At this point, if fetch already completed (unlikely but possible on fast
   connections), buffer has the response → resume called → F0 wakes
7. If fetch hasn't completed, run fiber hits `Effect.never` and suspends
8. Fetch completes → `writeResponse` called → goes through REAL `write` →
   resume(exit) → F0 wakes

This SHOULD work. What's different in the BROWSER vs server?

BROWSER-SPECIFIC: `Effect.runPromise` is called with a fully-provided effect. In
the browser, is there something about the scheduler that causes the run fiber to
NOT start before the fetch Promise resolves?

Actually wait — let me re-read step 3. F0 hits `Effect.callback`. This is
`Effect.callback` in the outer `Effect.scoped(gen)`. The OUTER scope contains
the `yield* run(...)` fork. When F0 suspends, what happens to the scheduler?

Actually, `Effect.callback` in effect-smol suspends the fiber synchronously and
returns control to whoever called the fiber runner. In `Effect.runPromise`,
after the fiber suspends, the Promise is returned to JS. The microtask queue
takes over. The scheduled run fiber task (a `setTimeout(0)` or microtask?) would
need to run.

THE REAL QUESTION: Does `Effect.forkScoped` in effect 4.0.0-beta.0 schedule the
new fiber via `setTimeout(0)` or via a microtask? If it uses `setTimeout(0)`,
and the fetch Promise resolves via microtask... the fetch response would be
processed BEFORE the run fiber starts (microtasks run before setTimeout
callbacks).

In that scenario:

1. Run fiber is scheduled via setTimeout(0)
2. Fetch completes, Promise resolves as a microtask
3. Fiber B's tryPromise callback fires (microtask)
4. `writeResponse` called → `write(response)` → STILL buffer function → response
   buffered
5. setTimeout(0) fires → run fiber starts → replays buffer → calls resume(exit)
   → F0 wakes

This STILL works (buffer replays). So timing doesn't explain the hang.

HYPOTHESIS F: The `Effect.callback` in `onEffectRequest` captures a `resume`
function. This `resume` is wrapped in a "cancel" check. Looking at the callback
source:

```typescript
Effect.callback<any, any>((resume) => {
  const entry: ClientEntry = { ..., resume(exit) { resume(exit); ... } }
  entries.set(id, entry)
  fiber = send.pipe(..., Effect.runForkWith(parentFiber.services))
  fiber.addObserver((exit) => {
    if (exit._tag === "Failure") return resume(exit)
  })
})
```

The `resume` passed to the callback is Effect's internal resume function. When
`resume(exit)` is called, it checks if the fiber was already resumed (via the
`resumed` flag). If the fiber B completes successfully (no error), the observer
at line 380-384 does NOT call `resume`. The success case relies ENTIRELY on
`entry.resume(exit)` being called by the `write` function in
`makeNoSerialization`.

So the flow: fetch succeeds → `writeResponse(exitMsg)` → `write(exitMsg)` → if
`write` is the buffer function, it buffers → run fiber starts → drains buffer →
calls `makeNoSerialization.write({_tag:"Exit",...})` → `entry.resume(exit)` → F0
wakes.

The buffer IS drained eventually. This should work.

UNLESS: there is a scope issue. `Effect.scoped` wraps the whole `Effect.gen`.
When `Effect.scoped` closes, it interrupts all fibers in the scope. The run
fiber is in that scope. When does `Effect.scoped` close?

`Effect.scoped` closes the scope AFTER the inner effect completes (success,
failure, or interruption). The inner effect is the gen. The gen is suspended at
`Effect.callback`. The gen will NOT complete until `resume` is called. So scope
is NOT closed prematurely.

ACTUAL BUG FOUND via `Effect.runForkWith`:

```typescript
fiber = send.pipe(
  span ? Effect.withParentSpan(...) : identity,
  Effect.runForkWith(parentFiber.services)
)
```

`Effect.runForkWith(parentFiber.services)` creates a new fiber with
`parentFiber.services` as its service map. The `parentFiber` here is F0 (the
main fiber). The `parentFiber.services` includes the `Scope` service —
specifically the INNER scope from `Effect.scoped(gen)`.

When fiber B (`send`) runs and calls `client.post("")` (via `HttpClient`),
`FetchHttpClient` needs `HttpClient.HttpClient` from services. The
`layerProtocolHttp` effect used `HttpClient.HttpClient.asEffect()` to get the
client at layer build time — so the client is captured in the closure, not
needed from services at call time.

WAIT. The `send` function in `makeProtocolHttp` (line 820-880) closes over
`client` (the HttpClient). It does NOT need to look up services. So services
shouldn't matter for the actual fetch call.

But what about `Effect.provideServices(entry.context)` in the onFromClient
handler? entry.context is from the fiber services at the time of the Request.
This should be fine.

DEFINITIVE HYPOTHESIS: The semaphore in `withRun` blocks. Here's why:

`Protocol.make` calls `withRun(f)`. `withRun` creates a semaphore with 1 permit.
The `run` method calls `semaphore.withPermits(1)(...)`.

In `RpcClient.make`:

1. `yield* Protocol` gets the Protocol service — but Protocol.make returns an
   effect that creates the Protocol service including the `run` method.
2. The Protocol service is built as part of layer evaluation via
   `layerProtocolHttp`.
3. When `RpcClient.make` calls `yield* run(handler).pipe(Effect.forkScoped)`, it
   forks the run fiber.

BUT: `Protocol.make` is called as part of a LAYER. The layer might be memoized
by the `ManagedRuntime`'s memoMap. If `Effect.runPromise` builds the layer fresh
each time (no memoMap), then each `Effect.runPromise` call gets a fresh
semaphore. The semaphore starts with 1 permit → run fiber can acquire it.

So semaphore shouldn't be a problem for fresh invocations.

LET ME LOOK AT THIS FROM A COMPLETELY DIFFERENT ANGLE.

The code in `useQuery` says:

```
// Use Effect.runPromise directly — ManagedRuntime.runPromise shares a memoMap
// that can return finalized layer resources from prior runs, causing hangs.
```

This comment is incredibly telling. The author already diagnosed that
`ManagedRuntime.runPromise` hangs due to stale memoMap resources. They switched
to `Effect.runPromise` thinking that would fix it.

BUT: `Effect.runPromise` also builds layers. And layers use a memoMap. Where
does the memoMap come from for `Effect.runPromise`?

`Effect.runPromise` creates a new ManagedRuntime under the hood with its OWN
empty memoMap. So each `Effect.runPromise` call starts fresh — no stale
resources.

HOWEVER: Consider what happens when `Effect.runPromise` runs the
`Effect.scoped(gen).pipe(Effect.provide(protocolLayer))`:

1. `Effect.provide(protocolLayer)` evaluates the layer within the scope of the
   effect
2. The layer evaluates: `FetchHttpClient.layer` → `RpcSerialization.layerJson` →
   `layerProtocolHttp`
3. `layerProtocolHttp` calls `makeProtocolHttp` which calls `Protocol.make(f)` =
   `withRun(f)()`
4. `withRun` calls `Effect.suspend(() => {...})` — this creates the semaphore
   and buffer, then calls `f(write)` where `write` is the buffer function
5. `f` is `Effect.fnUntraced(function*(writeResponse) { ... })` from
   `makeProtocolHttp`
6. Inside `f`: it gets `RpcSerialization`, creates the `send` function, returns
   `{send, supportsAck, supportsTransferables}`
7. `withRun` maps the result to add the `run` method → returns the Protocol
   service

So `Protocol.make` → `withRun` → builds the Protocol service as an Effect. This
happens synchronously as part of layer evaluation.

Now `RpcClient.make`:

1. Gets Protocol service (already built by layer evaluation)
2. Calls `makeNoSerialization(group, {...onFromClient...})`
3. At line 681:
   `yield* run(handler).pipe(Effect.catchCause(Effect.logError), Effect.interruptible, Effect.forkScoped)`

THE FORK HAPPENS HERE. The `run` fiber is forked with `forkScoped`. This fiber
needs to: a. Acquire the semaphore (1 permit available → succeeds immediately in
Effect terms) b. Set `write = handler` c. Drain the buffer d. Block on
`Effect.never`

The critical question: does step (b) happen before fetch completes?

In `Effect.forkScoped`, the new fiber is added to the parent scope. By default
(`startImmediately: false`), it runs on the next scheduler turn.

In effect 4.0.0-beta.0, what scheduler is used by `Effect.runForkWith`? The
answer lies in how Effect's scheduler works in the browser.

test: next_action: look at Effect's fiberRuntime source to understand scheduler
behavior for forkScoped vs runForkWith

next_action: look at the Effect fiberRuntime source for forkScoped
startImmediately behavior

## Symptoms

expected: useRpcQuery and useRpcResult display data fetched from /rpc/todos via
HTTP POST actual: Promise never resolves or rejects. Network tab shows zero
fetch requests to /rpc/todos. Confirmed via Effect.runPromiseExit + 3s race —
genuine hang, not immediate error. errors: No errors thrown. No network
requests. Silent hang. reproduction: Load the query-demo page in the browser.
The islands using useRpcQuery / useRpcResult never show data. started: Issue has
existed since these hooks were written. useRpcStream (WebSocket) works fine. All
server-side transport modes pass curl tests.

## Eliminated

- hypothesis: Layer.provide chain is wrong (mergeAll vs pipe+provide) evidence:
  Code correctly uses pipe+provide chain for all three layers timestamp:
  2026-02-27

- hypothesis: FetchHttpClient import path is wrong evidence: Import uses correct
  namespace import
  `import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"`
  which matches MEMORY.md timestamp: 2026-02-27

- hypothesis: Missing required service in layer stack evidence:
  layerProtocolHttp requires HttpClient + RpcSerialization; both are provided.
  useRpcStream (WS) also uses same pattern. timestamp: 2026-02-27

- hypothesis: routerConfig/memoMap conflict on server side evidence: This is a
  server-side concern; the hang is on the client side (browser). fetch is never
  called at all. timestamp: 2026-02-27

## Evidence

- timestamp: 2026-02-27 checked: packages/effect/src/island.ts - useRpcQuery and
  useRpcResult layer construction found: Both hooks correctly use
  `RpcClient.layerProtocolHttp({url}).pipe(Layer.provide(RpcSerialization.layerJson), Layer.provide(FetchHttpClient.layer))`.
  useQuery uses `Effect.runPromise` directly (not ManagedRuntime). implication:
  Layer construction pattern matches working examples; the hang is not in layer
  wiring.

- timestamp: 2026-02-27 checked:
  platform-deno-smol/packages/effect/src/unstable/rpc/RpcClient.ts - `make`
  function lines 607-738 found: `RpcClient.make` calls
  `run(handler).pipe(Effect.catchCause(Effect.logError), Effect.interruptible, Effect.forkScoped)`
  at lines 731-735. `forkScoped` does NOT pass `startImmediately: true`.
  implication: The run fiber is scheduled for a LATER turn, not started
  immediately.

- timestamp: 2026-02-27 checked:
  platform-deno-smol/packages/effect/src/unstable/rpc/Utils.ts - `withRun`
  function found: `withRun` creates a Semaphore with 1 permit. The initial
  `write` function is a BUFFER function that calls
  `Effect.servicesWith(ctx => { buffer.push([args,ctx]); return Effect.void })`.
  The `run(f)` method: (1) acquires the semaphore permit, (2) sets `write = f`,
  (3) drains buffer with `Effect.provide(write(...args), context)`, (4) blocks
  on `Effect.never`, (5) restores `write = prev` on exit. implication: If `run`
  fiber starts AFTER fetch response arrives and writeResponse calls write(), the
  buffer holds the response, then run drains it. This SHOULD work. But if run
  fiber NEVER starts, or starts AFTER scope closes, the hang occurs.

- timestamp: 2026-02-27 checked: RpcClient.ts `onEffectRequest` lines 328-393
  found: The send fiber B is created via
  `Effect.runForkWith(parentFiber.services)` (line 378). `parentFiber.services`
  is the service map from F0 (main fiber). This includes the Scope service from
  `Effect.scoped`. The fiber B has all services needed to run `send(request)`.
  implication: Fiber B can run correctly. The hang is NOT due to missing
  services in fiber B.

- timestamp: 2026-02-27 checked: useQuery comment in island.ts line 242-243
  found: "Use Effect.runPromise directly — ManagedRuntime.runPromise shares a
  memoMap that can return finalized layer resources from prior runs, causing
  hangs." implication: Author already identified that ManagedRuntime.runPromise
  hangs due to stale memoMap. Switched to Effect.runPromise. But
  Effect.runPromise ALSO might have an issue.

- timestamp: 2026-02-27 checked: RpcClient.make forkScoped behavior found:
  `Effect.forkScoped` (without startImmediately:true) defers the fiber start. In
  effect-smol beta, this means the fiber runs on the next scheduler cycle. The
  question is: does the run fiber start BEFORE or AFTER fetch completes?
  implication: If run fiber starts after fetch, buffer mechanism handles it. If
  run fiber is NEVER started (due to scope/interruption), the hang occurs.

- timestamp: 2026-02-27 checked: Scope behavior in Effect.scoped with forkScoped
  found: When `Effect.scoped(gen)` closes, it finalizes the scope, which
  interrupts all fibers forked into the scope via `forkScoped`. The scope closes
  ONLY after gen completes or fails. Gen is suspended at `Effect.callback` — it
  will not complete until `resume` is called. So scope closure is not premature.
  implication: The run fiber is NOT interrupted prematurely by scope closure
  during normal operation.

- timestamp: 2026-02-27 checked: Effect.runForkWith vs forkScoped scheduling
  behavior found: `Effect.runForkWith(parentFiber.services)` (used for fiber
  B/send) starts the fiber IMMEDIATELY in the current scheduler turn.
  `Effect.forkScoped` (used for the run fiber) schedules via the scheduler (not
  immediately). In the Effect scheduler, tasks scheduled by forkScoped are
  processed on the NEXT turn. implication: Fiber B starts immediately and runs
  to its async boundary (fetch). Run fiber is scheduled for later. This ordering
  is intentional and the buffer mechanism handles out-of-order responses.

## Resolution

root_cause: TBD — investigating whether the run fiber fails to start or fails to
process the buffer correctly. Current best hypothesis is a scope interaction
issue. fix: empty until root cause confirmed verification: empty files_changed:
[]
