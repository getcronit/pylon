---
'@getcronit/pylon': minor
---

`pylon db` is now apps-only: one uniform migration path, and `db squash` cascade-rewrites
cross-app dependencies.

Every project is one or more apps. A project with composed apps runs each as a group; a plain
project is one implicit **default** app (every model, root `./migrations`, a BARE ledger — so an
existing history keeps applying unchanged, and its CLI output is unchanged). The separate
non-apps "root runner" code path is gone; every command — including `rollback`, `squash`,
`baseline`, `resolve`, `merge` — runs through the group layer.

- `db squash <--app>` squashes one app's history and **re-points** any sibling app's cross-app
  dependency tuple that named a collapsed migration to the squashed one, so the persisted graph
  never dangles. (Previously apps-mode squash was unreachable — it ran on the empty root dir.)
- Per-app tail commands require `--app` in a multi-app project; a single default-app project
  needs no flag.
