# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's **Report a
vulnerability** button on the repository's Security tab, rather than opening a
public issue.

Include what you did, what happened, and what you expected. A proof of concept
helps. You will get an acknowledgement, and a fix or an explanation of why the
behaviour is intended.

This is a small project without a paid security team, so please allow reasonable
time before public disclosure.

## What this software does on your machine

Review Workspace is a local daemon. Understanding its four points of contact
with your system is the fastest way to judge whether a report matters.

**It executes processes you approved.** Trusted gates run real commands. They
are spawned with `shell: false` and an explicit argument vector, so there is no
shell interpolation, and they run with an environment allowlist, an output cap,
and a timeout. Definitions are stored outside the observed worktree and pinned by
hash. A repository may *propose* gates via `.review-workspace-gates.json`, but a
proposal is inert until a human approves it — this is the boundary that stops a
malicious branch from running code by being cloned.

**It reads agent transcript files.** Those files can contain whatever was said to
or by an agent, including secrets a user pasted into a chat and credentials that
appeared in tool output. Review Workspace reads only the working directory and
turn-boundary markers, and puts neither message content, tool output, nor the raw
transcript path into its snapshots or its API. Treat any change that widens what
the agent channel reads or exposes as security-relevant.

**It runs Git against your repositories.** Inspection is read-only and
non-mutating, including conflict detection, which uses `merge-tree` rather than
an actual merge. Worktrees are never deleted implicitly.

**It serves a local HTTP API.** The server binds to `127.0.0.1` only. There is no
authentication, because the trust boundary is the loopback interface. CORS is
restricted to loopback origins. The `--lan` flag is deliberately refused: exposing
this daemon to a network needs pairing, lockout, and device revocation, and none
of that is implemented.

## Things that are in scope

- Executing a gate that was never approved, or executing a definition that
  differs from the approved one.
- Escaping the argument vector into a shell.
- Message content, tool output, or other transcript payload leaking into the
  API, the snapshot, or the UI.
- Path traversal out of the static asset root or an observed worktree.
- Any mutation of an observed repository, including a stray commit, checkout,
  reset, or worktree removal.
- Reaching the API from off-host in a default configuration.
- A merge-readiness claim that reports `ready` for a branch Git says conflicts.

## Things that are not vulnerabilities

- Anything requiring an attacker who already has your user account. A local
  daemon cannot defend against that.
- The absence of authentication on `127.0.0.1`. That is the design.
- A gate you approved doing something destructive. Approval is the control, and
  the definition is shown before you approve it.
- Reading transcripts from your own home directory. That is the feature.
- `unknown` agent state when a transcript format changes. Declining to guess is
  intended behaviour.

## Supported versions

Pre-1.0. Fixes land on the default branch; there are no maintained release
branches yet.
