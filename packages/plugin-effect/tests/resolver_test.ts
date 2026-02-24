import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Layer, ManagedRuntime } from "effect";
import { isEffect, createResolver } from "../src/resolver.ts";

// Helper to create a test runtime, cast to the any-typed signature createResolver expects
// deno-lint-ignore no-explicit-any
function makeTestRuntime(): ManagedRuntime.ManagedRuntime<any, any> {
  // deno-lint-ignore no-explicit-any
  return ManagedRuntime.make(Layer.empty) as unknown as ManagedRuntime.ManagedRuntime<any, any>;
}

// --- isEffect tests ---

Deno.test("isEffect returns true for Effect.succeed values", () => {
  const eff = Effect.succeed(42);
  assertEquals(isEffect(eff), true);
});

Deno.test("isEffect returns false for null", () => {
  assertEquals(isEffect(null), false);
});

Deno.test("isEffect returns false for undefined", () => {
  assertEquals(isEffect(undefined), false);
});

Deno.test("isEffect returns false for plain objects", () => {
  assertEquals(isEffect({}), false);
  assertEquals(isEffect({ data: "hello" }), false);
});

Deno.test("isEffect returns false for Response objects", () => {
  assertEquals(isEffect(new Response("ok")), false);
});

Deno.test("isEffect returns false for Promises", () => {
  assertEquals(isEffect(Promise.resolve(42)), false);
});

Deno.test("isEffect returns true for Effect.fail values", () => {
  const eff = Effect.fail("boom");
  assertEquals(isEffect(eff), true);
});

// --- createResolver success path ---

Deno.test("resolver passes through non-Effect values unchanged", async () => {
  const runtime = makeTestRuntime();
  try {
    const resolver = createResolver(runtime);
    const response = new Response("hello");
    const result = await resolver(response, {});
    assertEquals(result, response);
  } finally {
    await runtime.dispose();
  }
});

Deno.test("resolver passes through PageResponse-like objects unchanged", async () => {
  const runtime = makeTestRuntime();
  try {
    const resolver = createResolver(runtime);
    const pageResponse = { data: { message: "hello" }, status: 200 };
    const result = await resolver(pageResponse, {});
    assertEquals(result, pageResponse);
  } finally {
    await runtime.dispose();
  }
});

Deno.test("resolver runs Effect.succeed and returns unwrapped value", async () => {
  const runtime = makeTestRuntime();
  try {
    const resolver = createResolver(runtime);
    const response = new Response("from effect");
    const eff = Effect.succeed(response);
    const result = await resolver(eff, {});
    assertEquals(result, response);
  } finally {
    await runtime.dispose();
  }
});

Deno.test("resolver runs Effect with PageResponse and returns it", async () => {
  const runtime = makeTestRuntime();
  try {
    const resolver = createResolver(runtime);
    const pageResponse = { data: { count: 42 } };
    const eff = Effect.succeed(pageResponse);
    const result = await resolver(eff, {});
    assertEquals(result, pageResponse);
  } finally {
    await runtime.dispose();
  }
});

// --- createResolver failure path ---

Deno.test("resolver returns 500 Response on Effect.fail when no mapError provided", async () => {
  const runtime = makeTestRuntime();
  try {
    const resolver = createResolver(runtime);
    const eff = Effect.fail("something went wrong");
    const result = await resolver(eff, {});
    // Should return a 500 Response (not throw)
    assertEquals(result instanceof Response, true);
    assertEquals((result as Response).status, 500);
  } finally {
    await runtime.dispose();
  }
});

// --- createResolver mapError receives Cause<E> ---

Deno.test("mapError callback receives Cause<E>, not a plain error", async () => {
  const runtime = makeTestRuntime();
  try {
    let receivedCause: unknown = undefined;
    const errorResponse = new Response("handled", { status: 503 });
    const resolver = createResolver(runtime, {
      mapError: (cause) => {
        receivedCause = cause;
        return errorResponse;
      },
    });
    const eff = Effect.fail("boom");
    const result = await resolver(eff, {});
    assertEquals(result, errorResponse);
    // Verify the cause is a Cause<E> structure, not the plain string "boom"
    assertEquals(typeof receivedCause, "object");
    assertEquals(receivedCause !== null, true);
    assertEquals(receivedCause !== "boom", true);
  } finally {
    await runtime.dispose();
  }
});

// --- createResolver mapError path ---

Deno.test("resolver calls mapError on failure and returns its Response", async () => {
  const runtime = makeTestRuntime();
  try {
    const errorResponse = new Response("custom error", { status: 503 });
    const resolver = createResolver(runtime, {
      mapError: (_cause) => errorResponse,
    });
    const eff = Effect.fail("boom");
    const result = await resolver(eff, {});
    assertEquals(result, errorResponse);
  } finally {
    await runtime.dispose();
  }
});
