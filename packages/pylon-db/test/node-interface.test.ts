/**
 * `toIR({node:true})` — the opt-in Relay `Node` interface + `node(id): Node`
 * refetch field, projected into the SDL.
 */
import {toSDL} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {Pylon} from '@getcronit/pylon'
import {Model, id, text} from '../src/index'
import {toIR} from '../src/ir'

class Author extends Model {
  id = id()
  name = text()
}

class Book extends Model {
  id = id()
  title = text()
}

new Pylon({db: {models: [Author, Book]}})

describe('Node interface (opt-in)', () => {
  it('is absent by default (no wire change)', () => {
    const sdl = toSDL(toIR())
    expect(sdl).not.toMatch(/interface Node/)
    expect(sdl).not.toMatch(/\bnode\(id:/)
    expect(sdl).not.toMatch(/implements Node/)
  })

  it('emits the interface, `implements Node`, and the root field when enabled', () => {
    const sdl = toSDL(toIR(undefined, {node: true}))
    expect(sdl).toMatch(/interface Node \{[^}]*id: ID!/)
    expect(sdl).toMatch(/type Author implements Node/)
    expect(sdl).toMatch(/type Book implements Node/)
    // Root refetch field.
    expect(sdl).toMatch(/node\(id: ID!\): Node/)
  })

  it('keeps every entity`s id typed ID!', () => {
    const ir = toIR(undefined, {node: true})
    for (const name of ['Author', 'Book']) {
      const idField = ir.entities[name].fields.find(f => f.name === 'id')!
      expect(idField.type).toEqual({kind: 'scalar', name: 'ID', nullable: false})
      expect(ir.entities[name].implements).toContain('Node')
    }
  })
})

describe('id({snowflake: true})', () => {
  it('is a text PK with a client default, still typed ID! in the SDL', async () => {
    class Ticket extends Model {
      id = id({snowflake: true})
      subject = text()
    }
    new Pylon({db: {models: [Ticket]}})
    const ir = toIR(undefined, {node: true})
    const idField = ir.entities.Ticket.fields.find(f => f.name === 'id')!
    // Physical column is text (snowflake round-trips as a string, no precision loss)…
    expect(idField.column?.sqlType).toBe('text')
    expect(idField.column?.primaryKey).toBe(true)
    // …but the API type is ID! (Node contract).
    expect(idField.type).toEqual({kind: 'scalar', name: 'ID', nullable: false})
    expect(toSDL(ir)).toMatch(/type Ticket implements Node/)
  })
})

describe('db: {globalIds: true} opt-in wiring', () => {
  it('turns on the Node projection for a bare `toIR()`', async () => {
    // Fresh module graph so the global-ids flag starts off, then an app enables it.
    const reg = await import('../src/registry')
    expect(reg.globalIdsEnabled()).toBe(false)
    expect(toSDL(toIR())).not.toMatch(/interface Node/)

    class Widget extends Model {
      id = id()
      name = text()
    }
    new Pylon({db: {models: [Widget], globalIds: true}})

    expect(reg.globalIdsEnabled()).toBe(true)
    expect(toSDL(toIR())).toMatch(/interface Node/)
    expect(toSDL(toIR())).toMatch(/node\(id: ID!\): Node/)
  })
})
