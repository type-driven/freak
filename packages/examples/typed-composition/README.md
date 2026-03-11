# Typed Composition (Platform-Style)

This example models the full integration path used in
`/Users/davidpeter/workspace/type-driven.com/platform`:

- host `EffectApp` composition
- plugin sub-app mounts
- org-scoped route prefixes
- shared atom hydration
- reactive islands reading/writing shared state

## Run

```sh
deno task --cwd packages/examples/typed-composition dev
```

Open:

- `http://localhost:8000/`

The page links to mounted plugin endpoints:

- `/orgs/demo-org/platform/counter/count`
- `/orgs/demo-org/platform/greeting/greet`

## File map

- `main.ts` — host `createEffectApp()` + plugin `mountApp()` calls at
  `/orgs/:orgSlug/platform/*`
- `counter_plugin.tsx` and `greeting_plugin.tsx` — plugin routes and services
- `shared_atoms.ts` — shared serializable atoms across sub-apps/islands
- `counter_island.tsx` and `greet_island.tsx` — reactive islands via `useAtom()`
  from `@fresh/core/effect/island`
- `routes/index.tsx` — hydrates shared atoms and renders both islands together
