import { Builder } from "@fresh/core/dev";

const builder = new Builder({ target: "safari12", root: import.meta.dirname });

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
