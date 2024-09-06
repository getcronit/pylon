import type {MiddlewareHandler} from 'hono'
import {html} from 'hono/html'

export const graphqlViewerHandler: MiddlewareHandler = async (c, next) => {
  return c.html(html`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Pylon Viewer</title>
        <script src="https://cdn.jsdelivr.net/npm/react@16/umd/react.production.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/react-dom@16/umd/react-dom.production.min.js"></script>

        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/graphql-voyager/dist/voyager.css"
        />
        <style>
            body {
              padding: 0;
              margin: 0;
              width: 100%;
              height: 100vh;
              overflow: hidden;
            }

            #voyager {
              height: 100%;
              position: relative;
            }
          }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/graphql-voyager/dist/voyager.min.js"></script>
      </head>
      <body>
        <div id="voyager">Loading...</div>
        <script>
          function introspectionProvider(introspectionQuery) {
            // ... do a call to server using introspectionQuery provided
            // or just return pre-fetched introspection

            // Endpoint is current path instead of root/graphql
            const endpoint = window.location.pathname.replace(
              '/viewer',
              '/graphql'
            )

            return fetch(endpoint, {
              method: 'post',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({query: introspectionQuery})
            }).then(response => response.json())
          }

          // Render <Voyager />
          GraphQLVoyager.init(document.getElementById('voyager'), {
            introspection: introspectionProvider
          })
        </script>
      </body>
    </html>
  `)
}
