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

  // The prepare runs as a CLOSURE inside the component, so its body references the
  // component's locals via the copied field-ARGUMENT expressions (`__args`). The
  // injected root param must NOT shadow an identifier those args use: a component
  // variable named `query` passed as an arg (e.g. `data.posts({ query })`) bound by
  // a `({ query }) =>` param to the gqty root proxy instead of the user's value —
  // which then gets select-all'd (schema-cycle depth blowups) and is non-cloneable
  // (multipart `structuredClone` crash). Use a reserved-style root name no user
  // identifier collides with (`__args` is the only place user identifiers reach the
  // body — everything else is schema field names + generated `i*`/`v*`).
  const ROOT = '__pylonQuery'
  const internals = compileNode(selectors, ROOT)
  if (internals.length === 0) return `() => {}`

  return `({ query: ${ROOT} }) => { ${internals.join(' ')} }`
}
