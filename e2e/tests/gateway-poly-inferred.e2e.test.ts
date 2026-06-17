/**
 * TDD TARGET — currently FAILING by design (marked `it.fails`). Encodes the invariant
 * the builder must satisfy: valid TypeScript MUST yield a valid GraphQL schema.
 *
 * The fixture declares interface classes (Profile / DoctorProfile / PatientProfile)
 * AND returns an UN-annotated polymorphic delegate, so the resolver's type is the
 * inferred variant union. That's valid TS — but today the builder emits an INVALID
 * schema: two interface-synthesis paths collide (inheritance `IProfile` vs the
 * union's `Profile`), the union members get shape-merged into the class types, and
 * the output fails schema validation.
 *
 * These assert the FIX's target: the build succeeds and writes a VALID schema that
 * is a coherent polymorphic interface (DoctorProfile/PatientProfile implement a
 * common interface, with their variant fields, and `profile` returns it). The exact
 * interface NAME is intentionally NOT pinned — that's the open design call.
 *
 * Build is pure type introspection (no remote), so no server is needed.
 *
 * When the builder is fixed: drop `.fails` (vitest will flag these as unexpectedly
 * passing), and re-point schema-invalid-fail-loud's guard at a stable invalid input,
 * since THIS input becomes valid.
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

  it.fails('builds the inferred polymorphic form into a VALID schema [TARGET]', () => {
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

  it.fails('exposes a coherent polymorphic interface with both variant members [TARGET]', () => {
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
