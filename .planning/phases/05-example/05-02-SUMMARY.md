---
phase: 05-example
plan: 02
subsystem: example
tags: [
  routes,
  island,
  error-handling,
  effect,
  fresh,
  todo,
  crud,
  optimistic-updates,
  atom-hydration,
]

# Dependency graph
requires:
  - phase: 05-example
    plan: 01
    provides: TodoService, AppLayer, atoms, types, app shell
---

## What was built

Routes, API endpoints, TodoApp island, and error handling for the kitchen-sink
example app — completing the end-to-end Fresh + Effect v4 demonstration.

## Tasks completed

### Task 1: Routes and API endpoints

- `routes/index.tsx`: GET handler using TodoService + setAtom for atom
  hydration, page component rendering TodoApp island
- `routes/api/todos.ts`: POST/PATCH/DELETE handlers for CRUD mutations via
  Effect.gen + TodoService
- `routes/errors/demo.tsx`: Deliberate NotFoundError trigger to demonstrate
  typed error dispatch
- `routes/_error.tsx`: Custom error page handling 404/500 with styled output

### Task 2: TodoApp island with optimistic updates

- `islands/TodoApp.tsx`: Full CRUD island using useAtom from
  @fresh/plugin-effect/island
- Optimistic update pattern: update atom immediately → fetch API → reconcile or
  rollback
- Add, toggle, delete operations with proper error handling

### Task 3: Human verification (checkpoint)

User tested the running app and identified three issues, all fixed:

1. **KV dependency removed** (a973c2ff): Replaced Deno KV-backed TodoService
   with in-memory Map — no `--unstable-kv` needed
2. **Error detail leakage fixed** (914e4f78, 980511e4): Resolver no longer leaks
   Effect Cause/stack traces to browser
3. **Proper Fresh error handling** (ae6e0630): Resolver throws HttpError(500)
   for Fresh _error.tsx rendering; example app uses mapError to map
   NotFoundError → HttpError(404) which bypasses dev overlay

## Key decisions

- In-memory Map for TodoService instead of Deno KV — simpler, no external
  dependencies, demonstrates identical Effect patterns
- Resolver default throws HttpError(500) with Cause in error.cause — enters
  Fresh's error handling chain (_error.tsx)
- Example app mapError maps NotFoundError → HttpError(404) — bypasses Fresh dev
  overlay (overlay only shows for status >= 500)
- HttpError < 500 flows through Fresh's segment error handler to _error.tsx
  without dev overlay interference

## Commits

| Hash     | Description                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| cd298012 | feat(05-02): add routes and API endpoints for effect integration example          |
| 9dc3f910 | style(05-02): remove unused _todos variable in IndexPage                          |
| 49cdefbc | feat(05-02): add TodoApp island with useAtom and optimistic CRUD updates          |
| a973c2ff | fix(05-02): replace Deno KV with in-memory store                                  |
| 914e4f78 | fix(plugin-effect): use generic error message in resolver                         |
| 980511e4 | fix(plugin-effect): return Response instead of throwing on Effect failure         |
| ae6e0630 | fix(plugin-effect): use HttpError(500) + mapError for proper Fresh error handling |

## Files modified

- packages/examples/effect-integration/routes/index.tsx (new)
- packages/examples/effect-integration/routes/api/todos.ts (new)
- packages/examples/effect-integration/routes/errors/demo.tsx (new)
- packages/examples/effect-integration/routes/_error.tsx (new)
- packages/examples/effect-integration/islands/TodoApp.tsx (new)
- packages/examples/effect-integration/main.ts (modified — added mapError)
- packages/examples/effect-integration/services/TodoService.ts (modified —
  in-memory store)
- packages/examples/effect-integration/services/errors.ts (modified — removed
  KvError)
- packages/plugin-effect/src/resolver.ts (modified — HttpError(500) default,
  mapError JSDoc)
- packages/plugin-effect/tests/resolver_test.ts (modified — updated failure
  test)
- packages/plugin-effect/tests/integration_test.ts (modified — updated comment)

## Test results

All 64 plugin-effect tests pass after all changes.
