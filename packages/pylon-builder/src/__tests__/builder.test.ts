import {describe, expect, test} from '@jest/globals'
//import { writeFileSync } from "fs";

import {SchemaBuilder} from '../schema/builder'

describe('Builder', () => {
  test('init', () => {
    const builder = new SchemaBuilder('./src/__tests__/__fixtures__/sfi.ts')

    expect(builder).toBeDefined()
  })

  test('build sfi', () => {
    const builder = new SchemaBuilder('./src/__tests__/__fixtures__/sfi.ts')
    const schema = builder.build()

    expect(schema.typeDefs).toMatchInlineSnapshot(`
"input StarShipInput {
	name: String
	crew: Number
	isBroken: Boolean
	crewMembers: Any
}
input PeopleInput {
	name: String
	height: String
	opinionOn: String
}
input InputInput {
	name: String
	age: Number
}
type Query {
	hello: String!
	sayHelloTo(name: String!): String!
	sayHelloToOrDefault(name: Any): String!
	returnAny: Any!
	spaceShip(id: String!): StarShip!
	spaceShips: [Any!]!
	spaceShipById(id: Any!): StarShip!
	getAsyncDataFromApi: GetAsyncDataFromApi!
	films: [Film]!
	extendedFilm: ObjectAndFilm!
}
type StarShip {
	name: String!
	crew: Number!
	isBroken: Boolean!
	crewMembers: [People]
}
type People {
	name: String!
	height: String!
	opinionOn(starship: StarShipInput!): String!
}
type GetAsyncDataFromApi {
	name: String!
	height: String!
}
type Film {
	title: String!
	characters: [People!]!
	planets: [Planet!]!
	starships: [StarShip!]!
	vehicles: [Any!]!
	species: [Any!]!
	created: String!
	edited: String!
	url: String!
}
type Planet {
	name: String!
	population: String!
}
type ObjectAndFilm {
	director: String!
	title: String!
	characters: [People!]!
	planets: [Planet!]!
	starships: [StarShip!]!
	vehicles: [Any!]!
	species: [Any!]!
	created: String!
	edited: String!
	url: String!
	other: String
}
type Mutation {
	parse(input: Any!): String!
	inlineObject(input: InputInput!): InlineObject!
}
type InlineObject {
	name: String!
	age: Number!
}
scalar Number
scalar Any
"
`)
  })

  test('build example', () => {
    const builder = new SchemaBuilder(
      './src/__tests__/__fixtures__/example/src/sfi.ts'
    )
    const schema = builder.build()

    expect(schema.typeDefs).toMatchInlineSnapshot(`
"input InputInput {
	name: String
	age: Number
}
input InputInput_1 {
	name: String
}
input CircleInputInput {
	radius: Number
}
type Query {
	hello: String!
	userMe: User!
	calculate(a: Number!, b: Number!, operation: String!): Number!
}
type User {
	id: Number!
	name: String!
	blogs(total: Number!): [Blog!]!
}
type Blog {
	id: Number!
	title: String!
	content: String!
}
type Mutation {
	updateSomething: String!
	inlineObject(input: InputInput!): InlineObject!
	getGirlfriend(input: InputInput_1!): [GetGirlfriend!]!
	getCircle(input: CircleInputInput!): GetCircle!
	max(values: [Number!]!): Number!
}
type InlineObject {
	name: String!
	age: Number!
}
type GetGirlfriend {
	name: String!
	age: Number!
}
type GetCircle {
	radius: Number!
	area: Number!
}
scalar Number
scalar Any
"
`)
  })
})
