---
description: |
  Learn how to test Freak applications using Deno's built-in test runner.
---

To ensure that your application works as expected we can write tests. Any aspect
of Freak can be tested as a whole together or in isolation. We use Deno's
built-in [test runner](https://docs.deno.com/runtime/fundamentals/testing/) to
write tests.

The examples below use `App` from `@freak/core`. If you are building with
`createEffectApp()` from `@freak/core/effect`, you can test it through the same
`Request -> Response` boundary via `app.handler()`.

## Testing middlewares

To test [middlewares](/docs/concepts/middleware) we're going to create a dummy
app and return the relevant info we want to check in a custom `/` handler. This
test assumes the `State` object in `utils.ts` has `text` property.

```ts tests/middleware.test.ts
import { expect } from "@std/expect";
import { App } from "@freak/core";
import { define, type State } from "../utils.ts";

const middleware = define.middleware((ctx) => {
  ctx.state.text = "middleware text";
  return ctx.next();
});

Deno.test("My middleware - sets ctx.state.text", async () => {
  const handler = new App<State>()
    .use(middleware)
    .get("/", (ctx) => {
      return new Response(ctx.state.text || "");
    })
    .handler();

  const res = await handler(new Request("http://localhost"));
  const text = await res.text();

  expect(text).toEqual("middleware text");
});
```

You can extend this pattern for other middlewares. When you have a middleware
that adds a header to the returned response, you can assert against that too.

## Testing app wrapper or layouts

Both the [app wrapper](/docs/advanced/app-wrapper) component and
[layouts](/docs/advanced/layouts) can be tested in the same way.

```tsx tests/appWrapper.test.tsx
import { expect } from "@std/expect";
import { App } from "@freak/core";
import { define, type State } from "../utils.ts";

const AppWrapper = define.layout(function AppWrapper({ Component }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>My App</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
});

Deno.test("App Wrapper - renders title and content", async () => {
  const handler = new App<State>()
    .appWrapper(AppWrapper)
    .get("/", (ctx) => ctx.render(<h1>hello</h1>))
    .handler();

  const res = await handler(new Request("http://localhost"));
  const text = await res.text();

  expect(text).toContain("My App");
  expect(text).toContain("hello");
});
```

Same can be done for layouts.

```tsx tests/layout.test.tsx
import { expect } from "@std/expect";
import { App } from "@freak/core";
import { define, type State } from "../utils.ts";

const MyLayout = define.layout(function MyLayout({ Component }) {
  return (
    <div>
      <h1>My Layout</h1>
      <Component />
    </div>
  );
});

Deno.test("MyLayout - renders heading and content", async () => {
  const handler = new App<State>()
    .appWrapper(MyLayout)
    .get("/", (ctx) => ctx.render(<h1>hello</h1>))
    .handler();

  const res = await handler(new Request("http://localhost"));
  const text = await res.text();

  expect(text).toContain("My Layout");
  expect(text).toContain("hello");
});
```

## Previewing rendered HTML in tests

For render tests it is often easier to inspect the returned HTML as a DOM tree
instead of asserting against long strings. A small helper can also give you a
quick preview of the rendered output while you are writing or debugging a test.

```ts tests/render-preview.ts
import { DOMParser } from "linkedom";

export interface TestDocument extends Document {
  debug(): void;
}

export function parseHtml(input: string): TestDocument {
  const doc = new DOMParser().parseFromString(
    input,
    "text/html",
  ) as TestDocument;

  Object.defineProperty(doc, "debug", {
    value: () => console.log(doc.documentElement.outerHTML),
    enumerable: false,
  });

  return doc;
}
```

```tsx tests/render-preview.test.tsx
import { expect } from "@std/expect";
import { App } from "@freak/core";
import { type State } from "../utils.ts";
import { parseHtml } from "./render-preview.ts";

Deno.test("Home page renders heading", async () => {
  const handler = new App<State>()
    .get("/", (ctx) =>
      ctx.render(
        <main>
          <h1>Hello from Freak</h1>
        </main>,
      ))
    .handler();

  const response = await handler(new Request("http://localhost/"));
  const doc = parseHtml(await response.text());

  expect(doc.querySelector("h1")?.textContent).toEqual("Hello from Freak");

  // Optional while authoring a test or debugging a failure:
  // doc.debug();
});
```

If you want richer failure output, wrap your assertions and call `doc.debug()`
from a `catch` block before re-throwing the error.

## Testing routes and handlers

For testing your route handlers and business logic, you can use the same
[`App`](/docs/concepts/app) pattern shown above. Freak makes it easy to test
individual routes without needing a full build process, as long as they export a
handler:

```ts tests/routes.test.ts
import { expect } from "@std/expect";
import { App } from "@freak/core";
import { type State } from "../utils.ts";

// Import actual route handlers
import { handler as apiHandler } from "../routes/api/[name].tsx";

Deno.test("API route returns name", async () => {
  const app = new App<State>()
    .get("/api/:name", apiHandler.GET)
    .handler();

  const response = await app(new Request("http://localhost/api/joe"));
  const text = await response.text();

  expect(text).toEqual("Hello, Joe!");
});
```

## Testing islands

Testing islands requires different approaches for server-side and client-side
behavior:

### Server-side rendering of islands

You can test that your islands render correctly on the server using the same
[`App`](/docs/concepts/app) pattern. Note: this requires a `.tsx` file extension
to use JSX:

```tsx tests/island-ssr.test.tsx
import { expect } from "@std/expect";
import { App } from "@freak/core";
import { type State } from "../utils.ts";
import Counter from "../islands/Counter.tsx";

Deno.test("Counter page renders island", async () => {
  const app = new App<State>()
    .get("/counter", (ctx) => {
      return ctx.render(
        <div class="p-8">
          <h1>Counter Test Page</h1>
          <Counter start={3} />
        </div>,
      );
    })
    .handler();

  const response = await app(new Request("http://localhost/counter"));
  const html = await response.text();

  // Verify the island's initial HTML is present
  expect(html).toContain('class="flex gap-8 py-6"');
  expect(html).toContain("Counter Test Page");
  expect(html).toContain("3");
});
```

### Client-side island interactivity

For testing client-side island behavior (clicks, state changes, etc.), you need
a full build and browser environment. You can use the approach similar to
Freak's own tests:

```tsx tests/island-client.test.tsx
import { expect } from "@std/expect";
import { buildFreakApp, startTestServer } from "./test-utils.ts";

const app = await buildFreakApp();

Deno.test("Counter island renders correctly", async () => {
  const { server, address } = startTestServer(app);

  try {
    // Basic smoke test: verify the island HTML is served
    const response = await fetch(`${address}/`);
    const html = await response.text();

    expect(html).toContain('class="flex gap-8 py-6"');
    expect(html).toContain("3");
  } finally {
    await server.shutdown();
  }
});
```

```tsx tests/test-utils.ts
import { createBuilder, type InlineConfig } from "vite";
import * as path from "@std/path";

// Default Freak build configuration
export const FREAK_BUILD_CONFIG: InlineConfig = {
  logLevel: "error",
  root: "./",
  build: { emptyOutDir: true },
  environments: {
    ssr: { build: { outDir: path.join("_fresh", "server") } },
    client: { build: { outDir: path.join("_fresh", "client") } },
  },
};

// Helper function to create and build the Freak app
export async function buildFreakApp(config: InlineConfig = FREAK_BUILD_CONFIG) {
  const builder = await createBuilder(config);
  await builder.buildApp();
  return await import("../_fresh/server.js");
}

// Helper function to start a test server
export function startTestServer(app: {
  default: {
    fetch: (req: Request) => Promise<Response>;
  };
}) {
  const server = Deno.serve({
    port: 0,
    handler: app.default.fetch,
  });

  const { port } = server.addr as Deno.NetAddr;
  const address = `http://localhost:${port}`;

  return { server, address };
}
```

**Note:** For most applications, testing the server-side rendering is
sufficient. Only test client-side interactivity if you have complex island logic
that needs verification.
