import { Builder } from "@fresh/core/dev";

const builder = new Builder({ root: import.meta.dirname });

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
