import ts from 'typescript'

function importedNames(clause: ts.ImportClause): string[] {
  const out: string[] = []
  if (clause.name) out.push(clause.name.text)
  const nb = clause.namedBindings
  if (nb) {
    if (ts.isNamedImports(nb)) for (const e of nb.elements) out.push(e.name.text)
    else if (ts.isNamespaceImport(nb)) out.push(nb.name.text)
  }
  return out
}

/**
 * Produce a side-effect-free view of a Pylon entry, for loading ORM models
 * without running the app.
 *
 * The build needs the model metadata (which only exists once the entry's
 * `new Pylon({db: {models}})` constructs and registers them), but importing the
 * entry would also run its top-level `serve(app)` / `Deno.serve(...)`. So we keep
 * declarations + imports (whose side effects register the models) and drop:
 *   - top-level expression statements  (serve(app), Deno.serve(...), app.use(...))
 *   - the default export               (export default app)
 *
 * Those are exactly the per-runtime entrypoint forms, so this is runtime-
 * agnostic. Imports left fully unused by the drop (e.g. `serve` from
 * `@hono/node-server`, `app` from `@getcronit/pylon`) are pruned so the result
 * doesn't pull in server-only packages.
 */
export function prepareModelSource(source: string, fileName = 'entry.ts'): string {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )

  // The entry default-exports the app (`export default new Pylon(...)`). That
  // expression references the modules that REGISTER the models, and constructing it
  // is what runs the registration. Rewrite it to an EXPORTED `const __pylonEntry` so
  // the loader can read the app instance (`modelsOf`/`queuesOf`), the imports survive
  // (their side effects run), and no serve() lives here to start a server.
  const kept = sf.statements
    .map(s => {
      if (ts.isExportAssignment(s) && !s.isExportEquals) {
        return ts.factory.createVariableStatement(
          [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
          ts.factory.createVariableDeclarationList(
            [
              ts.factory.createVariableDeclaration(
                '__pylonEntry',
                undefined,
                undefined,
                s.expression
              )
            ],
            ts.NodeFlags.Const
          )
        )
      }
      return s
    })
    // Drop bare expression statements (e.g. a legacy top-level `serve(app)`).
    .filter(s => !ts.isExpressionStatement(s))

  // Identifiers referenced by the surviving non-import statements.
  const used = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) used.add(node.text)
    ts.forEachChild(node, visit)
  }
  for (const s of kept) if (!ts.isImportDeclaration(s)) visit(s)

  const final = kept.filter(s => {
    if (ts.isImportDeclaration(s) && s.importClause) {
      const names = importedNames(s.importClause)
      // Drop an import only if it binds names and none survive (keep bare
      // `import './x'` side-effect imports — they may register things).
      if (names.length > 0 && names.every(n => !used.has(n))) return false
    }
    return true
  })

  return ts
    .createPrinter()
    .printFile(ts.factory.updateSourceFile(sf, final))
}
