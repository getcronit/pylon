![Pylon cover](https://github.com/user-attachments/assets/c28e49b2-5672-4849-826e-8b2eab0360cc)

<div align="center"><strong>Pylon</strong></div>
<div align="center">The next generation of building APIs.<br />Automatic schema generation for your service logic.</div>
<br />
<div align="center">
<a href="https://pylon.cronit.io">Website</a> 
<span> · </span>
<a href="https://github.com/getcronit/pylon">GitHub</a> 
<span> · </span>
<a href="https://discord.com/invite/cbJjkVrnHe">Discord</a>

<br />
<br />

[![Documentation](https://img.shields.io/badge/documentation-documentation?color=000000)](https://pylon.cronit.io/docs)
[![NPM](https://img.shields.io/npm/v/%40getcronit%2Fpylon)](https://www.npmjs.com/package/@getcronit/pylon)

</div>

## Introduction

A framework for building GraphQL APIs without defining any kind of schema.
It reduces the time spent on writing and maintaining API definitions, allowing you to focus solely on writing your service logic.

## Why

We believe that the current approach to building APIs is outdated. Writing and maintaining API definitions is time-consuming and error-prone. When you already have TypeScript definitions, why not use them to infer the API schema? Pylon does exactly that.

Pylon also provides a set of tools to help you build, test, and deploy your APIs. We believe that building services should be easy and fun. Major functionalities like authentication, authorization, and context management are built-in, so you can focus on what matters most: your service logic.

With Pylon, you can build APIs faster, with fewer errors, and with less code.

## Create

To create a new Pylon project, run the following command:

```bash
npm create pylon
```

Afterwards, you can navigate to the newly created project and start the development server:

```bash
cd my-pylon
npm run dev
```

This will start the development server on `http://localhost:3000`.

Open the [Pylon Playground](https://pylon.cronit.io/docs/getting-started#built-in-graphql-playground) in your browser and start building your API.

## Develop

Update your service logic in the `src` directory.

```typescript
import {app} from '@getcronit/pylon'

export const graphql = {
  Query: {
    sum: (a: number, b: number) => {
      console.log(`Calculating sum of ${a} and ${b}`)
      return a + b
    }
  },
  Mutation: {
    divide: (a: number, b: number) => {
      if (b === 0) {
        console.error('Attempt to divide by zero')
        throw new Error('Division by zero is not allowed')
      }
      console.log(`Dividing ${a} by ${b}`)
      return a / b
    }
  }
}

export default app
```

## Deploy

Pylon is fully compatible with Cloudflare Workers, allowing you to deploy your service to the edge in just one minute.
Watch the video below to see how easy it is to deploy a Pylon.

![Cloudflare Workers](https://github.com/user-attachments/assets/8e9f96a7-47e3-4c66-8426-fe09329de598)





If you prefer to deploy your service to a different platform, you can use the provided Dockerfile to build a Docker image and deploy it to your favorite cloud provider.

```bash
docker build -t my-pylon .
docker run -p 3000:3000 my-pylon
```

## Runtimes

Designed to be flexible, Pylon can be run on various platforms, including:

| <img src="https://bun.sh/logo.svg" width="48px" height="48px" alt="Bun.js logo"> | <img src="https://nodejs.org/static/logos/jsIconWhite.svg" width="48px" height="48px" alt="Node.JS"> | <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQgW7cAlhYN23JXGKy9Uji4Ae2mnHOR9eXX9g&s" width="48px" height="48px" alt="Gmail logo"> |
| :------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------: |
|                                      Bun.js                                      |                                               Node.js                                                |                                                                  Cloudflare Workers                                                                  |

## Features

Pylon offers a comprehensive set of features to streamline the development of modern web services:

| Feature                              | Description                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Automatic Schema Generation**      | Pylon generates GraphQL schemas based on your TypeScript definitions, ensuring type safety and reducing manual coding effort.        |
| **Type Safety**                      | By leveraging TypeScript, Pylon ensures that your services are type-safe, catching errors at compile time.                           |
| **Authentication and Authorization** | Built-in support for OIDC standard and integration with ZITADEL for managing user authentication and role-based access control.      |
| **Logging and Monitoring**           | Sentry for error tracking, providing robust monitoring capabilities.                                                                 |
| **Database Integration**             | Seamlessly works with Prisma to generate extended models that support automatic resolution of relations and paginatable connections. |
| **Deployment Ready**                 | Includes pre-configured Dockerfile for easy deployment using Docker or manual methods.                                               |

## Playground

You can try Pylon in the [Playground](https://pylon.cronit.io/playground) without installing anything.
Or simply click the image below to open the Playground.

[![Playground](https://github.com/user-attachments/assets/39df08d0-4094-4836-a36b-37ad62e292cf)](https://pylon.cronit.io/playground)

## Contributing

Documentation, bug reports, pull requests, and other contributions are welcomed!
See [`CONTRIBUTING.md`](CONTRIBUTING.md) for more information.

## Support

- **Community Support:** Join the Pylon community on GitHub to report bugs and request features.
- **Professional Support:** For professional support and consulting services, contact [office@cronit.io](mailto:office@cronit.io).
- Join the [Pylon Discord server](https://discord.gg/cbJjkVrnHe) to connect with other users and contributors.

---

Pylon is brought to you by Cronit.
