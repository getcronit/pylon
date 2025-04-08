import esbuild from 'esbuild'
import {readFileSync} from 'fs'
import {dirname, resolve} from 'path'
import ts from 'typescript'

/**
 * Extracts the `config` export from a TypeScript file and writes it to `.pylon/config.js`
 * @param inputFile The path to the source file (e.g., `server.ts`)
 * @param outputFile The path to save the extracted config (default: `.pylon/config.js`)
 */
export async function extractConfig(
  inputFile: string,
  outputFile: string = '.pylon/config.js'
) {
  const filePath = resolve(inputFile)
  const source = readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ESNext,
    true
  )

  let configCode = ''
  const importStatements: string[] = []

  // Iterate over the AST nodes
  ts.forEachChild(sourceFile, node => {
    // Collect import statements
    if (ts.isImportDeclaration(node)) {
      const importText = node.getFullText(sourceFile).trim()
      importStatements.push(importText)
    }

    // Find `export const config = {...}`
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.length > 0
    ) {
      const declaration = node.declarationList.declarations[0]
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'config' &&
        declaration.initializer
      ) {
        configCode = `export const config = ${declaration.initializer.getText(
          sourceFile
        )}`
      }
    }
  })

  if (!configCode) {
    configCode = 'export const config = {}'
  }

  // Write extracted config to file
  const finalConfig = [...importStatements, configCode].join('\n\n')

  await esbuild.build({
    stdin: {
      contents: finalConfig,
      resolveDir: dirname(filePath),
      sourcefile: filePath,
      loader: 'ts'
    },
    bundle: true,
    format: 'esm',
    outfile: outputFile,
    packages: 'external'
  })
}
