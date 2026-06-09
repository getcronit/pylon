import {toDDL, toSDL} from '@getcronit/pylon-ir'
import {describe, expect, it} from 'vitest'
import {Model, boolean, foreignKey, hasMany, id, model, text, timestamp} from '../src/index'
import {toIR} from '../src/ir'
import type {Relation} from '../src/relations'

@model()
class User extends Model {
  id = id()
  email = text({unique: true})
  isActive = boolean({default: true})
  createdAt = timestamp({defaultSql: 'now()'})
  posts = hasMany(() => Post, {foreignKey: 'authorId'})
  $passwordHash = text({nullable: true})
}

@model()
class Post extends Model {
  id = id()
  title = text()
  authorId = foreignKey(() => User)
  declare author: Relation<User>
}

describe('toIR — ORM registry → Pylon IR', () => {
  const full = toIR()

  it('produces one entity per concrete model', () => {
    expect(Object.keys(full.entities).sort()).toEqual(['Post', 'User'])
  })

  it('records the primary key as an ID and a bigint identity column', () => {
    const idField = full.entities.User.fields.find(f => f.name === 'id')!
    expect(idField.type).toEqual({kind: 'scalar', name: 'ID', nullable: false})
    expect(idField.column).toMatchObject({primaryKey: true, autoIncrement: true})
  })

  it('records scalar columns with intent-precise types', () => {
    const f = (n: string) => full.entities.User.fields.find(x => x.name === n)!
    expect(f('email').type).toMatchObject({name: 'String', nullable: false})
    expect(f('isActive').type).toMatchObject({name: 'Boolean'})
    expect(f('createdAt').type).toMatchObject({name: 'Date'})
    expect(f('createdAt').column).toMatchObject({defaultSql: 'now()'})
  })

  it('records hasMany as a non-null list relation, no column', () => {
    const posts = full.entities.User.fields.find(f => f.name === 'posts')!
    expect(posts.type).toEqual({
      kind: 'list',
      of: {kind: 'ref', name: 'Post', nullable: false},
      nullable: false
    })
    expect(posts.relation).toMatchObject({kind: 'hasMany', target: 'Post', targetFkField: 'authorId'})
    expect(posts.column).toBeUndefined()
  })

  it('records belongsTo as a nullable ref plus its FK scalar column', () => {
    const author = full.entities.Post.fields.find(f => f.name === 'author')!
    expect(author.type).toEqual({kind: 'ref', name: 'User', nullable: false})
    expect(author.relation).toMatchObject({kind: 'belongsTo', target: 'User', fkField: 'authorId'})
    const fk = full.entities.Post.fields.find(f => f.name === 'authorId')!
    expect(fk.column).toMatchObject({name: 'author_id'})
  })

  it('records the $-hidden column as exposed:false with the $ stripped', () => {
    const pw = full.entities.User.fields.find(f => f.column?.name === 'password_hash')!
    expect(pw.name).toBe('passwordHash') // sigil stripped
    expect(pw.exposed).toBe(false)
    expect(pw.column).toMatchObject({name: 'password_hash', nullable: true})
  })

  it('the same IR drives both GraphQL and SQL projections', () => {
    const sdl = toSDL(full)
    expect(sdl).toMatch(/type User/)
    expect(sdl).toMatch(/posts: \[Post!\]!/)
    expect(sdl).toMatch(/author: User/)
    expect(sdl).not.toMatch(/passwordHash|password_hash/) // hidden

    const userDDL = toDDL(full.entities.User)
    expect(userDDL).toMatch(/CREATE TABLE "user"/)
    expect(userDDL).toMatch(/"password_hash" text/) // present in the table
    expect(userDDL).not.toMatch(/posts/) // relation, not a column
  })

  it('prints the real IR for inspection', () => {
    // eslint-disable-next-line no-console
    console.log('\n===IR===\n' + JSON.stringify(full, null, 2) + '\n===END===')
  })
})
