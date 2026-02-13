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

  const topLevelDecls = new Map<string, ts.Node>()
  const imports = new Map<string, ts.ImportDeclaration>()

  function collectNames(name: ts.BindingName, node: ts.Node) {
    if (ts.isIdentifier(name)) {
      topLevelDecls.set(name.text, node)
    } else if (
      ts.isObjectBindingPattern(name) ||
      ts.isArrayBindingPattern(name)
    ) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) {
          collectNames(element.name, node)
        }
      }
    }
  }

  // First pass: collect all top-level declarations and imports
  ts.forEachChild(sourceFile, node => {
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        collectNames(decl.name, node)
      }
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      topLevelDecls.set(node.name.text, node)
    } else if (ts.isClassDeclaration(node) && node.name) {
      topLevelDecls.set(node.name.text, node)
    } else if (ts.isEnumDeclaration(node) && node.name) {
      topLevelDecls.set(node.name.text, node)
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      topLevelDecls.set(node.name.text, node)
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      topLevelDecls.set(node.name.text, node)
    } else if (ts.isImportDeclaration(node)) {
      const importClause = node.importClause
      if (importClause) {
        if (importClause.name) {
          imports.set(importClause.name.text, node)
        }
        if (importClause.namedBindings) {
          if (ts.isNamedImports(importClause.namedBindings)) {
            for (const specifier of importClause.namedBindings.elements) {
              imports.set(specifier.name.text, node)
            }
          } else if (ts.isNamespaceImport(importClause.namedBindings)) {
            imports.set(importClause.namedBindings.name.text, node)
          }
        }
      }
    }
  })

  const includedNodes = new Set<ts.Node>()
  const includedImports = new Set<ts.ImportDeclaration>()
  const visitedIdentifiers = new Set<string>()

  function trace(identifier: string) {
    if (visitedIdentifiers.has(identifier)) return
    visitedIdentifiers.add(identifier)

    const decl = topLevelDecls.get(identifier)
    if (decl) {
      includedNodes.add(decl)
      traceNode(decl)
    }

    const imp = imports.get(identifier)
    if (imp) {
      includedImports.add(imp)
    }
  }

  function traceNode(node: ts.Node) {
    ts.forEachChild(node, child => {
      if (ts.isIdentifier(child)) {
        // Skip property names in property access or object literals
        const parent = child.parent
        if (ts.isPropertyAccessExpression(parent) && parent.name === child) {
          return
        }
        if (ts.isPropertyAssignment(parent) && parent.name === child) {
          return
        }
        if (ts.isMethodDeclaration(parent) && parent.name === child) {
          return
        }
        if (ts.isClassDeclaration(parent) && parent.name === child) {
          return
        }
        if (ts.isFunctionDeclaration(parent) && parent.name === child) {
          return
        }

        trace(child.text)
      } else {
        traceNode(child)
      }
    })
  }

  // Find the config declaration
  const configNode = topLevelDecls.get('config')
  if (configNode) {
    includedNodes.add(configNode)
    traceNode(configNode)
  }

  // Generate the extracted code
  const result: string[] = []

  // Maintain order by iterating over sourceFile.statements
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (includedImports.has(statement)) {
        result.push(statement.getFullText(sourceFile).trim())
      }
    } else if (includedNodes.has(statement)) {
      result.push(statement.getFullText(sourceFile).trim())
    }
  }

  let finalConfig = result.join('\n\n')

  if (
    !topLevelDecls.has('config') &&
    !finalConfig.includes('export const config')
  ) {
    finalConfig += '\n\nexport const config = {}'
  }

  // Write extracted config to file
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
