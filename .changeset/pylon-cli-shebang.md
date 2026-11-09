---
'@getcronit/pylon': patch
---

Add the missing `#!/usr/bin/env node` shebang to the shipped `pylon` CLI.

`package.json` maps `bin: {pylon: "./dist/cli/index.js"}`, and on POSIX npm and yarn classic
link a bin as a bare symlink that relies on its shebang — only pnpm writes a `#!/bin/sh`
shim that invokes node itself. The CLI entry had no shebang, so under pnpm everything
worked (the monorepo, the e2e suite, existing projects) while an npm-installed project
could not run `pylon` at all:

    $ npm run build
    node_modules/.bin/pylon: line 1: import: command not found

That is the default path for `create-pylon` — its Node scaffold and Dockerfile both use npm
— so a freshly created project was dead on arrival for npm users. The whole e2e suite
missed it because every test spawns `node <abs path>/dist/cli/index.js`, which bypasses the
bin entirely; a new `cli-bin` e2e now execs the bin through an npm-shaped symlink instead.
