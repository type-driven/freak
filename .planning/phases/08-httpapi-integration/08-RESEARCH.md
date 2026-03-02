# Phase 8: HttpApi Integration - Research

**Researched:** 2026-02-25 **Domain:** Effect HttpApi +
HttpRouter.toWebHandler + Fresh middleware forwarding **Confidence:** HIGH — all
findings verified directly from platform-deno-smol source and tests

---

## Summary

Phase 8 adds `app.httpApi(api, groupImpls)` to `EffectApp`. When called, it
builds an Effect `HttpApiBuilder.layer(api)` layer (seeded with the group
implementation layers), combines it with `HttpServer.layerServices` (provides
FileSystem, HttpPlatform, Path, Etag.Generator), and converts the whole thing to
a web handler via `HttpRouter.toWebHandler(mergedLayer)`. The resulting
`handler` function (returns `Promise<Response>`) is stored on `EffectApp`. When
`app.handler()` / `app.listen()` is called, requests arriving at any path
declared in the HttpApi definition are forwarded to this Effect sub-handler; all
other requests go through normal Fresh routing.

Fresh integration strategy: register a catch-all middleware via `app.use()` at
the API prefix that delegates to the Effect handler, falling through to
`ctx.next()` if the Effect handler returns 404 (route not found in the Effect
router). This is the simplest approach that keeps Fresh routing untouched.

**Primary recommendation:** Implement `EffectApp.httpApi()` as a method that
immediately calls `HttpRouter.toWebHandler()` and stores `{ handler, dispose }`.
In `EffectApp.handler()` (or lazily on first request), register a
prefix-matching middleware forwarding to the Effect handler.

---

## Standard Stack

### Core HttpApi modules (from `npm:effect@4.0.0-beta.0`)

| Import path               | Exports                                                                                         | Purpose                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------- |
| `effect/unstable/httpapi` | `HttpApi`, `HttpApiBuilder`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiError`, `HttpApiSchema` | API definition and implementation       |
| `effect/unstable/http`    | `HttpRouter`, `HttpServer`                                                                      | Router with toWebHandler, layerServices |

These are the only two import paths needed. Both are already available in
`npm:effect@4.0.0-beta.0` (verified via package.json exports in
platform-deno-smol).

### Dependencies not currently in @fresh/effect deno.json

The `packages/effect/deno.json` currently only maps
`"effect": "npm:effect@4.0.0-beta.0"`. It does NOT map `"effect/unstable/http"`
or `"effect/unstable/httpapi"`. These bare specifier entries must be added for
Deno to resolve the sub-path imports correctly.

**Required additions to `packages/effect/deno.json` imports:**

```json
"effect/unstable/http": "npm:effect@4.0.0-beta.0/unstable/http",
"effect/unstable/httpapi": "npm:effect@4.0.0-beta.0/unstable/httpapi"
```

The same additions are needed in
`packages/examples/effect-integration/deno.json`.

**Installation:** No new npm packages needed — everything is in
`npm:effect@4.0.0-beta.0`.

---

## Architecture Patterns

### HttpApi Layer Construction (verified from HttpApiBuilder.ts source)

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts

// Step 1: Implement each group
const UsersGroupLive = HttpApiBuilder.group(
  Api,
  "users", // group name string
  (handlers) =>
    handlers.handle(
      "getUser", // endpoint name string
      ({ params }) =>
        // receives decoded { params, query, payload, headers, request }
        Effect.succeed({ id: params.id, name: "Alice" }),
    ),
);

// Step 2: Build the API layer
const ApiLayer = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(UsersGroupLive),
  // Layer.provide(OtherGroupLive),  // for each additional group
);
// HttpApiBuilder.layer(api) requires:
//   Etag.Generator | HttpRouter | FileSystem | HttpPlatform | Path
//   | HttpApiGroup.ToService<ApiId, Groups>
// It outputs: Layer<never, never, ...those requirements>
```

