import {getVersions} from '@getcronit/pylon-telemetry'
import {app, getContext, type Plugin} from '../index'
import {html} from 'hono/html'

let cachedGetRoutes: Set<string> | undefined

const bootstrapGetRoutes = () => {
  if (cachedGetRoutes) {
    return cachedGetRoutes
  }

  const routes = app.routes

  cachedGetRoutes = new Set(
    routes.filter(route => route.method === 'GET').map(route => route.path)
  )

  return cachedGetRoutes
}

export function useUnhandledRoute(args: {graphqlEndpoint: string}): Plugin {
  const routes = bootstrapGetRoutes()

  const versions = getVersions()

  return {
    app: app => {
      app.use(async (c, next) => {
        if (c.req.method === 'GET' && c.req.path !== args.graphqlEndpoint) {
          return c.html(
            await html`<!doctype html>
  <html lang="en">
  <head>
  <meta charset="utf-8" />
  <title>Welcome to Pylon</title>
  <link
  rel="icon"
  href="https://pylon.cronit.io/favicon/favicon.ico"
  />
  <style>
  body,
  html {
  padding: 0;
  margin: 0;
  height: 100%;
  font-family:
    'Inter',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'Roboto',
    'Oxygen',
    'Ubuntu',
    'Cantarell',
    'Fira Sans',
    'Droid Sans',
    'Helvetica Neue',
    sans-serif;
  color: white;
  background-color: black;
  }
  
  main > section.hero {
  display: flex;
  height: 90vh;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  }
  
  .logo {
  display: flex;
  align-items: center;
  }
  
  .logo-svg {
  width: 100%
  }
  
  .buttons {
  margin-top: 24px;
  }
  
  h1 {
  font-size: 80px;
  }
  
  h2 {
  color: #888;
  max-width: 50%;
  margin-top: 0;
  text-align: center;
  }
  
  a {
  color: #fff;
  text-decoration: none;
  margin-left: 10px;
  margin-right: 10px;
  font-weight: bold;
  transition: color 0.3s ease;
  padding: 4px;
  overflow: visible;
  }
  
  a.graphiql:hover {
  color: rgba(255, 0, 255, 0.7);
  }
  a.docs:hover {
  color: rgba(28, 200, 238, 0.7);
  }
  a.tutorial:hover {
  color: rgba(125, 85, 245, 0.7);
  }
  svg {
  margin-right: 24px;
  }
  
  .not-what-your-looking-for {
  margin-top: 5vh;
  }
  
  .not-what-your-looking-for > * {
  margin-left: auto;
  margin-right: auto;
  }
  
  .not-what-your-looking-for > p {
  text-align: center;
  }
  
  .not-what-your-looking-for > h2 {
  color: #464646;
  }
  
  .not-what-your-looking-for > p {
  max-width: 600px;
  line-height: 1.3em;
  }
  
  .not-what-your-looking-for > pre {
  max-width: 300px;
  }
  </style>
  </head>
  <body id="body">
  <main>
  <section class="hero">
  <div class="logo">
    <div>
      <svg class="logo-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" zoomAndPan="magnify" viewBox="0 0 286.5 121.500001" preserveAspectRatio="xMidYMid meet" version="1.0"><defs><g></g><clipPath id="38f6fcde47"><path d="M 0.339844 42 L 10 42 L 10 79 L 0.339844 79 Z M 0.339844 42 " clip-rule="nonzero"></path></clipPath><clipPath id="af000f7256"><path d="M 64 23.925781 L 72.789062 23.925781 L 72.789062 96.378906 L 64 96.378906 Z M 64 23.925781 " clip-rule="nonzero"></path></clipPath></defs><g fill="currentColor" fill-opacity="1"><g transform="translate(107.11969, 78.49768)"><g><path d="M 10.078125 -25.046875 C 11.109375 -26.398438 12.507812 -27.535156 14.28125 -28.453125 C 16.0625 -29.378906 18.070312 -29.84375 20.3125 -29.84375 C 22.863281 -29.84375 25.195312 -29.210938 27.3125 -27.953125 C 29.425781 -26.691406 31.085938 -24.921875 32.296875 -22.640625 C 33.503906 -20.367188 34.109375 -17.757812 34.109375 -14.8125 C 34.109375 -11.863281 33.503906 -9.222656 32.296875 -6.890625 C 31.085938 -4.566406 29.425781 -2.753906 27.3125 -1.453125 C 25.195312 -0.160156 22.863281 0.484375 20.3125 0.484375 C 18.070312 0.484375 16.078125 0.03125 14.328125 -0.875 C 12.585938 -1.78125 11.171875 -2.910156 10.078125 -4.265625 L 10.078125 13.96875 L 4 13.96875 L 4 -29.359375 L 10.078125 -29.359375 Z M 27.921875 -14.8125 C 27.921875 -16.84375 27.503906 -18.59375 26.671875 -20.0625 C 25.835938 -21.539062 24.734375 -22.660156 23.359375 -23.421875 C 21.992188 -24.179688 20.53125 -24.5625 18.96875 -24.5625 C 17.445312 -24.5625 16 -24.171875 14.625 -23.390625 C 13.257812 -22.609375 12.160156 -21.472656 11.328125 -19.984375 C 10.492188 -18.492188 10.078125 -16.734375 10.078125 -14.703125 C 10.078125 -12.679688 10.492188 -10.914062 11.328125 -9.40625 C 12.160156 -7.894531 13.257812 -6.75 14.625 -5.96875 C 16 -5.1875 17.445312 -4.796875 18.96875 -4.796875 C 20.53125 -4.796875 21.992188 -5.191406 23.359375 -5.984375 C 24.734375 -6.785156 25.835938 -7.953125 26.671875 -9.484375 C 27.503906 -11.015625 27.921875 -12.789062 27.921875 -14.8125 Z M 27.921875 -14.8125 "></path></g></g></g><g fill="currentColor" fill-opacity="1"><g transform="translate(143.259256, 78.49768)"><g><path d="M 30.4375 -29.359375 L 12.421875 13.796875 L 6.125 13.796875 L 12.09375 -0.484375 L 0.53125 -29.359375 L 7.296875 -29.359375 L 15.5625 -6.984375 L 24.140625 -29.359375 Z M 30.4375 -29.359375 "></path></g></g></g><g fill="currentColor" fill-opacity="1"><g transform="translate(174.281707, 78.49768)"><g><path d="M 10.078125 -39.4375 L 10.078125 0 L 4 0 L 4 -39.4375 Z M 10.078125 -39.4375 "></path></g></g></g><g fill="currentColor" fill-opacity="1"><g transform="translate(188.353752, 78.49768)"><g><path d="M 16.734375 0.484375 C 13.960938 0.484375 11.457031 -0.144531 9.21875 -1.40625 C 6.976562 -2.664062 5.21875 -4.441406 3.9375 -6.734375 C 2.664062 -9.035156 2.03125 -11.691406 2.03125 -14.703125 C 2.03125 -17.691406 2.6875 -20.335938 4 -22.640625 C 5.3125 -24.953125 7.101562 -26.726562 9.375 -27.96875 C 11.65625 -29.21875 14.195312 -29.84375 17 -29.84375 C 19.8125 -29.84375 22.351562 -29.21875 24.625 -27.96875 C 26.894531 -26.726562 28.6875 -24.953125 30 -22.640625 C 31.320312 -20.335938 31.984375 -17.691406 31.984375 -14.703125 C 31.984375 -11.722656 31.304688 -9.078125 29.953125 -6.765625 C 28.597656 -4.453125 26.757812 -2.664062 24.4375 -1.40625 C 22.113281 -0.144531 19.546875 0.484375 16.734375 0.484375 Z M 16.734375 -4.796875 C 18.296875 -4.796875 19.757812 -5.164062 21.125 -5.90625 C 22.5 -6.65625 23.613281 -7.773438 24.46875 -9.265625 C 25.320312 -10.765625 25.75 -12.578125 25.75 -14.703125 C 25.75 -16.835938 25.335938 -18.640625 24.515625 -20.109375 C 23.703125 -21.585938 22.617188 -22.695312 21.265625 -23.4375 C 19.910156 -24.1875 18.453125 -24.5625 16.890625 -24.5625 C 15.328125 -24.5625 13.878906 -24.1875 12.546875 -23.4375 C 11.210938 -22.695312 10.15625 -21.585938 9.375 -20.109375 C 8.59375 -18.640625 8.203125 -16.835938 8.203125 -14.703125 C 8.203125 -11.546875 9.007812 -9.101562 10.625 -7.375 C 12.25 -5.65625 14.285156 -4.796875 16.734375 -4.796875 Z M 16.734375 -4.796875 "></path></g></g></g><g fill="currentColor" fill-opacity="1"><g transform="translate(222.361196, 78.49768)"><g><path d="M 18.8125 -29.84375 C 21.125 -29.84375 23.191406 -29.363281 25.015625 -28.40625 C 26.847656 -27.445312 28.28125 -26.023438 29.3125 -24.140625 C 30.34375 -22.253906 30.859375 -19.984375 30.859375 -17.328125 L 30.859375 0 L 24.84375 0 L 24.84375 -16.421875 C 24.84375 -19.046875 24.179688 -21.054688 22.859375 -22.453125 C 21.546875 -23.859375 19.753906 -24.5625 17.484375 -24.5625 C 15.210938 -24.5625 13.410156 -23.859375 12.078125 -22.453125 C 10.742188 -21.054688 10.078125 -19.046875 10.078125 -16.421875 L 10.078125 0 L 4 0 L 4 -29.359375 L 10.078125 -29.359375 L 10.078125 -26.015625 C 11.066406 -27.222656 12.332031 -28.160156 13.875 -28.828125 C 15.425781 -29.503906 17.070312 -29.84375 18.8125 -29.84375 Z M 18.8125 -29.84375 "></path></g></g></g><path fill="currentColor" d="M 53.359375 31.652344 L 53.359375 88.6875 L 62.410156 90.859375 L 62.410156 29.484375 Z M 53.359375 31.652344 " fill-opacity="1" fill-rule="nonzero"></path><g clip-path="url(#38f6fcde47)"><path fill="currentColor" d="M 0.339844 47.433594 L 0.339844 72.910156 C 0.339844 73.34375 0.410156 73.769531 0.554688 74.179688 C 0.699219 74.59375 0.90625 74.96875 1.175781 75.3125 C 1.445312 75.65625 1.765625 75.945312 2.132812 76.179688 C 2.503906 76.414062 2.898438 76.582031 3.324219 76.683594 L 9.390625 78.140625 L 9.390625 42.195312 L 3.3125 43.660156 C 2.890625 43.761719 2.492188 43.929688 2.125 44.164062 C 1.761719 44.402344 1.441406 44.6875 1.171875 45.03125 C 0.902344 45.375 0.695312 45.75 0.554688 46.164062 C 0.410156 46.574219 0.339844 46.996094 0.339844 47.433594 Z M 0.339844 47.433594 " fill-opacity="1" fill-rule="nonzero"></path></g><g clip-path="url(#af000f7256)"><path fill="currentColor" d="M 64.996094 95.085938 L 64.996094 25.253906 C 64.996094 25.082031 65.027344 24.917969 65.09375 24.761719 C 65.160156 24.601562 65.253906 24.460938 65.375 24.339844 C 65.496094 24.21875 65.636719 24.125 65.792969 24.0625 C 65.953125 23.996094 66.117188 23.960938 66.289062 23.960938 L 71.460938 23.960938 C 71.632812 23.960938 71.796875 23.996094 71.957031 24.0625 C 72.113281 24.125 72.253906 24.21875 72.375 24.339844 C 72.496094 24.460938 72.589844 24.601562 72.65625 24.761719 C 72.722656 24.917969 72.753906 25.082031 72.753906 25.253906 L 72.753906 95.085938 C 72.753906 95.257812 72.722656 95.421875 72.65625 95.582031 C 72.589844 95.738281 72.496094 95.878906 72.375 96 C 72.253906 96.121094 72.113281 96.214844 71.957031 96.28125 C 71.796875 96.347656 71.632812 96.378906 71.460938 96.378906 L 66.289062 96.378906 C 66.117188 96.378906 65.953125 96.347656 65.792969 96.28125 C 65.636719 96.214844 65.496094 96.121094 65.375 96 C 65.253906 95.878906 65.160156 95.738281 65.09375 95.582031 C 65.027344 95.421875 64.996094 95.257812 64.996094 95.085938 Z M 64.996094 95.085938 " fill-opacity="1" fill-rule="nonzero"></path></g><path fill="currentColor" d="M 22.320312 81.238281 L 22.320312 39.101562 L 11.976562 41.585938 L 11.976562 78.757812 Z M 22.320312 81.238281 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 50.769531 88.066406 L 50.769531 32.277344 L 37.839844 35.378906 L 37.839844 84.960938 Z M 50.769531 88.066406 " fill-opacity="1" fill-rule="nonzero"></path><path fill="currentColor" d="M 24.90625 81.863281 L 35.253906 84.34375 L 35.253906 35.996094 L 24.90625 38.480469 Z M 24.90625 81.863281 " fill-opacity="1" fill-rule="nonzero"></path></svg>
    </div>
    <p>Version: ${versions.pylonVersion}</p>
  </div>
  <h2>Enables TypeScript developers to easily build GraphQL APIs</h2>
  <div class="buttons">
    <a href="https://pylon.cronit.io/docs" class="docs"
      >Read the Docs</add
    >
    <a href="/graphql" class="graphiql">Visit GraphiQL</a>
    <a href="/viewer" class="graphiql">Visit Viewer</a>
  </div>
  </section>
  <section class="not-what-your-looking-for">
  <h2>Not the page you are looking for? 👀</h2>
  <p>
    This page is shown be default whenever a 404 is hit.<br />You can disable this by behavior
    via the <code>landingPage</code> option in the Pylon config. Edit the <code>src/index.ts</code> file
    and add the following code:
  </p>
  <pre>
    <code>
  export const config: PylonConfig = {
    landingPage: false
  }
    </code>
  </pre>
  
  <p>
    When you define a route, this page will no longer be shown. For example, the following code
  will show a "Hello, world!" message at the root of your app:
  </p>
  <pre>
    <code>
  import {app} from '@getcronit/pylon'
  
  app.get("/", c => {
    return c.text("Hello, world!")
  })
    </code>
  </pre>
  </section>
  </main>
  </body>
  </html>`
          )
        }

        return next()
      })
    }
  }
}
