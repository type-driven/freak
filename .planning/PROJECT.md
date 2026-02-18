# Fresh + Effect v4 Integration

## What This Is

Native Effect v4 support in Fresh, the Deno web framework. Route handlers can
return `Effect<Response | PageResponse<Data>, E>` values that Fresh runs through
a configured Effect runtime. Effect v4 atoms work as reactive state in Preact
islands via a `useAtom` hook, with atom values hydrated from server to client.

## Core Value

Route handlers and Preact islands feel idiomatic in both Fresh and Effect — no
manual runtime wiring, no adapter boilerplate, just Effect returns where you
already write handlers.

## Requirements

### Validated

- ✓ Fresh 2 route handler system (`HandlerFn`, `RouteHandler`, `page()`) — existing
- ✓ Preact island architecture with client hydration — existing
- ✓ Fresh plugin API for third-party integrations — existing

### Active

- [ ] `HandlerFn` union type extended to accept `Effect<Response | PageResponse<Data>, E>`
- [ ] Fresh core detects Effect return values and runs them through a runtime
- [ ] A `plugin-effect` mechanism for configuring the Effect `Layer` / runtime
- [ ] `useAtom`, `useAtomValue`, `useAtomSet` hooks for Preact (or reuse atom-react if Preact-compat works)
- [ ] Atom values set server-side can be serialized and hydrated in Preact islands
- [ ] Working example in `packages/examples` demonstrating Effect handler + atom in an island

### Out of Scope

- Effect v3 support — targeting v4 beta only; v3 would require a separate integration path
- A standalone JSR library — this is a core Fresh change, not a reusable external package
- React bindings — Preact is the Fresh target; `atom-react` may be leveraged but React support is not a goal

## Context

- Repository: Fresh framework monorepo (`packages/fresh`, `packages/plugin-vite`, `packages/examples`, etc.)
- Effect v4 beta (`effect@4.0.0-beta.0`) released with atoms as a new reactive primitive
- `@effect-atom/atom` provides `Atom.make()`, `Atom.runtime(layer)`, and hooks; React bindings exist as `@effect-atom/atom-react`; Preact binding existence is unknown — needs research
- Current `HandlerFn` returns `Response | PageResponse<Data> | Promise<...>` — Effect return types would extend this union
- Fresh islands hydrate via serialized props; atom hydration will piggyback on this mechanism
- Stack: Deno 2, TypeScript, Fresh 2, Preact, Effect v4 beta

## Constraints

- **Tech stack**: Deno 2, Fresh 2, Preact — no React, no Node-specific APIs
- **Backwards compatibility**: Effect support must be opt-in; existing handlers must continue to work unchanged
- **Effect v4 beta**: API may shift before stable release; integration should isolate Effect-specific code
- **JSR publishing**: New packages must conform to JSR constraints (no `npm:` in public API types)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Extend HandlerFn union rather than a new handler type | Least breaking, existing routes unaffected | — Pending |
| Research Preact atom binding before building | Don't rebuild what exists; atom-react may work via Preact compat | — Pending |

---
*Last updated: 2026-02-18 after initialization*
