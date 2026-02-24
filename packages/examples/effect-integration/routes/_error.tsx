import { HttpError, type PageProps } from "@fresh/core";

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

  // deno-lint-ignore no-console
  console.error("[error page]", error);

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
