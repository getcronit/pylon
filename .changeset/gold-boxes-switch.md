---
'@getcronit/pylon-dev': major
---

- Integrated `@getcronit/pylon-builder` directly into `@getcronit/pylon-dev`.
  - Removed the `pylon-builder` package.
  - The builder now utilizes the `esbuild` watch mode for development. This is a much faster and more efficient way to build the project.
- Implemented `pm2` for process management:
  - `pm2` is now used to manage the `pylon-dev` server. After files are built, the server is restarted automatically.
  - The stdout and stderr logs are logged directly with `consola`.
- Now builds a cross-environment client in `.pylon/client` using `gqty`. This will be used for pylon/pages.

### Breaking Change: Removed Client Generation Feature

- **What**: The client generation feature has been removed.
- **Why**: We have decided to use `gqty` directly to streamline the development process and reduce complexity.
- **How to Update**: Consumers should now use the [GQty CLI](https://gqty.dev/api-reference/cli#basic-usage) directly to generate their clients. Update your build scripts and development workflows to integrate `gqty` as described in the GQty documentation.
