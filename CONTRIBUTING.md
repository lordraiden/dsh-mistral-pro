# Contributing

Thanks for helping improve `dsh-mistral-pro`. This repository is a fork of
[`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro) with its own release line, so
two things work differently from a normal fork: **upstream changes are cherry-picked, never merged**, and **version
numbers are not comparable between the two repositories**. Read both policies before opening a pull request.

## Lineage

| Version | Repository | Notes |
| --- | --- | --- |
| `0.1.2` | [`01NGVI-QINGYI/dsh-mistral-pro`](https://github.com/01NGVI-QINGYI/dsh-mistral-pro) | Upstream. `main` is a single commit (`263a4f0`) and has no tags. |
| `0.1.3`–`0.1.8` | [upstream issue #1](https://github.com/01NGVI-QINGYI/dsh-mistral-pro/issues/1) | Field-hardened patch series that is **not merged upstream**. |
| `0.2.0`–`0.2.4` | [`santera-pixel/dsh-mistral-pro`](https://github.com/santera-pixel/dsh-mistral-pro) | Independent fix lineage on top of `0.1.2`. |
| `0.3.0` | this repository | Merge of the `santera-pixel` lineage and the upstream issue #1 patch series. |
| `0.4.0` | this repository | Current release line. |

```
01NGVI-QINGYI 0.1.2 (263a4f0)
├── santera-pixel 0.2.0 … 0.2.4
└── upstream issue #1 patch series 0.1.3 … 0.1.8
        └── this fork 0.3.0 → 0.4.0
```

The fork's `0.x` and upstream's `0.x` are **independent version lines**. They share a starting point (`0.1.2`) and
nothing else; do not assume that a higher number means a newer tree, or that a version range spans both.

## Working on a change

- Branch from `main`: `git switch main && git pull --ff-only && git switch -c fix/<topic>`.
- One issue per branch and per pull request. Keep the diff focused; unrelated cleanups belong in their own PR.
- Run both checks before pushing:

  ```sh
  npm test        # every suite in test/, against local mock servers
  npm run check   # node --check on index.js, client.js and lib/*.js
  ```

  CI runs the same two commands on Node 22 and 24. The `@deepseek-ai/*` packages are host-provided peer
  dependencies, never runtime dependencies of this package.
- Commit messages in English, imperative mood, with the issue number when there is one
  (`fix(transport): pin the serialized body (#8)`).
- Open the pull request against `main`. Do not merge your own PR and do not push to `main`.

## Upstream sync

### 1. Add the upstream remote (once per clone)

```sh
git remote add upstream https://github.com/01NGVI-QINGYI/dsh-mistral-pro
git remote -v
```

`git remote -v` must show `origin` (your fork or this repository) and `upstream` (the original project). If
`upstream` is already listed, skip the `add`.

### 2. Fetch and inspect

```sh
git fetch upstream --depth=50
git log --oneline upstream/main
git diff main...upstream/main --stat
```

Upstream `main` is a single commit (`263a4f0`, version `0.1.2`), so a shallow fetch is enough. Increase `--depth`
only if upstream history grows. `git log upstream/main` is the source of truth for what is new; do not rely on
upstream's version number (see [Version policy](#version-policy)).

### 3. Merge policy: cherry-pick fixes, never merge upstream `main`

**Never merge upstream `main` into this repository.** A wholesale merge would replay the `0.1.2` tree over the
`0.2.x`/`0.3.0` work and revert it: the fork's native `node:https` transport, per-role wire-key allowlist,
`advanced.promptCacheKey` modes, tool-call accumulation, retry-policy shape and attempt-state fix do not exist
upstream. Git would either resolve in favour of the old tree or produce a large conflict set that is easy to
resolve wrongly. For the same reason, never merge this fork into upstream.

Upstream changes arrive as **concrete commits, cherry-picked one at a time**:

```sh
git switch main
git pull --ff-only
git switch -c fix/<topic>
git cherry-pick <upstream-sha>
npm test && npm run check
git push -u origin fix/<topic>
```

Rules for a cherry-pick:

- Read the diff first (`git show <upstream-sha>`). Pick only fixes that solve a problem this fork still has, and
  check whether the fork already fixed it a different way.
- Resolve conflicts in favour of the fork's structure (`advanced.promptCacheKey`, the `node:https` transport,
  `WIRE_KEYS`, the flattened retry policy), not by replacing whole files with the upstream version.
- Drop any upstream change that reintroduces removed behaviour, such as `cache.promptCacheKey` or a default cache
  key derived from hostname/user.
- One cherry-pick, or one coherent group, per PR. Name the upstream commit SHA in the PR body.
- The upstream issue #1 patch series (`0.1.3`–`0.1.8`) was applied this way for `0.3.0`; use it as the reference
  for how a series is recorded.

### 4. Record the sync

Every sync gets a `CHANGELOG.md` entry under the next version, in an `Upstream sync` subsection:

```markdown
### Upstream sync

- Cherry-picked `01NGVI-QINGYI/dsh-mistral-pro@<sha>`: <one-line description>.
- Skipped `<sha>`: <reason>.
- Reference: [upstream issue #1](https://github.com/01NGVI-QINGYI/dsh-mistral-pro/issues/1).
```

The entry must name the upstream repository, the commit SHAs, and what was deliberately not taken. A sync without
an entry is undocumented. `CHANGELOG.md` also links the intermediate fork
[`santera-pixel/dsh-mistral-pro`](https://github.com/santera-pixel/dsh-mistral-pro).

## Version policy

This fork's `0.x` is independent of upstream's `0.x`. **Do not compare, align, or merge by version number.**

- Upstream is at `0.1.2`; the issue #1 series proposes `0.1.3`–`0.1.8`. Under semver ordering, an upstream
  `0.1.3` sorts **below** this fork's `0.3.0`.
- A version-based merge, `npm update`, or "take whichever is newer" is therefore misleading: it treats the fork as
  ahead and silently skips upstream fixes, or treats an upstream `0.1.x` as a downgrade target.
- The fork's version only describes the fork's own release history:
  `0.1.2` → `0.2.0`–`0.2.4` (intermediate fork) → `0.3.0` → `0.4.0`.

Bump rules:

- **Minor** (`0.3.0` → `0.4.0`) for behaviour changes: new settings, changed defaults, changed request shape,
  removed features.
- **Patch** (`0.4.0` → `0.4.1`) for fixes that keep behaviour and configuration compatible.
- Bump `package.json` and the version badges in `README.md`, `README.zh.md` and `README.ja.md` in the same PR.
- **Never rewrite a published tag.** If a release is wrong, ship the next patch.
- Do not renumber this fork to match upstream, and do not adopt upstream's version as a baseline.

## Release checklist

1. `npm test` and `npm run check` pass on Node 22 and 24 (CI runs both).
2. `package.json` version and the three README badges agree.
3. `CHANGELOG.md` has an entry for the version, including any upstream sync.
4. Commit, tag `v<version>`, push the commit and the tag.
5. Never move or delete a tag that was already published.

## License

By contributing you agree that your changes are released under the MIT license (see [LICENSE](LICENSE)).
