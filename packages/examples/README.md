# Examples for Fresh

This package contains examples for using Fresh with [JSR](https://jsr.io/).

Learn more about the Fresh framework here:
[https://fresh.deno.dev/](https://fresh.deno.dev/)

## Usage: Island example

```tsx
import { App } from "fresh";
// Import the island function
import { DemoIsland } from "jsr:@fresh/examples/island";

export const app = new App({ root: import.meta.url })
  .use(staticFiles());

// Use the island somewhere in your components
app.get("/", (ctx) => ctx.render(<DemoIsland />));

await app.listen();
```

## Usage: App1 or App2 example

```tsx
import { App } from "fresh";
// Import the example apps
import { app1 } from "jsr:@fresh/examples/app1";
import { app2 } from "jsr:@fresh/examples/app2";

export const app = new App({ root: import.meta.url })
  .use(staticFiles());

// Merge apps from JSR into this one
app.mountApp("/app1", app1);
app.mountApp("/app2", app2);

await app.listen();
```

## Full integration path (platform-style)

For a complete composition flow (host app + plugin sub-apps + shared atom
state + reactive islands), use the `typed-composition` example in this repo:

- `packages/examples/typed-composition/main.ts`
- `packages/examples/typed-composition/routes/index.tsx`
- `packages/examples/typed-composition/counter_plugin.tsx`
- `packages/examples/typed-composition/greeting_plugin.tsx`
- `packages/examples/typed-composition/shared_atoms.ts`

It mirrors platform-style org-scoped mounts:

- `/orgs/:orgSlug/platform/counter/*`
- `/orgs/:orgSlug/platform/greeting/*`

and demonstrates:

- plugin sub-app mounting via `mountApp()`
- shared serializable atoms across plugins/islands
- reactive islands using `useAtom()` from `@fresh/core/effect/island`

## License

MIT, see the [LICENSE](./LICENSE) file.
