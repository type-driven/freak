import { page } from "@fresh/core";
import { setAtom } from "@fresh/core/effect";
import Counter from "../islands/Counter.tsx";
import { counterAtom } from "../atoms.ts";

export const handler = {
  GET: (ctx: unknown) => {
    setAtom(ctx as { state: unknown }, counterAtom, 42);
    return page({});
  },
};

export default function IndexPage() {
  return (
    <html>
      <head>
        <title>Freak Benchmark (Effect)</title>
      </head>
      <body>
        <h1>Freak Benchmark (Effect)</h1>
        <Counter />
      </body>
    </html>
  );
}
