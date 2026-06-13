import {SelectorNode} from './analyze'

export function generatePrepare(selectors: SelectorNode): string {
  let depth = 0
  let varCount = 0

  function compileNode(node: SelectorNode, accessPath: string): string[] {
    const lines: string[] = []

    for (const [key, value] of Object.entries(node)) {
      if (key === '__args' || key === '__isList') continue

      const isIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
      const base = isIdentifier
        ? `${accessPath}?.${key}`
        : `${accessPath}?.[${JSON.stringify(key)}]`

      if (value === true) {
        lines.push(`${base};`)
        continue
      }

      const branches = Array.isArray(value) ? value : [value]

      for (const branch of branches) {
        let nodeAccess = base

        if (typeof branch === 'object' && branch !== null) {
          if (branch.__args !== undefined) {
            nodeAccess += `?.(${branch.__args})`
          }

          if (branch.__isList) {
            depth++
            const iter = `i${depth}`
            const sub = compileNode(branch as any, iter)
            if (sub.length === 0) {
              lines.push(`${nodeAccess};`)
            } else {
              lines.push(`${nodeAccess}?.map(${iter} => { ${sub.join(' ')} });`)
            }
            depth--
            continue
          }

          const childKeys = Object.keys(branch).filter(
            k => k !== '__args' && k !== '__isList'
          )

          if (childKeys.length > 1 || (childKeys.length > 0 && branch.__args !== undefined)) {
            const varName = `v${++varCount}`
            lines.push(`const ${varName} = ${nodeAccess};`)
            lines.push(...compileNode(branch as any, varName))
            continue
          } else if (childKeys.length > 0) {
            lines.push(...compileNode(branch as any, nodeAccess))
            continue
          }
        }

        lines.push(`${nodeAccess};`)
      }
    }

    return lines
  }

  const internals = compileNode(selectors, 'query')
  if (internals.length === 0) return `({ query }) => {}`

  return `({ query }) => { ${internals.join(' ')} }`
}
