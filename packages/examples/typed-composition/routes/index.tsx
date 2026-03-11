/** @jsxImportSource preact */

import { type Context, page, type PageProps } from "@fresh/core";
import { setAtom } from "@fresh/core/effect";
import { CounterIsland } from "../counter_plugin.tsx";
import { GreetIsland } from "../greeting_plugin.tsx";
import {
  counterSubAppForOrg,
  greetingSubAppForOrg,
  platformRootForOrg,
} from "../paths.ts";
import {
  counterAtom,
  greetingAtom,
  platformStatusAtom,
} from "../shared_atoms.ts";

interface DemoPageData {
  orgSlug: string;
  platformRoot: string;
  counterApiBase: string;
  greetingApiBase: string;
}

export const handler = {
  GET(ctx: Context<Record<string, unknown>>) {
    const orgSlug = "demo-org";
    const platformRoot = platformRootForOrg(orgSlug);
    const counterApiBase = counterSubAppForOrg(orgSlug);
    const greetingApiBase = greetingSubAppForOrg(orgSlug);

    const userId =
      typeof (ctx.state as { userId?: unknown }).userId === "string"
        ? (ctx.state as { userId: string }).userId
        : "demo-user";
    const requestId =
      typeof (ctx.state as { requestId?: unknown }).requestId === "string"
        ? (ctx.state as { requestId: string }).requestId
        : "demo-request";

    setAtom(ctx, counterAtom, 0);
    setAtom(ctx, greetingAtom, `Hello, ${userId}!`);
    setAtom(ctx, platformStatusAtom, `hydrated:${requestId}`);

    const data: DemoPageData = {
      orgSlug,
      platformRoot,
      counterApiBase,
      greetingApiBase,
    };
    return page(data);
  },
};

export default function IndexPage(props: PageProps<DemoPageData>) {
  const { orgSlug, platformRoot, counterApiBase, greetingApiBase } = props.data;

  return (
    <html>
      <head>
        <title>Typed Composition Demo</title>
      </head>
      <body>
        <h1>Typed Composition Demo</h1>
        <p>
          Platform-style integration path with plugins, sub-apps, shared atom
          state, and reactive islands.
        </p>
        <p>
          Org scope: <code>{orgSlug}</code>
        </p>
        <p>
          Base path: <code>{platformRoot}</code>
        </p>
        <ul>
          <li>
            <a href={`${counterApiBase}/count`}>GET {counterApiBase}/count</a>
            {" "}
            — CounterPlugin JSON
          </li>
          <li>
            <a href={`${greetingApiBase}/greet`}>GET {greetingApiBase}/greet</a>
            {" "}
            — GreetingPlugin JSON
          </li>
        </ul>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <CounterIsland apiBase={counterApiBase} />
          <GreetIsland apiBase={greetingApiBase} />
        </div>
      </body>
    </html>
  );
}