### Converting to Web Handler (verified from HttpRouter.ts source + HTTPAPI.md)

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/http/HttpRouter.ts

const { handler, dispose } = HttpRouter.toWebHandler(
  Layer.mergeAll(
    ApiLayer,
    HttpServer.layerServices, // provides FileSystem, HttpPlatform, Path, Etag.Generator
  ),
);
// handler: (request: Request) => Promise<Response>
// dispose: () => Promise<void>
```

`HttpServer.layerServices` (verified in HttpServer.ts) provides:

- `HttpPlatform.HttpPlatform`
- `Path.Path`
- `Etag.Generator` (weak variant)
- `FileSystem.FileSystem` (noop variant — sufficient for serving JSON APIs)

### Full Pattern in Context

```typescript
// Source: platform-deno-smol/packages/effect/HTTPAPI.md (web handler section)

import { Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { Schema } from "effect";

// 1. Define
const Api = HttpApi.make("MyApi").add(
  HttpApiGroup.make("users").prefix("/api/users").add(
    HttpApiEndpoint.get("getUser", "/:id", {
      params: { id: Schema.String },
      success: Schema.Struct({ id: Schema.String, name: Schema.String }),
      error: HttpApiError.NotFound,
    }),
  ),
);

// 2. Implement
const UsersLive = HttpApiBuilder.group(
  Api,
  "users",
  (handlers) =>
    handlers.handle("getUser", ({ params }) =>
      Effect.gen(function* () {
        const user = yield* UserService.findById(params.id);
        if (!user) return yield* Effect.fail(new HttpApiError.NotFound());
        return user;
      })),
);

// 3. Convert to web handler (called once at startup)
const { handler, dispose } = HttpRouter.toWebHandler(
  Layer.mergeAll(
    HttpApiBuilder.layer(Api).pipe(
      Layer.provide(UsersLive),
      Layer.provide(HttpServer.layerServices),
    ),
  ),
);
```

### Fresh Integration via app.use() Middleware

The key insight: Fresh's `app.use(path, middleware)` registers a middleware at a
path prefix. Requests matching that prefix pass through the middleware first.
The middleware can delegate to the Effect handler and return the response, or
call `ctx.next()` for non-matched routes.

The simplest integration:

```typescript
// In EffectApp.httpApi():
httpApi(api: HttpApi.Any, ...groupLayers: Layer.Layer<any, any, any>[]): this {
  const ApiLayer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(Layer.mergeAll(...groupLayers)),
    Layer.provide(HttpServer.layerServices)
  )
  const { handler, dispose } = HttpRouter.toWebHandler(
    Layer.mergeAll(ApiLayer)
  )
  // Store for disposal
  this.#httpApiDisposers.push(dispose)
  // Register Fresh middleware for ALL paths (or derive prefix from api)
  // Fresh middleware returns ctx.next() when not matched → 404 handling
  this.#app.use(async (ctx) => {
    const response = await handler(ctx.req)
    // Effect handler returns 404 for unmatched routes (HttpServerError)
    // We need to distinguish "route not found in HttpApi" vs "real 404 error"
    if (response.status === 404) return ctx.next()
    return response
  })
  return this
}
```

**RISK:** The "check status === 404 and fallthrough" approach conflates "not
found in Effect router" with "intentional 404 error from handler". See
Unknowns/Risks below.

---

## Don't Hand-Roll

| Problem                      | Don't Build                 | Use Instead                                     | Why                                                  |
| ---------------------------- | --------------------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Request param/query decoding | Custom schema-based decoder | `HttpApiBuilder.group` auto-decodes             | Handles all content-types, multipart, error encoding |
| Error → HTTP status mapping  | Custom error handler        | `HttpApiSchema.status()` annotation + framework | Status is part of schema declaration, automatic      |
| JSON response serialization  | Manual JSON.stringify       | `HttpApiBuilder` handles encoding               | Schema-based encoding with correct content-type      |
| 404 for schema errors        | Custom error class          | `HttpApiError.NotFound`, etc.                   | Pre-built error classes with correct status codes    |

---

## Common Pitfalls

### Pitfall 1: Schema Validation Errors Return 400, NOT 422

**What goes wrong:** The phase success criteria mentions "422 with
schema-validation error" but the actual library returns 400 Bad Request for
schema decode failures.

**Why it happens:** In this Effect version, `HttpApiSchemaError` (produced when
params/query/ payload fail schema decoding) has `httpApiStatus: 400`. There is
no 422 status code used.

**How to avoid:** Write tests and success criteria expecting HTTP 400, not 422.
The response body will be `{ "_tag": "HttpApiSchemaError", "message": "..." }`.

**Warning signs:** Test assertions on status 422 will fail.

### Pitfall 2: Missing deno.json Import Map Entries

**What goes wrong:** `import { HttpRouter } from "effect/unstable/http"` fails
to resolve in Deno because the sub-path specifier is not in the import map.

**Why it happens:** Deno uses the `imports` field in deno.json to resolve bare
specifiers. The current `packages/effect/deno.json` only maps `"effect"` not
`"effect/unstable/http"`.

**How to avoid:** Add both entries to all relevant deno.json files before
writing any code that imports from these paths.

### Pitfall 3: HttpApiBuilder.layer() Requires HttpServer.layerServices

**What goes wrong:**
`HttpRouter.toWebHandler(HttpApiBuilder.layer(Api).pipe(...))` fails at runtime
with "missing service" errors for `FileSystem`, `HttpPlatform`, `Path`, or
`Etag.Generator`.

**Why it happens:** `HttpApiBuilder.layer()` internally uses `FileSystem` and
`Etag.Generator` for serving static assets and ETag generation. These are
infrastructure services.

**How to avoid:** Always compose `HttpServer.layerServices` into the layer
passed to `HttpRouter.toWebHandler`. This provides all four required services
with safe no-op or weak implementations suitable for JSON APIs.

### Pitfall 4: 404 Fallthrough vs Intentional 404 Error

**What goes wrong:** When the Effect handler returns 404 (either because the
route was not found in the HttpApi router, OR because a handler intentionally
returned NotFound), the fallthrough logic cannot distinguish the two.

**Why it happens:** `HttpRouter.toWebHandler` produces a plain `Response` with
status 404 for both cases. There's no special header or body format that
distinguishes them.

**How to avoid:** One approach — register the Effect middleware only at the
exact paths declared in the HttpApi (extract path prefixes from `api.groups`
before registering). Then a 404 from an HttpApi handler is intentional (the
route matched the prefix, so the handler ran and said "not found"). Fresh will
never see it as "unmatched" because Fresh already matched the prefix.

**Alternative:** Register at `/*` (catch-all) and treat any 404 response as "not
matched, fall through to Fresh". This is simpler but breaks intentional 404
HttpApiError responses.

**Recommended approach:** Extract the path prefix from the HttpApi definition
and register Fresh middleware only at that prefix. Then 404 from within the
Effect handler is always intentional.

### Pitfall 5: Dispose Lifecycle

**What goes wrong:** `HttpRouter.toWebHandler()` returns a `dispose` function
that must be called to shut down the Effect runtime. If not called, the runtime
leaks.

**Why it happens:** The Effect Layer creates a managed runtime with scoped
resources. `dispose()` triggers finalizers.

**How to avoid:** Store all dispose functions in `EffectApp`. Call them in
`EffectApp.dispose()`. Also update `registerSignalDisposal` to call them (or
delegate to `EffectApp.dispose()`).

### Pitfall 6: ManagedRuntime vs HttpRouter.toWebHandler Runtime

**What goes wrong:** Calling `HttpRouter.toWebHandler` creates its own internal
Effect runtime. The group implementation layers are built inside this runtime,
NOT in the `EffectApp.#runtime` (ManagedRuntime). This means group
implementations cannot use services from the outer `AppLayer`.

**Why it happens:** `HttpRouter.toWebHandler` takes a self-contained `Layer`
that must provide everything it needs. There is no injection from
`EffectApp.#runtime`.

**How to avoid:** Group implementation layers must be fully self-sufficient, OR
the user must explicitly compose `AppLayer` into the ApiLayer:

```typescript
HttpApiBuilder.layer(Api).pipe(
  Layer.provide(UsersLive),
  Layer.provide(AppLayer), // bring in shared app services
  Layer.provide(HttpServer.layerServices),
);
```

The `app.httpApi(api, ...groupImpls)` signature should either accept the app's
Layer composition automatically, or document that users must do this manually.

---

## Code Examples

### Handler Input Shape in Group Implementations

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts (handlerToRoute)

// The handler function receives a request object with decoded fields:
handlers.handle(
  "endpointName",
  ({ params, query, payload, headers, request, endpoint, group }) =>
    Effect.gen(function* () {
      // params: decoded path params (typed per endpoint schema)
      // query: decoded query string (typed per endpoint schema)
      // payload: decoded request body (typed per endpoint schema)
      // headers: decoded headers (typed per endpoint schema)
      // request: raw HttpServerRequest (when isRaw: false, still available)
      return { id: params.id };
    }),
);
```

### Error Handling Pattern

```typescript
// Source: platform-deno-smol/packages/effect/src/unstable/httpapi/HttpApiError.ts

// Built-in errors with correct status codes:
import { HttpApiError } from "effect/unstable/httpapi"

// NotFound (404):
return yield* Effect.fail(new HttpApiError.NotFound())

// BadRequest (400):
return yield* Effect.fail(new HttpApiError.BadRequest())

// Custom error declared on endpoint:
// error: MyCustomError  (with httpApiStatus: 422 annotation)
return yield* Effect.fail(new MyCustomError({ message: "invalid" }))
```

### Endpoint Declaration with Error Schema

```typescript
// Source: platform-deno-smol/packages/effect/HTTPAPI.md (Anatomy of an Endpoint section)

HttpApiEndpoint.get("getUser", "/:id", {
  params: { id: Schema.String },
  query: { expand: Schema.optional(Schema.Boolean) },
  success: User,
  error: [
    HttpApiError.NotFound, // 404
    HttpApiError.BadRequest, // 400
  ],
});
```

### HttpApiSchemaError Response Body

```typescript
// Verified from platform-node/test/HttpApi.test.ts:
// When params/query/payload fail schema decoding, response is:
// Status: 400
// Body: { "_tag": "HttpApiSchemaError", "message": "..." }
```

---

## State of the Art

| Old Approach                    | Current Approach                                    | Impact                                               |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `HttpApiDecodeError` → 422      | `HttpApiSchemaError` → 400                          | Phase success criteria mentions 422 — incorrect      |
| Node-specific platform adapters | `HttpServer.layerServices` (platform-agnostic)      | Works in Deno without platform-deno package          |
| `Layer.launch()` for servers    | `HttpRouter.toWebHandler()` for serverless/embedded | Returns `{ handler, dispose }` — embed in any server |

---

## EffectApp Current State

### What exists in `packages/effect/src/`

| File          | Status   | Notes                                                                      |
| ------------- | -------- | -------------------------------------------------------------------------- |
| `app.ts`      | Complete | `EffectApp` class, all proxy methods, `handler()`, `listen()`, `dispose()` |
| `define.ts`   | Complete | `createEffectDefine` type-only helper                                      |
| `mod.ts`      | Complete | Public exports                                                             |
| `resolver.ts` | Complete | `createResolver`, `isEffect` duck-type check                               |
| `runtime.ts`  | Complete | `makeRuntime`, `registerSignalDisposal`                                    |
| `types.ts`    | Complete | Re-exports `Layer`, `ManagedRuntime`                                       |

### What is MISSING for Phase 8

| Missing                      | Location                                         | Required Work                                            |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| `EffectApp.httpApi()` method | `app.ts`                                         | New method that builds+stores Effect handler             |
| `#httpApiDisposers` storage  | `app.ts`                                         | `Array<() => Promise<void>>` field on EffectApp          |
| Dispose integration          | `app.ts`                                         | `dispose()` must call all `#httpApiDisposers`            |
| Import map entries           | `packages/effect/deno.json`                      | Add `effect/unstable/http` and `effect/unstable/httpapi` |
| Import map entries           | `packages/examples/effect-integration/deno.json` | Same additions                                           |
| `httpApi()` demo usage       | `packages/examples/effect-integration/main.ts`   | Add HttpApi definition + mounting                        |
| HttpApi services file        | `packages/examples/effect-integration/services/` | Define example API + group impl                          |

---

## Integration Pattern

### Proposed `EffectApp.httpApi()` Signature

```typescript
// In EffectApp<State, AppR>:
httpApi<Id extends string, Groups extends HttpApiGroup.Any>(
  api: HttpApi.HttpApi<Id, Groups>,
  ...groupLayers: Layer.Layer<HttpApiGroup.ToService<Id, Groups>, any, AppR>[]
): this
```

The `groupLayers` constraint ties each group layer to require `AppR` (the app's
services), which allows group implementations to depend on the same services as
route handlers.

### Proposed implementation flow

```typescript
httpApi(api, ...groupLayers) {
  // Build the complete api layer, providing group impls and shared app layer
  const ApiLayer = HttpApiBuilder.layer(api).pipe(
    Layer.provide(Layer.mergeAll(...groupLayers)),
    Layer.provide(this.#runtime.memoMap),   // RISK: may not be accessible
    Layer.provide(HttpServer.layerServices)
  )

  const { handler, dispose } = HttpRouter.toWebHandler(ApiLayer, {
    disableLogger: true  // Fresh already handles logging
  })

  this.#httpApiDisposers.push(dispose)

  // Derive the path prefix from the api's groups
  // (groups have path-prefixed endpoints — take the common prefix)
  // Simplest: register catch-all middleware
  this.#app.use(async (ctx) => {
    // The Effect handler will 404 for unmatched routes
    const response = await handler(ctx.req)
    if (response.status === 404) {
      // Check if this is a route-not-found (from HttpServerError) vs intentional NotFound
      // Simplest approximation: let it through if the response has no body
      // OR: don't use catch-all — see "prefix detection" below
      return ctx.next()
    }
    return response
  })

  return this
}
```

**BETTER approach — prefix detection:**

```typescript
httpApi(api, ...groupLayers) {
  // ... build ApiLayer, create handler same as above ...

  // Extract all declared paths from the API definition
  const prefixes = Object.values(api.groups).flatMap(group =>
    Object.values(group.endpoints).map(ep => ep.path.split("/")[1] || "")
  )
  const uniquePrefixes = [...new Set(prefixes)].filter(Boolean)

  // Register a middleware for each path prefix
  for (const prefix of uniquePrefixes) {
    this.#app.use(`/${prefix}`, async (ctx) => {
      return handler(ctx.req)
    })
  }

  return this
}
```

### Runtime Sharing Question (OPEN)

A critical design question: should group implementations share the `EffectApp`'s
`ManagedRuntime`? The two approaches are:

**Option A: Shared runtime (complex)** Use `ManagedRuntime.run` to execute the
`HttpRouter.toWebHandler` layer build inside the existing runtime. This ensures
group implementations can access `AppR` services.

**Option B: Parallel runtime (simple, documented constraint)** Build a separate
runtime via `HttpRouter.toWebHandler`. Require the caller to explicitly compose
`AppLayer` into the group layer. This is the simpler approach and matches how
the effect library itself works.

**Recommendation: Option B.** The group layers can be composed with `AppLayer`
by the user. This is explicit and matches the effect idiom. The `httpApi()`
signature should take `groupLayers` typed as `Layer.Layer<..., ..., AppR>` to
constrain services to those available in the outer app layer.

---

## Open Questions

1. **ManagedRuntime memoMap sharing**
   - What we know: `HttpRouter.toWebHandler` creates its own internal runtime
   - What's unclear: Can we pass `this.#runtime.memoMap` to
     `HttpRouter.toWebHandler` to share memoized service instances between the
     main runtime and the HttpApi runtime?
   - Recommendation: Check if `ManagedRuntime` exposes `memoMap` and if
     `HttpRouter.toWebHandler(layer, { memoMap })` is the right API

2. **Prefix extraction from HttpApi**
   - What we know: `api.groups` is a `Record<string, HttpApiGroup>`, each group
     has `endpoints` with path properties
   - What's unclear: Is there a stable way to extract the "common prefix" of all
     endpoints to use as Fresh middleware path?
   - Recommendation: For Phase 8, use a `prefix` parameter on `httpApi()` rather
     than auto-detecting. E.g. `app.httpApi("/api", api, ...groupLayers)` is
     explicit and avoids fragile prefix extraction.

3. **Success criteria status code (422 vs 400)**
   - What we know: The library uses 400 for schema decode errors, not 422
   - What's unclear: Was the 422 in success criteria intentional (expecting a
     custom error class with 422 annotation) or a mistake?
   - Recommendation: The example should use a CUSTOM error class annotated with
     a specific status to test HAPI-03, separate from schema validation error
     testing. Test schema validation error as 400 (HttpApiSchemaError → 400).

---

## Sources

### Primary (HIGH confidence)

- `platform-deno-smol/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts` —
  full source of `HttpApiBuilder.layer()`, `HttpApiBuilder.group()`,
  `handlerToRoute()`, error encoding pipeline
- `platform-deno-smol/packages/effect/src/unstable/http/HttpRouter.ts` —
  `toWebHandler()` implementation, `Provided` type, `layer`, `serve`
- `platform-deno-smol/packages/effect/src/unstable/http/HttpServer.ts` —
  `layerServices` definition (line 243)
- `platform-deno-smol/packages/effect/src/unstable/httpapi/HttpApiError.ts` —
  all built-in error classes with `httpApiStatus` values (400 for schema errors)
- `platform-deno-smol/packages/effect/HTTPAPI.md` — "Converting to a Web
  Handler" section (lines 3053-3114), full API documentation
- `platform-deno-smol/packages/platform-node/test/HttpApi.test.ts` — test
  assertions confirming 400 status for HttpApiSchemaError
- `packages/effect/src/app.ts` — current EffectApp implementation (complete
  Phase 7 output)

### Secondary (MEDIUM confidence)

- `platform-deno-smol/packages/effect/test/unstable/http/HttpEffect.test.ts` —
  toWebHandler usage patterns confirmed
- `platform-deno-smol/packages/effect/test/unstable/ai/McpServer.test.ts` — line
  40: `HttpRouter.toWebHandler(appLayer as any, { disableLogger: true })` with
  layer merging

---

## Metadata

**Confidence breakdown:**

- HttpApi API shape (HttpApiBuilder.layer, group, toWebHandler): HIGH — read
  source
- Error status codes (400 for schema errors, NOT 422): HIGH — verified in
  source + tests
- Fresh integration via app.use(): MEDIUM — logical but not tested in existing
  codebase
- Runtime sharing (Option A vs B): LOW — needs design decision, no precedent in
  codebase
- Prefix extraction strategy: LOW — no existing pattern to follow

**Research date:** 2026-02-25 **Valid until:** 2026-03-25 (effect beta moves
fast; re-check if version bumps)
