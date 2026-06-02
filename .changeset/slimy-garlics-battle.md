---
'create-pylon': patch
---

- Use `consola` for clearer interactive prompts and logs.
- Remove `--client`, `--client-path`, and `--client-port` flags in favor of [GQty CLI](https://gqty.dev/api-reference/cli#basic-usage)
- Improved package manager detection and dependency installation. https://github.com/getcronit/pylon/issues/73
- Removed `--template` flag in favor of `--features` flag. Each runtime can now support multiple features which pre-configure the project for different use-cases.
  Currently supported features:
  - `pages`: React SSR Pages with file-based routing
  - `auth`: OIDC Authentication (Primarily for ZITADEL but can be used with any OIDC provider)
- The success message now only shows the `deploy` script if it is available.
- Improved error handling and messaging.
