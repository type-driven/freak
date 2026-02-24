import { HttpError, type PageProps } from "@fresh/core";
import { Cause } from "effect";

export default function ErrorPage(props: PageProps) {
  const error = props.error;

  if (error instanceof HttpError) {
    if (error.status === 404) {
      return (
        <div class="max-w-2xl mx-auto py-16 px-4 text-center">
          <h1 class="text-6xl font-bold text-gray-300">404</h1>
          <p class="mt-4 text-xl text-gray-600">Page not found</p>
          <a href="/" class="mt-6 inline-block text-blue-600 hover:underline">
            Back to home
          </a>
        </div>
      );
    }
  }

  // Log the error server-side for debugging.
  // If the error came from Effect (via the resolver's default throw path),
  // error.cause holds the Effect Cause -- log it with Cause.pretty() for
  // the full structured trace including tagged errors.
  if (
    error instanceof Error &&
    error.cause !== undefined
  ) {
    try {
      // deno-lint-ignore no-console
      console.error("[effect error]", Cause.pretty(error.cause as never));
    } catch {
      // deno-lint-ignore no-console
      console.error("[error page]", error);
    }
  } else {
    // deno-lint-ignore no-console
    console.error("[error page]", error);
  }

  return (
    <div class="max-w-2xl mx-auto py-16 px-4 text-center">
      <h1 class="text-6xl font-bold text-red-300">500</h1>
      <p class="mt-4 text-xl text-gray-600">Something went wrong</p>
      <p class="mt-2 text-gray-500">
        The error has been logged. Check the server console for details.
      </p>
      <a href="/" class="mt-6 inline-block text-blue-600 hover:underline">
        Back to home
      </a>
    </div>
  );
}
