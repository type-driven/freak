---
description: |
  Freak is a full stack modern web framework based on Fresh 2 with first-class
  Effect integration for typed services, atoms, and typed APIs.
---

Freak is a fork of Fresh 2 that keeps the same small, fast, and extensible web
framework model while adding first-class [Effect](https://effect.website/)
integration. You still get file routing, middleware, layouts, and islands, but
you can also add typed services, shared atoms, schema-first APIs, and typed RPC
when you need them.

```ts main.ts
import { staticFiles } from "@freak/core";
import { createEffectApp } from "@freak/core/effect";
import { AppLayer } from "./services/layers.ts";

const effectApp = createEffectApp({ layer: AppLayer });

export const app = effectApp
  .use(staticFiles())
  .get("/", () => new Response("hello world"))
  .fsRoutes();
```

## Quick Start

Start with a Fresh-compatible app scaffold by running:

```sh Terminal
deno run -Ar jsr:@fresh/init
```

Then add Freak's Effect features with
[Effect integration](/docs/concepts/effect-integration) or, if you already have
an existing Fresh 2 app, follow [Migrating to Freak](/docs/migration).

## Features

The core idea powering Freak is still to render server generated HTML pages and
only ship JavaScript for areas in the page that need to be interactive. This is
often referred to as the
[Island Architecture](https://jasonformat.com/islands-architecture).

- **Fresh 2 compatible** - Keep the same routing, middleware, layouts, and
  islands model
- **Effect-native handlers** - Use `createEffectApp()` and
  `createEffectDefine()` for typed service access
- **Shared island state** - Coordinate islands with Effect atoms and hydrate
  them from the server
- **Typed APIs** - Mount `HttpApi` groups and typed `RpcGroup` procedures
- **Fast** 🚀 - Rendering is super fast thanks to [Preact][preact] and Deno's
  [`precompile` transform](https://docs.deno.com/runtime/reference/jsx/#jsx-precompile-transform)
- **Lightweight** 🏎️ - Only ship the JavaScript you need
- **Extensible** 🧩 - Nearly every aspect can be customized
- **Powerful & small API** 🤗 - Familiar APIs make you productive quickly
- **Built-in OpenTelemetry** 📈 - Built-in support for OpenTelemetry

## When to use Freak

Freak is ideal for sites and apps that are primarily server rendered, especially
when you want typed backend/frontend coordination without giving up the Fresh 2
request model.

- Web APIs
- E-Commerce shops
- Portfolio sites
- Landing pages & Documentation
- CRUD apps
- Internal tools and dashboards with typed services
- Apps that benefit from shared island state or typed RPC

That said, if you want to build a Single-Page-App (=SPA), then Freak is not the
right framework.

## Learn Freak by example

- [Effect integration](/docs/concepts/effect-integration) for the core Freak
  model
- [Sharing state between islands](/docs/examples/sharing-state-between-islands)
  for atom-based island coordination
- [Migrating to Freak](/docs/migration) if you already have a Fresh 2 app

## Where to host Freak apps?

Freak can be deployed anywhere Deno runs. It works well on
[Deno Deploy][deno-deploy], but it can also be deployed manually via Docker or
other Deno-compatible platforms.

Because Freak keeps the Fresh 2 server model, the same hosting guidance applies:
optimized server output lives in `_fresh/`, and deployment targets that can run
Deno can serve the generated server entry.

[preact]: https://preactjs.com
[deno]: https://deno.com
[deno-deploy]: https://deno.com/deploy
