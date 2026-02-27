# Phase 11: Micro-App Architecture - Context

**Gathered:** 2026-02-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Investigate the root cause of `mountApp` failures in Freak, evaluate three composition
models (fix mountApp / programmatic plugin pattern / Module Federation), and produce a
documented architectural decision with rationale. Code implementation is out of scope
for this phase — a follow-on phase handles that.

The real-world target: the `../platform` project that already mounts `../workflows` and
`../authend` as sub-apps, and needs to support user-created third-party plugins in the
future.

</domain>

<decisions>
## Implementation Decisions

### Outcome
- Deliverable is a **decision doc + rationale** — not working code
- If the decision is "fix mountApp", implementation belongs in a follow-on phase
- Doc lives in `.planning/phases/11-micro-app-architecture/` (internal notes format, not formal ADR)

### Known failure modes
- Failures are **intermittent** — depend on conditions, not always broken
- Observed failure categories: islands not hydrating, routes not resolving, shared state / context leaks
- **Primary failure trigger: shared state between apps** — this is the core problem to diagnose
- The platform project is a real production scenario (not theoretical), so the researcher
  should look at `../platform`, `../workflows`, and `../authend` as concrete evidence

### Module Federation appetite
- MF is a **genuine option** — not just due diligence
- Separate builds per sub-app are acceptable if that's what MF requires
- Key criterion for MF adoption: **shared state / context isolation** across app boundaries
- Build tool (esbuild) is **not a hard constraint** — if MF requires Vite, that's on the table
- Researcher should evaluate MF in a Deno context (not assume Webpack/Vite defaults apply)

### Composition model
- Evaluate all three options with equal rigor:
  1. **Fix mountApp** — correct the existing abstraction
  2. **Programmatic plugin pattern** — explicit registration, sub-apps as self-describing plugins
  3. **Module Federation** — true runtime composition, separate builds
- For each option: research effort, complexity, gains, pitfalls
- Correctness and isolation take priority over developer ergonomics
- Both technical developers (own repo/build) and lower-friction contributors are target
  plugin authors — the model must support a range

### Claude's Discretion
- How to structure the comparison (table, prose, scorecard) — whatever makes the
  decision most durable as internal notes
- Which specific Freak/Fresh internals to probe during root cause analysis

</decisions>

<specifics>
## Specific Ideas

- Primary target: `../platform` project (already using `mountApp` with `../workflows`
  and `../authend` as sub-apps) — researcher should examine this codebase directly
- The long-term vision is **user-created plugins** for the platform: third parties
  developing and installing capabilities, from technical developers to lower-friction contributors
- Both MF (https://github.com/module-federation/vite#readme) and Fresh's existing
  `mountApp` are known quantities — researcher should check actual source, not assumptions

</specifics>

<deferred>
## Deferred Ideas

- Plugin authoring DX / scaffolding tool — belongs in a follow-on phase after the
  composition model is decided
- Plugin marketplace / discovery — future phase
- Low-code plugin authoring (drop-in without Fresh knowledge) — depends on composition
  model decision; follow-on

</deferred>

---

*Phase: 11-micro-app-architecture*
*Context gathered: 2026-02-27*
