This is a example of a service build with Pylon that uses Interfaces and Unions.

Take a look at the `src/index.ts` file to see how the service is built.

To run the service, execute the following commands:

```bash
bun install
```

```bash
bun run dev
```

Then, open your browser and navigate to `http://localhost:3000/graphql` to interact with the service.

```graphql
query MyQuery {
  allMedia {
    __typename
    id
    ... on Book {
      id
      title
    }
    ... on Author {
      id
      name
    }
  }
  books {
    __typename
    id
    ... on Book {
      id
      title
    }
    ... on TextBook {
      title
      id
    }
  }
  shapes {
    __typename
    ... on Rectangle {
      height
      width
    }
    ... on Circle {
      radius
    }
  }
  vehicles {
    __typename
    id
    name
    speed
    __typename
    ... on Ship {
      id
      name
      length
      speed
    }
    ... on Plane {
      id
      name
      altitude
      speed
    }
  }
  accessories {
    __typename
    ... on Camera {
      __typename
      megapixels
    }
    ... on Microphone {
      __typename
      sensitivity
    }
  }
  search(contains: "J.K") {
    __typename
    ... on Book {
      id
      title
    }
    ... on TextBook {
      id
      subject
      title
    }
    ... on Author {
      id
      name
    }
    ... on Ship {
      id
      name
      length
      speed
    }
    ... on Plane {
      id
      name
      altitude
      speed
    }
    ... on Rectangle {
      __typename
      height
      width
    }
    ... on Circle {
      __typename
      radius
    }
    ... on Camera {
      __typename
      megapixels
    }
    ... on Microphone {
      __typename
      sensitivity
    }
  }
}
```
