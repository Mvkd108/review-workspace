## What this changes

<!-- One paragraph. What behaviour is different afterwards? -->

## Why

<!-- The problem this solves. Link an issue if there is one. -->

## Evidence

<!--
How do you know it works? Test output, the Git command that agrees with a merge
claim, or what you saw in the app. "Builds clean" is not evidence of behaviour.
-->

## Checklist

- [ ] `pnpm typecheck`, `pnpm test`, and `pnpm build` pass
- [ ] A test covers the change, or the reason one does not is explained above
- [ ] `context/` updated if behaviour changed — `CURRENT.md`, and a dated note
      under `context/sessions/`
- [ ] No message content, tool output, or credentials added to snapshots or logs

## Design constraints

Confirm this change keeps these, or argue for the exception:

- [ ] Git and gate results remain authoritative for merge claims
- [ ] The agent channel observes rather than controls
- [ ] The numeric risk score stays out of the interface
- [ ] No registered worktree is deleted or mutated implicitly
