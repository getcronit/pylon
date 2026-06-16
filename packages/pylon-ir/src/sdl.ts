/**
 * GraphQL projection: PylonIR → SDL. A pure function of the IR. It never walks
 * TypeScript types or asks "isList?" — every such question was answered once,
 * during IR construction, and is read straight off the object here.
 */
import type {Field, InterfaceType, Operation, PylonIR, TypeRef} from './ir.js'

/** Render a normalized type reference as GraphQL type syntax. */
export function renderType(t: TypeRef): string {
  const bang = t.nullable ? '' : '!'
  if (t.kind === 'list') return `[${renderType(t.of)}]${bang}`
  return `${t.name}${bang}`
}

/** A GraphQL description block. Header-level uses no indent; field-level 2. */
function renderDescription(description: string | undefined, indent: string): string {
  if (!description) return ''
  return `${indent}"""\n${indent}${description}\n${indent}"""\n`
}

function renderField(f: Field): string {
  return `${renderDescription(f.description, '  ')}  ${f.name}${renderArgs(
    f.args ?? []
  )}: ${renderType(f.type)}`
}

function renderArgs(args: Field[]): string {
  if (args.length === 0) return ''
  const inner = args.map(a => `${a.name}: ${renderType(a.type)}`).join(', ')
  return `(${inner})`
}

function renderOperation(op: Operation): string {
  return `${renderDescription(op.description, '  ')}  ${op.name}${renderArgs(
    op.args
  )}: ${renderType(op.returns)}`
}

function renderImplements(impl: string[] | undefined, dropped: Set<string>): string {
  const kept = (impl ?? []).filter(n => !dropped.has(n))
  if (kept.length === 0) return ''
  const sorted = [...kept].sort((a, b) => a.localeCompare(b))
  return ` implements ${sorted.join(' & ')}`
}

function renderInterface(i: InterfaceType, dropped: Set<string>): string {
  const fields = i.fields.filter(f => f.exposed)
  return `${renderDescription(i.description, '')}interface ${i.name}${renderImplements(
    i.implements,
    dropped
  )} {\n${fields.map(renderField).join('\n')}\n}`
}

function renderObjectType(
  name: string,
  fields: Field[],
  opts: {implements?: string[]; description?: string},
  dropped: Set<string>
): string {
  const exposed = fields.filter(f => f.exposed)
  return `${renderDescription(opts.description, '')}type ${name}${renderImplements(
    opts.implements,
    dropped
  )} {\n${exposed.map(renderField).join('\n')}\n}`
}

/** Project an IR to a GraphQL SDL string. */
export function toSDL(ir: PylonIR): string {
  const blocks: string[] = []

  // A GraphQL interface MUST declare ≥1 field — an empty interface is invalid
  // SDL (it parses to a syntax error). The ORM's `Model` base, whose members are
  // all excluded, produces exactly such an empty interface. Drop empties here
  // and strip them from every `implements` clause.
  const dropped = new Set(
    Object.values(ir.interfaces)
      .filter(i => i.fields.filter(f => f.exposed).length === 0)
      .map(i => i.name)
  )

  // Root operation types, grouped by root.
  for (const root of ['Query', 'Mutation', 'Subscription'] as const) {
    const ops = ir.operations.filter(o => o.root === root)
    if (ops.length === 0) continue
    blocks.push(`type ${root} {\n${ops.map(renderOperation).join('\n')}\n}`)
  }

  // Entities (persisted object types). Skip ones with no exposed fields.
  for (const e of Object.values(ir.entities)) {
    if (e.fields.filter(f => f.exposed).length === 0) continue
    blocks.push(renderObjectType(e.name, e.fields, {implements: e.implements}, dropped))
  }

  // Plain object types (DTOs, json shapes) — no persistence, no ORM needed.
  for (const o of Object.values(ir.objects)) {
    if (o.fields.filter(f => f.exposed).length === 0) continue
    blocks.push(
      renderObjectType(
        o.name,
        o.fields,
        {implements: o.implements, description: o.description},
        dropped
      )
    )
  }

  // Input objects (GraphQL requires at least one field).
  for (const input of Object.values(ir.inputs)) {
    const fields = input.fields.length
      ? input.fields.map(renderField).join('\n')
      : '  _: String'
    blocks.push(`${renderDescription(input.description, '')}input ${input.name} {\n${fields}\n}`)
  }

  // Unions.
  for (const u of Object.values(ir.unions)) {
    blocks.push(`${renderDescription(u.description, '')}union ${u.name} = ${u.members.join(' | ')}`)
  }

  // Interfaces — skip empties (invalid SDL); they were stripped from implements.
  for (const i of Object.values(ir.interfaces)) {
    if (dropped.has(i.name)) continue
    blocks.push(renderInterface(i, dropped))
  }

  // Scalars.
  for (const s of ir.scalars) blocks.push(`scalar ${s}`)

  // Enums.
  for (const en of Object.values(ir.enums)) {
    blocks.push(
      `${renderDescription(en.description, '')}enum ${en.name} {\n${en.values
        .map(v => `  ${v}`)
        .join('\n')}\n}`
    )
  }

  return blocks.join('\n\n') + '\n'
}
