import {SelectorNode} from './analyze'

export function generatePrepare(selectors: SelectorNode): string {
  let depth = 0

  function compileNode(node: SelectorNode, accessPath: string): string[] {
    const lines: string[] = []

    for (const [key, value] of Object.entries(node)) {
      if (key === '__args' || key === '__isList') continue

      const base = `${accessPath}.${key}`

      if (value === true) {
        lines.push(`${base};`)
        continue
      }

      if (Array.isArray(value)) {
        for (const branch of value) {
          let branchAccess = base
          if (branch.__args) {
            branchAccess += `(${branch.__args})`
          }

          if (branch.__isList) {
            depth++
            const iter = `i${depth}`
            const sub = compileNode(branch as any, iter)
            if (sub.length === 0) {
              lines.push(`${branchAccess};`)
            } else {
              lines.push(
                `${branchAccess}.map(${iter} => { ${sub.join(' ')} });`
              )
            }
            depth--
          } else {
            const sub = compileNode(branch as any, branchAccess)
            if (sub.length === 0) {
              lines.push(`${branchAccess};`)
            } else {
              lines.push(...sub)
            }
          }
        }
      } else if (typeof value === 'object') {
        let nodeAccess = base
        if (value.__args) {
          nodeAccess += `(${value.__args})`
        }

        if (value.__isList) {
          depth++
          const iter = `i${depth}`
          const sub = compileNode(value as any, iter)
          if (sub.length === 0) {
            lines.push(`${nodeAccess};`)
          } else {
            lines.push(`${nodeAccess}.map(${iter} => { ${sub.join(' ')} });`)
          }
          depth--
        } else {
          const sub = compileNode(value as any, nodeAccess)
          if (sub.length === 0) {
            lines.push(`${nodeAccess};`)
          } else {
            lines.push(...sub)
          }
        }
      }
    }

    return lines
  }

  const internals = compileNode(selectors, 'query')
  if (internals.length === 0) return `({ query }) => {}`

  return `({ query }) => { ${internals.join(' ')} }`
}
