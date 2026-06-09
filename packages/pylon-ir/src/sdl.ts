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

function renderDescription(description: string | undefined, indent: string): string {
  if (!description) return ''
  return `${indent}"""\n${indent}${description}\n${indent}"""\n`
}

function renderField(f: Field): string {
  const args = ''
  return `${renderDescription(f.description, '  ')}  ${f.name}${args}: ${renderType(
    f.type
  )}`
}

function renderArgs(args: Field[]): string {
  if (args.length === 0) return ''
  const inner = args.map(a => `${a.name}: ${renderType(a.type)}`).join(', ')
  return `(${inner})`
}

function renderOperation(op: Operation): string {
  return `  ${op.name}${renderArgs(op.args)}: ${renderType(op.returns)}`
}

function renderImplements(impl: string[] | undefined): string {
  if (!impl || impl.length === 0) return ''
  const sorted = [...impl].sort((a, b) => a.localeCompare(b))
  return ` implements ${sorted.join(' & ')}`
}

function renderInterface(i: InterfaceType): string {
  const fields = i.fields.filter(f => f.exposed)
  return `interface ${i.name}${renderImplements(i.implements)} {\n${fields
    .map(renderField)
    .join('\n')}\n}`
}

/** Project an IR to a GraphQL SDL string. */
export function toSDL(ir: PylonIR): string {
  const blocks: string[] = []

  // Root operation types, grouped by root.
  for (const root of ['Query', 'Mutation', 'Subscription'] as const) {
    const ops = ir.operations.filter(o => o.root === root)
    if (ops.length === 0) continue
    blocks.push(`type ${root} {\n${ops.map(renderOperation).join('\n')}\n}`)
  }

  // Entities (persisted object types). Skip ones with no exposed fields.
  for (const e of Object.values(ir.entities)) {
    const fields = e.fields.filter(f => f.exposed)
    if (fields.length === 0) continue
    blocks.push(
      `type ${e.name}${renderImplements(e.implements)} {\n${fields
        .map(renderField)
        .join('\n')}\n}`
    )
  }

  // Plain object types (DTOs, json shapes) — no persistence, no ORM needed.
  for (const o of Object.values(ir.objects)) {
    const fields = o.fields.filter(f => f.exposed)
    if (fields.length === 0) continue
    blocks.push(
      `type ${o.name}${renderImplements(o.implements)} {\n${fields
        .map(renderField)
        .join('\n')}\n}`
    )
  }

  // Interfaces (rendered even when empty, matching GraphQL/Pylon).
  for (const i of Object.values(ir.interfaces)) {
    blocks.push(renderInterface(i))
  }

  // Scalars.
  for (const s of ir.scalars) blocks.push(`scalar ${s}`)

  // Enums.
  for (const en of Object.values(ir.enums)) {
    blocks.push(`enum ${en.name} {\n${en.values.map(v => `  ${v}`).join('\n')}\n}`)
  }

  return blocks.join('\n\n') + '\n'
}
