/**
 * Inferred polymorphic delegate → valid schema, NO return-type annotation. The
 * fixture declares interface classes (Profile / DoctorProfile / PatientProfile) and
 * returns an un-annotated polymorphic delegate whose patch stamps a LITERAL
 * `__typename` (`as const`). That literal discriminant makes the inferred variant
 * union unambiguous, so the builder emits a coherent polymorphic interface.
 *
 * This pins the invariant: valid, unambiguous TypeScript yields a valid GraphQL
 * schema. (The ambiguous variant — no `as const`, so `__typename` widens to `string`
 * — has no discriminant to name members from; that case fails the build loudly and
 * is covered by schema-invalid-app + schema-invalid-fail-loud.)
 *
 * These assert: the build succeeds and writes a VALID schema (passes graphql's
 * validateSchema) that is a coherent polymorphic interface — DoctorProfile/
 * PatientProfile implement a shared interface with their variant fields, and
 * `profile` returns it. The interface NAME is intentionally NOT pinned.
 *
 * Build is pure type introspection (no remote), so no server is needed.
 */
import {spawnSync} from 'node:child_process'
import {existsSync, readFileSync, rmSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {buildSchema, validateSchema, GraphQLInterfaceType, GraphQLObjectType} from 'graphql'
import {afterAll, describe, expect, it} from 'vitest'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '../..')
const cliBin = path.join(repoRoot, 'packages/pylon-dev/dist/index.js')
const appDir = path.resolve(dir, '../fixtures/gateway-poly-inferred-app')
const schemaPath = path.join(appDir, '.pylon/schema.graphql')
const env = {...process.env, PYLON_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1'}

function build() {
  return spawnSync('node', [cliBin, 'build'], {cwd: appDir, encoding: 'utf8', timeout: 120_000, env})
}

describe('builder: inferred polymorphic delegate (classes + no annotation)', () => {
  afterAll(() => rmSync(path.join(appDir, '.pylon'), {recursive: true, force: true}))

  it('builds the inferred polymorphic form into a VALID schema', () => {
    if (!existsSync(cliBin)) throw new Error(`pylon CLI not built at ${cliBin}.`)
    rmSync(path.join(appDir, '.pylon'), {recursive: true, force: true})

    const r = build()
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    expect(r.status, `build must succeed; output:\n${out}`).toBe(0)
    expect(existsSync(schemaPath), 'a schema.graphql must be written').toBe(true)

    // The generated SDL must pass graphql's own schema validation.
    const schema = buildSchema(readFileSync(schemaPath, 'utf8'))
    expect(validateSchema(schema)).toEqual([])
  })

  it('exposes a coherent polymorphic interface with both variant members', () => {
    rmSync(path.join(appDir, '.pylon'), {recursive: true, force: true})
    const r = build()
    expect(r.status).toBe(0)

    const schema = buildSchema(readFileSync(schemaPath, 'utf8'))

    // DoctorProfile / PatientProfile must exist as object types carrying their
    // variant field and implementing a shared interface.
    const doctor = schema.getType('DoctorProfile') as GraphQLObjectType
    const patient = schema.getType('PatientProfile') as GraphQLObjectType
    expect(doctor).toBeInstanceOf(GraphQLObjectType)
    expect(patient).toBeInstanceOf(GraphQLObjectType)
    expect(doctor.getFields().specialty).toBeDefined()
    expect(patient.getFields().insuranceId).toBeDefined()

    const sharedIface = doctor.getInterfaces()[0]
    expect(sharedIface, 'DoctorProfile must implement an interface').toBeInstanceOf(GraphQLInterfaceType)
    expect(patient.getInterfaces().map(i => i.name)).toContain(sharedIface!.name)

    // `profile` must return that interface.
    const profileField = (schema.getQueryType() as GraphQLObjectType).getFields().profile
    const retType = String(profileField.type).replace(/[!\[\]]/g, '')
    expect(retType).toBe(sharedIface!.name)
  })
})
