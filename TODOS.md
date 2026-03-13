# TODOs

Items deferred during implementation review, captured with full context so they
can be picked up later without archaeology.

---

## 1. Capability enforcement for `mountApp()`

**What:** Extend `App.mountApp()` to accept a third `options?: { provides?: ReadonlyArray<string> }` parameter and throw a descriptive error when a plugin declares `required: true` for a capability not present in the host's `provides` set.

**Why:** `PluginCapabilityRequirement.required` is stored on the Plugin object but currently has no runtime effect. A `required: true` requirement that silently passes is actively misleading to plugin authors — it creates false confidence that the host contract is validated.

**Pros:** Makes plugin capability contracts enforceable at mount time. Descriptive error messages guide developers to the correct fix (adding the capability to `provides`). Unlocks typed plugin ecosystems where plugins document their host requirements.

**Cons:** Adds surface to the `mountApp()` API. Host must explicitly declare capabilities — there is no automatic inference from the Effect layer.

**Context:** Decided during 2026-03-13 implementation review. The API shape is:
`host.mountApp("/path", plugin, { provides: ["auth", "db"] })`. Start in
`packages/fresh/src/app.ts` near `mountApp()` (line ~415). Tests were written
first — see `packages/fresh/tests/plugin_requirements_test.ts`.

**Depends on:** Nothing (design decided — just needs implementation).

---

## 2. Update `packages/init` and `packages/update` for `@freak/core`

**What:** `packages/init/src/init.ts` (lines 92, 578) still fetches the
`@fresh/core` version from JSR and scaffolds new projects with
`"fresh": "jsr:@fresh/core@^..."`. Users running `@fresh/init` get a plain
upstream Fresh project, not a Freak project.

**Why:** Once `@freak/core` is published on JSR, new users will try
`deno run -Ar jsr:@fresh/init` expecting a Freak scaffold, and instead get the
upstream Fresh starting point. This breaks first-user onboarding completely.

**Pros:** Fixes the new-project creation path end-to-end. Gives new users the
correct `@freak/core` import map entry from day one.

**Cons:** Requires `@freak/core` to be published on JSR first — can't scaffold
with a version that doesn't exist. Also needs `packages/update/src/update.ts`
(line 100) updated in parallel.

**Context:** Discovered during 2026-03-13 implementation review. The fix is a
find-and-replace in init.ts + update.ts — straightforward once the JSR package
is live. Blocked by JSR publish.

**Depends on:** `@freak/core` being published to JSR.

---

## 3. Add doc example compilation checks for new docs

**What:** Extend `tools/check_docs.ts` to include code blocks from
`docs/latest/concepts/effect-integration.md` and
`docs/latest/migration/index.md` in the automated doc-example test run.

**Why:** Both new docs contain TypeScript code blocks that users will copy-paste
directly. Broken examples erode trust and generate bug reports. The tooling to
check them already exists (`deno task check:docs`) — this is purely a coverage
extension.

**Pros:** Catches broken examples in CI before users hit them. Zero new
infrastructure needed.

**Cons:** Some code blocks in the migration guide are aspirational (they show
`@freak/core` specifiers that don't exist on JSR yet). Those blocks need
`// @skip` or equivalent markers to prevent false-positive failures until the
package is published.

**Context:** Discovered during 2026-03-13 implementation review. See
`tools/check_docs.ts` for the existing pattern. Add the two new doc files to
the same list as the other checked docs.

**Depends on:** Nothing technically — but aspirational code blocks should get
skip markers before enabling, or the check will fail in CI.
