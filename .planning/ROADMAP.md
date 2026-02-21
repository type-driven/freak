# Roadmap: Fresh + Effect v4 Integration

## Overview

Five phases deliver native Effect v4 support in Fresh 2, progressing from the
type-safe handler detection foundation through plugin/runtime wiring, Preact atom
hooks, server-to-client atom hydration, and finally a working end-to-end example
that validates the full stack. Each phase is gated on the one before it; nothing
ships until the example runs clean.

## Milestone: v1

Native Effect v4 integration in Fresh — Effect-returning handlers, Preact atom
hooks, server-to-client hydration — working end-to-end and demonstrated in
`packages/examples/`.

## Phases

- [x] **Phase 1: Foundation** — Effect detection, plugin runtime, error dispatch
- [x] **Phase 2: Type-Safe API** — `createEffectDefine()` typed wrapper
- [x] **Phase 3: Preact Atom Hooks** — Native `useAtom` / `useAtomValue` / `useAtomSet`
- [ ] **Phase 4: Atom Hydration** — Server-to-client atom serialization
- [ ] **Phase 5: Example** — End-to-end demonstration in `packages/examples/`

## Phase Details

### Phase 1: Foundation

**Goal**: A route handler can return an Effect value and Fresh will run it through
a configured ManagedRuntime with typed error dispatch — without Effect types
appearing in `@fresh/core`'s public API.

**Depends on**: Nothing (first phase)

**Requirements**: HAND-01, HAND-02, HAND-03, HAND-05, PLUG-01, PLUG-02, PLUG-03, PLUG-04

**Success Criteria** (what must be TRUE):
1. A route handler returning `Effect<Response | PageResponse<Data>, E>` produces
   the same HTTP response as an equivalent async handler — verified by running the
   Fresh dev server and hitting the route.
2. `deno publish --dry-run` on `@fresh/core` succeeds — no Effect type imports
   leak into the public API surface.
3. An unhandled Effect failure renders the existing Fresh error page rather than
   crashing the Deno process.
4. `effectPlugin()` with no arguments works (zero-config); `effectPlugin({ layer })`
   works with a user-supplied Layer — both paths verified by running the example
   server and observing requests succeed.

**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — EffectLike structural type + setEffectResolver() hook in Fresh core
- [x] 01-02-PLAN.md — effectPlugin() package: ManagedRuntime lifecycle, middleware, resolver wiring
- [x] 01-03-PLAN.md — Error dispatch refinement + resolver/plugin test suite

---

### Phase 2: Type-Safe API

**Goal**: Developers can define Effect-returning route handlers with full TypeScript
inference over their Layer's service requirements via `createEffectDefine()`.

**Depends on**: Phase 1 (handler dispatch must work before type wrapper is useful)

**Requirements**: HAND-04

**Success Criteria** (what must be TRUE):
1. `createEffectDefine<State, R>()` compiles without error and the `R` type parameter
   threads through to the handler's Effect return type — verified by `expect-type`
   assertions in the test suite.
2. An `Effect` handler written with `createEffectDefine` that accidentally uses a
   service not provided by the configured Layer produces a TypeScript compile error
   at the handler definition site.

**Plans**: 1 plan

Plans:
- [x] 02-01-PLAN.md — createEffectDefine<State, R>() implementation + EffectHandlerFn types + expect-type and runtime tests

---

### Phase 3: Preact Atom Hooks

**Goal**: Preact islands can subscribe to and update Effect v4 atoms using native
`useAtom`, `useAtomValue`, and `useAtomSet` hooks — no `preact/compat` required.

**Depends on**: Phase 1 (Effect runtime must exist; Phase 2 is independent and can
run in parallel with Phase 3 after Phase 1 completes)

**Requirements**: ATOM-01, ATOM-02, ATOM-03

**Success Criteria** (what must be TRUE):
1. A Preact island that calls `useAtom(atom)` renders the current atom value and
   re-renders when the atom is updated — observable in a browser with devtools open.
2. `useAtomValue` and `useAtomSet` work independently: value-only and setter-only
   consumers do not trigger unnecessary re-renders when only the other side updates.
3. No `react` or `preact/compat` import appears anywhere in `plugin-effect/src/island.ts`
   — verified by `deno info` dependency graph output.

**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md — Verify v4 Atom API surface, implement useAtom/useAtomValue/useAtomSet in island.ts, export and type tests

---

### Phase 4: Atom Hydration

**Goal**: An atom value set server-side inside an Effect handler is serialized into
the island's initial props and available synchronously when the island boots on
the client — no loading flash.

**Depends on**: Phase 3 (atom hooks must be stable before layering serialization on
top; also requires verifying v4 atom pre-seeding API before starting)

**Requirements**: HYDR-01, HYDR-02, HYDR-03

**Success Criteria** (what must be TRUE):
1. A Preact island renders the server-computed atom value on first paint without a
   loading state — observable by disabling JavaScript after the initial HTML loads
   and confirming the value is present in the markup.
2. Atoms have stable string identifiers: the same atom key resolves to the same
   value across server render and client hydration — verified by inspecting the
   serialized props in the page source.
3. `deno publish --dry-run` on `@fresh/core` continues to pass after the
   `stringify.ts` / `reviver.ts` extension points are added.

**Plans**: TBD

Plans:
- [ ] 04-01: Verify v4 atom pre-seeding API; extensible `Stringifiers` registry in `preact_hooks.ts` + extensible `CUSTOM_PARSER` in `reviver.ts`
- [ ] 04-02: `EffectAtom` stringifier + parser in `plugin-effect`; stable atom string keys; client-side registry init before `boot()`

---

### Phase 5: Example

**Goal**: A runnable app in `packages/examples/effect-integration/` demonstrates
an Effect-returning handler with a typed Layer and a Preact island using `useAtom`
with a server-hydrated value.

**Depends on**: Phase 4 (all prior phases must be complete)

**Requirements**: EXAM-01, EXAM-02

**Success Criteria** (what must be TRUE):
1. `deno task dev` in `packages/examples/effect-integration/` starts without errors
   and the example route responds with data from the Effect handler's Layer service.
2. The example island displays an atom value hydrated from the server on first paint
   and updates it via `useAtom` setter when a button is clicked — observable in a
   browser without any additional setup.

**Plans**: TBD

Plans:
- [ ] 05-01: Effect-returning GET handler with `AppLayer` service + island using `useAtomValue` with server-hydrated atom + typed `mapError`

---

## Progress

**Execution Order**: 1 → 2 → 3 → 4 → 5
(Phase 2 and Phase 3 are independent after Phase 1; Phase 4 requires Phase 3)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | ✓ Complete | 2026-02-18 |
| 2. Type-Safe API | 1/1 | ✓ Complete | 2026-02-21 |
| 3. Preact Atom Hooks | 1/1 | ✓ Complete | 2026-02-21 |
| 4. Atom Hydration | 0/2 | Not started | - |
| 5. Example | 0/1 | Not started | - |

---
*Roadmap created: 2026-02-18*
*Last updated: 2026-02-21 after Phase 3 completion*
