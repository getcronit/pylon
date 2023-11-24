const defineService = <Q, M>(plainResolvers: {Query: Q; Mutation: M}) => {
  return {plainResolvers}
}

type StarShip = {
  name: string
  crew: number
  isBroken: boolean
  crewMembers?: Array<People>
}

class People {
  name: string
  height: string

  opinionOn(starship: StarShip): string {
    if (starship.isBroken) {
      return 'This is a piece of junk!'
    } else {
      return 'This is a great ship!'
    }
  }
}

class Planet {
  name: string
  population: string
}

class Film {
  title: string
  characters: Array<People>
  planets: Array<Planet>
  starships: Array<StarShip>
  vehicles: Array<any>
  species: Array<any>
  created: string
  edited: string
  url: string
}

const index = defineService({
  Query: {
    hello: () => 'Hello world!',
    sayHelloTo: (name: string) => `Hello ${name}!`,
    sayHelloToOrDefault: (name?: string) => `Hello ${name}!`,
    returnAny: (): any => {},
    spaceShip: (id: string): StarShip => ({
      name: 'Millennium Falcon',
      crew: 4,
      isBroken: false
    }),
    spaceShips: (): Array<any> => [
      {
        name: 'Millennium Falcon',
        crew: 4,
        isBroken: false
      },
      {
        name: 'X-Wing',
        crew: 1,
        isBroken: false
      }
    ],
    spaceShipById: (id: any): StarShip => ({
      name: 'Millennium Falcon',
      crew: 4,
      isBroken: false
    }),
    getAsyncDataFromApi: async (): Promise<{
      name: string
      height: string
    }> => {
      return fetch('https://swapi.dev/api/people/1').then(res => res.json())
    },
    films: (): (Film | undefined)[] => {
      return []
    },
    extendedFilm: () => {
      return {
        title: 'A New Hope',
        characters: [],
        planets: [],
        starships: [],
        vehicles: [],
        species: [],
        created: '',
        edited: '',
        url: '',
        director: 'George Lucas'
      } as {
        director: string
      } & Film & {
          other?: string
        }
    }
  },
  Mutation: {
    parse: (input: string | boolean) => {
      if (typeof input === 'string') {
        return input
      } else {
        return input.toString()
      }
    },
    inlineObject: (input: {name: string; age: number}) => {
      return input
    }
  }
})

export default index
