# Context index

This directory is the durable handoff for people and coding agents. Read it in
this order before inspecting the implementation:

1. `LAUNCH_CONTRACT.md` — the architecture freeze: names, authoritative states,
   performance targets, exclusions, and beta completion/failure criteria.
2. `PRODUCT.md` — why this exists and what is deliberately out of scope.
3. `CURRENT.md` — verified implementation state and limitations.
4. `DECISIONS.md` — architectural decisions that should not be rediscovered.
5. `NEXT.md` — ordered work with acceptance criteria.
6. The newest entry under `sessions/` — the exact continuation point.

## Handoff rule

After each coherent slice:

- Update `CURRENT.md` with behavior that was actually verified.
- Record durable choices in `DECISIONS.md`.
- Reorder `NEXT.md` rather than leaving stale tasks in place.
- Add or amend the dated session note with files changed, checks run, and the
  first recommended action for the next session.

`pnpm context:check` is advisory during development. Release validation may use
`pnpm context:check:strict`.
