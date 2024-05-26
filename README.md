# Pylon: From Functions to APIs - Instantly

Pylon is a powerful framework for building web services effortlessly. With Pylon, you can quickly set up your development environment and start building robust APIs in no time.

## Getting Started

### Installation

Install the Pylon CLI globally:

```sh
npm install -g @getcronit/pylon-cli
```

### Creating a New Project

Create a new Pylon project:

```sh
pylon new my-pylon-project
```

### Starting the Development Server

Navigate to your project directory and start the development server:

```sh
cd my-pylon-project
bun run develop
```

Your Pylon server will be running at `http://localhost:3000`.

### Building for Production

Build your Pylon project for production:

```sh
bun run build
```

### Deploying to Production

**Docker Deployment:**

```sh
docker build -t my-pylon-project .
docker run -p 3000:3000 my-pylon-project
```

**Manual Deployment:**

Copy the contents of the `.pylon` directory to your server and run:

```sh
pylon-server
```

## Example Service

Here's a basic example of a Pylon service:

```typescript
import { defineService } from "@getcronit/pylon";

export default defineService({
  Query: {
    sum: (a: number, b: number) => a + b,
  },
  Mutation: {
    divide: (a: number, b: number) => a / b,
  },
});
```

## Further Documentation

For comprehensive documentation, visit [Pylon Documentation](https://pylon.cronit.io).

## Getting Help

- **Community Support:** Join the Pylon community on GitHub to report bugs and request features.
- **Professional Support:** For professional support and consulting services, contact [office@cronit.io](mailto:office@cronit.io).

---

Pylon is brought to you by Cronit.
