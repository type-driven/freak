# Requirements: Fresh + Effect v4 Integration

**Defined:** 2026-02-18
**Core Value:** Route handlers and Preact islands feel idiomatic in both Fresh and Effect — no manual runtime wiring, no adapter boilerplate.

## v1 Requirements

### Handler Integration

- [x] **HAND-01**: Route handler can return `Effect<Response | PageResponse<Data>, E>` and Fresh runs it
- [x] **HAND-02**: Effect detection uses `EffectTypeId` duck-type check (structural, no Effect import in `@fresh/core`)
- [x] **HAND-03**: `HandlerFn` union type extended with `EffectLike<A>` — no new `E` type parameter (preserves inference)
- [x] **HAND-04**: `createEffectDefine()` typed wrapper carries `R` (Layer requirements) through route definition
- [x] **HAND-05**: Unhandled Effect failures map to Fresh's existing error boundary / error page

### Plugin & Runtime

- [x] **PLUG-01**: `effectPlugin({ layer })` configures a `ManagedRuntime` from a user-supplied Effect `Layer`
- [x] **PLUG-02**: `effectPlugin()` with no arguments works using `Layer.empty` (zero-config path)
- [x] **PLUG-03**: `ManagedRuntime` attached to Fresh middleware context; available per-request via `ctx.state.effectRuntime`
- [x] **PLUG-04**: `ManagedRuntime` disposed cleanly on Deno `unload` event (Fresh has no app lifecycle hooks)

### Preact Atom Hooks

- [x] **ATOM-01**: `useAtom(atom)` hook returns `[value, set]` — native Preact hooks (no `preact/compat`)
- [x] **ATOM-02**: `useAtomValue(atom)` hook returns current atom value
- [x] **ATOM-03**: `useAtomSet(atom)` hook returns setter function

### Atom Hydration

- [x] **HYDR-01**: Server handler can set an atom value that is serialized into the island's initial props
- [x] **HYDR-02**: Fresh island boots with the pre-seeded atom value (client hydration from server state)
- [x] **HYDR-03**: Atoms have stable string identifiers for cross-boundary identity

### Example

- [x] **EXAM-01**: `packages/examples/effect-integration/` demonstrates an Effect-returning handler with a typed Layer
- [x] **EXAM-02**: Example includes a Preact island using `useAtom` with a value hydrated from the server

## v2 Requirements

### Middleware Integration

- **MDLW-01**: Effect middleware via `ctx.nextEffect()` — threads Effect into the core `Context` type
- **MDLW-02**: Middleware can yield Effect values that compose in the request pipeline

### Publishing

- **PUB-01**: `@fresh/plugin-effect` published to JSR as a standalone package
- **PUB-02**: `@fresh/preact-atom` published to JSR as a standalone Preact atom hooks package

## Out of Scope

| Feature | Reason |
|---------|--------|
| Effect v3 support | v4 beta is the target; v3 uses different Runtime API; separate integration needed |
| React bindings | Fresh uses Preact; React is not in scope |
| Per-request Layer provisioning | Performance overhead + confusion; `ManagedRuntime` created once at startup |
| Replacing `@preact/signals` | Signals are load-bearing in Fresh; atoms are additive |
| Framework-level Schema validation | Mismatch with file-system routing model; too opinionated |
| Effect Stream over HTTP | Unvalidated in Deno HTTP server; separate streaming story needed |
| `preact/compat` path for atom-react | Runtime conflicts documented in Fresh issue #1491; native hooks are simpler |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| HAND-01 | Phase 1 — Foundation | Complete |
| HAND-02 | Phase 1 — Foundation | Complete |
| HAND-03 | Phase 1 — Foundation | Complete |
| HAND-04 | Phase 2 — Type-Safe API | Complete |
| HAND-05 | Phase 1 — Foundation | Complete |
| PLUG-01 | Phase 1 — Foundation | Complete |
| PLUG-02 | Phase 1 — Foundation | Complete |
| PLUG-03 | Phase 1 — Foundation | Complete |
| PLUG-04 | Phase 1 — Foundation | Complete |
| ATOM-01 | Phase 3 — Preact Atom Hooks | Complete |
| ATOM-02 | Phase 3 — Preact Atom Hooks | Complete |
| ATOM-03 | Phase 3 — Preact Atom Hooks | Complete |
| HYDR-01 | Phase 4 — Atom Hydration | Complete |
| HYDR-02 | Phase 4 — Atom Hydration | Complete |
| HYDR-03 | Phase 4 — Atom Hydration | Complete |
| EXAM-01 | Phase 5 — Example | Complete |
| EXAM-02 | Phase 5 — Example | Complete |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-18*
*Last updated: 2026-02-24 after Phase 5 execution — EXAM-01/02 marked Complete, all v1 requirements complete*
