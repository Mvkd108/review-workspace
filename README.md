# Review Workspace

Review Workspace is a local-first desktop browser for understanding coding-agent
work across Git worktrees. It ranks work by concrete review reasons, runs trusted
host-owned gates, and explains whether a branch is ready to merge.

This repository is implementing **Phase 0a: the repo channel**. It observes
worktrees created by Codex, Claude Code, Cursor, or any other tool without
requiring an agent integration.

## Agent start here

Read [`context/README.md`](context/README.md) before exploring the implementation.
It records the current state, decisions, and exact next step for a fresh session.

## Local development

```powershell
pnpm install
pnpm build
pnpm test
pnpm start -- --data-dir .review-workspace
```

Then open `http://127.0.0.1:4317`. The CLI binds to localhost by default.

## Principles

- Git and trusted gates are authoritative.
- Risk numbers stay internal; the interface shows levels and evidence.
- Existing worktrees are never deleted implicitly.
- Agent control and generated UI remain gated on Phase 0a usage evidence.

Licensed under Apache-2.0.
