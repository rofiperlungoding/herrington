# Unit Tests

Pure-logic test suites. No JSDOM, no fake server, no React render — strictly functions in, assertions out.

These suites form the regression baseline for the project. The performance and redesign specifications (`performance-optimization`, `ui-redesign-tests-and-regression`) re-execute them unchanged through the default Vitest include glob.

---

## Layout

```
tests/unit/
├── db/
│   └── schema-indexes.spec.ts        Asserts the Drizzle schema declares
│                                     the indexes hot queries depend on
└── lib/
    └── date-format-local.spec.ts     Local-time formatter parity across
                                      timezone fixtures
```

## Running

```bash
npx vitest --run tests/unit
```

## Authoring Conventions

- Place strictly pure-logic specs here. Tests that render React belong in `tests/components/`. Tests that exercise `fetch` or a fake server belong in `tests/integration/`.
- Co-locate the spec with the code under test. Use `tests/unit/lib/` for `src/lib/` code, `tests/unit/db/` for schema-related logic, and so on.
- Prefer property-based assertions via `fast-check` (already a dev dependency) over single-example tests. Encode the invariant the function must preserve, not just one happy path.
- Avoid mocks unless the unit genuinely depends on an external system. Pure functions should not require them.
- Keep individual specs focused. One file per behavior is preferable to one omnibus file per directory.

## Related Suites

| Suite | Focus |
|---|---|
| `tests/components/` | Render-tested UI primitive states (focus rings, elevations, radii) |
| `tests/integration/` | Edge-function and React-Query integration paths |
| `tests/nonregression/` | MVP behavioral parity and streak invariants |
| `tests/tokens/` | Design-system token parity, contrast, type scale |
| `tests/shell/` | AppShell responsive behavior, sidebar, sign-out |

## Regression Contract

These tests are tracked under `ui-redesign-tests-and-regression` (Requirements 16.1–16.8). They define the baseline behavior the redesign and performance work must preserve. They must not be modified while landing changes from those specifications.
