# pylon eval — usefulness bench

A/B harness that measures whether an agent does better **with** the Pylon MCP than
without. Same task, same model, two arms (`with-mcp` / `baseline`), scored by the same
`pylon verify` verdict an agent would trust.

## Run it

```bash
# one-time: the harness drives a headless Claude via the Agent SDK
pnpm add -D @anthropic-ai/claude-agent-sdk      # (uses your existing Claude auth)

pylon eval                  # runs every scenario in ./bench, prints an A/B table
pylon eval --json           # machine-readable report
pylon eval --keep           # leave run workdirs (under <app>/.eval-runs) for debugging
```

Without the SDK installed the command still runs and reports the missing-SDK error per
row, so the wiring is verifiable offline (and `vitest run test/eval-harness.test.ts`
exercises the full copy→run→score→aggregate plumbing with a fake runner).

## A scenario

One subfolder per task, each holding a `scenario.json`:

```json
{
  "name": "add-author-bio",
  "base": "../../e2e/fixtures/mcp-demo-app",
  "prompt": "Add an optional `bio` field to Author, then verify clean.",
  "expect": { "verdict": "pass", "entityHasField": ["Author", "bio"], "migrationCreated": true }
}
```

- `base` — the starting app, copied fresh per run (resolved relative to `scenario.json`).
- `expect` — declarative success check: required `verdict`, an `[entity, field]` that must
  exist, and/or `migrationCreated`. Success = all expectations hold.

## Growing the bank

Per the design (dd/MCP_IR_TARGET.md §9, R7), the bench should grow to **15–20
intentionally-broken apps** — missing migration, broken FK, drifted schema, mismatched
queue payload, widened authz — so usefulness and reasoning-path **regressions** become
hard numbers, not intuition. Drop a new folder with a `scenario.json` to add one.
