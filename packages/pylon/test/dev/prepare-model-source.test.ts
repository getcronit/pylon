import {describe, expect, it} from 'vitest'
import {prepareModelSource} from '../src/builder/prepare-model-source'

describe('prepareModelSource — strip top-level side effects for model loading', () => {
  it('drops a Node serve(app) call and prunes its now-unused imports', () => {
    const out = prepareModelSource(`
      import {app} from '@getcronit/pylon'
      import {serve} from '@hono/node-server'
      import {Model, model, id} from '@getcronit/pylon-db'

      @model()
      export class User extends Model {
        id = id()
      }

      export const graphql = {Query: {}}

      serve(app, info => console.log(info.port))
    `)
    expect(out).not.toMatch(/serve\(app/)
    expect(out).not.toMatch(/@hono\/node-server/) // import pruned (unused)
    expect(out).not.toMatch(/from '@getcronit\/pylon'/) // app import pruned
    // model declaration + its imports + graphql export survive
    expect(out).toMatch(/@model\(\)/)
    expect(out).toMatch(/class User extends Model/)
    expect(out).toMatch(/@getcronit\/pylon-db/)
    expect(out).toMatch(/export const graphql/)
  })

  it('drops `export default app` (Workers/Bun form)', () => {
    const out = prepareModelSource(`
      import {app} from '@getcronit/pylon'
      import {Model, model} from '@getcronit/pylon-db'
      @model() export class A extends Model {}
      export default app
    `)
    expect(out).not.toMatch(/export default/)
    expect(out).toMatch(/class A extends Model/)
  })

  it('drops Deno.serve(...) (Deno form)', () => {
    const out = prepareModelSource(`
      import {app} from '@getcronit/pylon'
      import {Model, model} from '@getcronit/pylon-db'
      @model() export class A extends Model {}
      Deno.serve({port: 3000}, app.fetch)
    `)
    expect(out).not.toMatch(/Deno\.serve/)
    expect(out).toMatch(/class A extends Model/)
  })

  it('keeps imports still used by surviving declarations', () => {
    const out = prepareModelSource(`
      import {Model, model, foreignKey} from '@getcronit/pylon-db'
      import {Other} from './other'
      @model() export class A extends Model {
        otherId = foreignKey(() => Other)
      }
      export const graphql = {Query: {}}
    `)
    expect(out).toMatch(/foreignKey/) // used → kept
    expect(out).toMatch(/from '\.\/other'/) // Other used → kept
  })
})
