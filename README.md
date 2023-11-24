# snek-function

snek-function is a lightweight framework for building GraphQL APIs using Node.js and TypeScript. It eliminates the need for defining a schema by inferring it from the functionality of the functions defined as mutation or query.

## Table of Content

- [snek-function](#snek-function)
  - [Features](#features)
  - [CLI](#cli)
  - [Usage](#usage)
  - [Configuring the Express App](#configuring-the-express-app)
  - [Logging](#logging)
  - [Building and Running the Project](#building-and-running-the-project)
    - [Using the Dockerfile (Recommended)](#using-the-dockerfile-recommended)
    - [Manually Building and Running the Project](#manually-building-and-running-the-project)
  - [Viewer](#viewer)
  - [Contributing](#contributing)

## Features

- Simplified syntax: Define your business logic using simple functions that take arguments and return values.
- Automatic schema generation: The schema is inferred by the functionality of the functions defined in mutation or query.
- Express under the hood: Uses Express to provide a flexible middleware stack that can be fully customized.
- TypeScript support: Built with TypeScript, providing type safety and a better developer experience.
- Extensible: Easily extendable with plugins and third-party middleware.
- Command-line interface: Use the CLI to generate new projects and start the development server.
- Logger: Integrated logging functionality to help track the execution of your service.

## CLI
snek-function comes with a command-line interface (CLI) that makes it easy to generate new projects and start the development server.

To create a new project, run:

```
npx @snek-at/function-cli new my-project
```

This will create a new project in the my-project directory.

To start the development server, run:

```
yarn develop
```

This will start the development server on http://localhost:3000.

## Usage

Here's a simple example of how to define a GraphQL API using snek-function:

```typescript
import { UserService } from "./services/user.service";

export default defineService({
  Query: {
    allUser: UserService.allUser,
    user: UserService.user,
  },
  Mutation: {
    userCreate: UserService.userCreate,
    userUpdate: UserService.userUpdate,
    userDelete: UserService.userDelete,
  },
});

```

## Configuring the Express App
The configureApp function in the service definition allows developers to configure the underlying Express app used by snek-function. This function takes an instance of the Express app as an argument and returns the configured app.

Here's an example of how to use the configureApp function to add middleware to the Express app:

```typescript
import { defineService, logger } from "@snek-at/function";
import { UserService } from "./services/user.service";
import cors from "cors";

export default defineService(
  {
    Query: {
      allUser: UserService.allUser,
      user: UserService.user,
    },
    Mutation: {
      userCreate: UserService.userCreate,
      userUpdate: UserService.userUpdate,
      userDelete: UserService.userDelete,
    },
  },
  {
    configureApp(app) {
      // Add CORS middleware to the Express app
      app.use(cors());

      logger.info("Configuring app");
      return app;
    },
  }
);
```

In this example, the cors middleware is added to the Express app using the app.use method inside the configureApp function.

## Logging
snek-function includes a built-in logger that developers can use to log information, warnings, and errors. The logger uses the popular winston library under the hood and provides a customizable and extensible logging solution.

Here's an example of how to use the logger in a service definition:

```typescript
import { defineService, logger } from "@snek-at/function";
import { UserService } from "./services/user.service";

export default defineService({
  Query: {
    allUser: async () => {
      logger.info("Fetching all users");

      // Call the UserService to get all users
      const users = await UserService.getAllUsers();

      // Log the number of users returned
      logger.info(`Found ${users.length} users`);

      return users;
    },
  },
});
```

## Building and Running the Project

There are two main ways to build and run the project:

1. Using the Dockerfile which comes with the `sf new` template (recommended)
2. Manually building and running the project using the `sf build` and `sf-server` commands

### Using the Dockerfile (Recommended)
We recommend using the Dockerfile which comes with the `sf new` template to build and run the project.

To build the project using Docker, navigate to the root directory of the project and run the following command:

```
docker build -t my-function .
```

This will build the Docker image with the tag `my-function`.

After building the image, you can start the container using the following command:

```
docker run -p 3000:3000 my-app
```

This will start the container and map port 3000 of the container to port 3000 of the host machine. You can then access the GraphQL API at `http://localhost:3000/graphql`.

These commands are useful for deploying the project to a production environment or sharing it with others.

### Manually Building and Running the Project
If you prefer to manually build and run the project, you can use the sf build and sf-server commands.

To build the project, navigate to the root directory of the project and run the following command:

```
sf build
```

This will build the project using the `./src/sfi.ts` file.

After building the project, you can start the server using the following command:

```
sf-server
```

This will start the server and make the GraphQL API available at `http://localhost:3000/graphql`.

If you have any questions or issues with building or running the project, please refer to the official documentation or feel free to ask for help.

## Viewer
snek-function comes with a built-in viewer that provides a visual overview of your GraphQL API. To access the viewer, you can navigate to the `/viewer` route of your running service. This is a great way to quickly understand the structure of your API and explore the available types, fields, and relationships. With the viewer, you can also test your queries and mutations directly in the browser, making it easy to debug and optimize your API.

![image](https://user-images.githubusercontent.com/52858351/235554014-f241824e-728b-4a80-9dba-77d975edd735.png)


## Contributing

Contributions to snek-function are always welcome. If you'd like to contribute, please follow the contribution guidelines.
