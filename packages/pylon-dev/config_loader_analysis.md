# Analysis of Pylon Config Loader

The current configuration loading approach in `pylon-dev` consists of two main parts:

1. **Extraction**: `extractConfig` parses the entry file (`src/index.ts`) using the TypeScript AST to find an `export const config` statement and copies all `import` statements. It then bundles this into `.pylon/config.js` using `esbuild`.
2. **Injection**: `injectCodePlugin` modifies the entry file during the main build to import `.pylon/config.js` and call `executeConfig`.

## Pinpointed Issues

### 1. Hot-Reloading Failure (Critical)

The configuration is extracted only once when the `Bundler` is initialized. During `dev` mode, although the main bundle is watched and rebuilt, the `extractConfig` function is **not** called again.

- **Effect**: If a user updates the `config` object in `src/index.ts` (e.g., adding a plugin or changing a setting), the change is not reflected in `.pylon/config.js`. The dev server and the running app will continue to use the stale configuration until the dev server is restarted.

### 2. Brittle AST Analysis

The `extractConfig` logic relies on a very specific syntax pattern:

```typescript
ts.isVariableStatement(node) &&
  node.declarationList.declarations.length > 0 &&
  ts.isIdentifier(declaration.name) &&
  declaration.name.text === 'config'
```

- **Effect**: It fails to detect configuration if it's:
  - Exported using `export { myConfig as config }`.
  - Imported from another file and re-exported.
  - Exported as a `default` export.
  - Defined using `let` or `var` (though `const` is best practice, the tool shouldn't silently fail).

### 3. Variable Isolation & Scope Issues

It uses `declaration.initializer.getText(sourceFile)` to extract the config value.

- **Effect**: If the `config` object refers to any local variables defined in `src/index.ts` that are not part of the imports, the extracted config will be broken.
  - **Example**:
    ```typescript
    const port = 3000
    export const config = {port}
    ```
    The extracted file will contain `export const config = { port }`, but `port` will be undefined because the `const port = 3000` line was not copied.

### 4. Over-importing & Side Effects

`extractConfig` copies **every single import statement** from `src/index.ts` into `.pylon/config.js`.

- **Effect**:
  - **Performance**: The configuration bundle becomes unnecessarily large.
  - **Side Effects**: If any imported module has side effects (e.g., initializing a database connection, starting a logger), those side effects will execute when `pylon-dev` loads the config, and again when the runtime loads the config.
  - **Environment Incompatibility**: Imports that only work in a browser or specific Node environment might crash the Pylon CLI if it tries to load the config in a different context.

### 5. Circular Dependency & Architectural Confusion

The entry file defines the config, which is then extracted to a separate file, which is then imported back into the entry file via an injection plugin.

- **Effect**: This creates a confusing dependency graph. The bundled `index.js` essentially contains the config logic twice (once in the original code and once via the import of `.pylon/config.js`).

### 6. Hardcoded Entry Point

The system is hardcoded to look for the configuration in `./src/index.ts`.

- **Effect**: Users cannot follow standard conventions like using a dedicated `pylon.config.ts` or `pylon.config.js` file at the root of the project.

### 7. Telemetry Reliability

The telemetry system (`analytics.ts`) uses the same `.pylon/config.js` file to report usage statistics.

- **Effect**: If the config extraction fails or produces a broken file (due to the variable isolation issue), telemetry will also fail, leading to lost or corrupted analytics data.

## Recommendations for Improvement

- **Dedicated Config File**: Support `pylon.config.ts` as the primary source of truth, separate from application logic.
- **Esbuild-based Extraction**: Instead of manual AST parsing and string concatenation, use `esbuild` with a virtual entry point that imports `config` from the source file. This handles all export styles and dependencies correctly.
- **Watch Integration**: Ensure the config extraction is part of the watch loop in `dev` mode.
- **Dynamic Plugin Loading**: Refactor the plugin system to allow reloading or re-initializing plugins when the configuration changes without a full process restart.
