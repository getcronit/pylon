import {app, ID} from '@getcronit/pylon'

//> Interfaces that are implemented by classes
interface Media {
  id: ID
}

class Book implements Media {
  constructor(public id: ID, public title: string) {}
}

class TextBook extends Book {
  constructor(public id: ID, public title: string, public subject: string) {
    super(id, title)
  }
}

class Author implements Media {
  constructor(public id: ID, public name: string) {}
}

const media: Media[] = [
  new Book('1', 'Harry Potter'),
  new Author('2', 'J.K. Rowling'),
  new TextBook('3', 'Mathematics', 'Algebra')
]

//> Union types (Shared properties)
// This will generate a interface with the shared properties and two types with the specific properties

type Ship = {
  id: ID
  name: string
  speed: number
  length: number
}

type Plane = {
  id: ID
  name: string
  speed: number
  altitude: number
}

type Vehicle = Ship | Plane

const vehicles: Vehicle[] = [
  {id: '1', name: 'Titanic', speed: 20, length: 200},
  {id: '2', name: 'Boeing 747', speed: 1000, altitude: 10000}
]

//> Union types (Different properties)

type Rectangle = {
  width: number
  height: number
}

type Circle = {
  radius: number
}

type Shape = Rectangle | Circle

const shapes: Shape[] = [{width: 10, height: 20}, {radius: 5}]

//> Union types with TypeScript interfaces

interface Camera {
  megapixels: number
}

interface Microphone {
  sensitivity: number
}

type Accessory = Camera | Microphone

const accessories: Accessory[] = [{megapixels: 20}, {sensitivity: 30}]

//> Union type for search

type SearchResult =
  | Book
  | TextBook
  | Author
  | Ship
  | Plane
  | Rectangle
  | Circle
  | Camera
  | Microphone
  | Vehicle
  | Accessory

export const graphql = {
  Query: {
    allMedia: () => media,
    books: () =>
      media.filter(media => media instanceof Book || media instanceof TextBook),
    vehicles: () => vehicles,
    shapes: () => shapes,
    accessories: () => accessories,
    search: (contains: string): SearchResult[] => {
      const items = [
        ...media,
        ...vehicles,
        ...shapes,
        ...accessories
      ] as SearchResult[]

      return items.filter(item => {
        if ('title' in item) {
          return (item as Book).title.includes(contains)
        }

        if ('name' in item) {
          return (item as Ship | Plane).name.includes(contains)
        }

        if ('width' in item) {
          return (item as Rectangle).width.toString().includes(contains)
        }

        if ('radius' in item) {
          return (item as Circle).radius.toString().includes(contains)
        }

        if ('megapixels' in item) {
          return (item as Camera).megapixels.toString().includes(contains)
        }

        if ('sensitivity' in item) {
          return (item as Microphone).sensitivity.toString().includes(contains)
        }

        return false
      })
    }
  },
  Mutation: {}
}

export default app
