import http from 'node:http'

/**
 * Tier-0 live-reload: a tiny SSE server owned by the dev CLI (the stable process —
 * it survives the app-server restarts). The pages client opens an EventSource to it
 * and reloads on a pushed `reload` event. Living on the CLI (not the app) means the
 * connection isn't torn down every rebuild, so the reload is a direct push rather
 * than an inferred reconnect — and it works for pages that issue no GraphQL query
 * (the old version-header check never fires for those).
 */
export interface DevReloadServer {
  /** The port the SSE server bound to (PORT+1, or the next free port up). */
  port: number
  /** Push a `reload` event to every connected browser. */
  notify: () => void
  close: () => Promise<void>
}

const RELOAD_PATH = '/__pylon_reload'

export async function startDevReloadServer(
  startPort: number
): Promise<DevReloadServer> {
  const clients = new Set<http.ServerResponse>()

  const server = http.createServer((req, res) => {
    // Cross-origin: the page is served from the APP port, this lives on another.
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (req.url !== RELOAD_PATH) {
      res.writeHead(404).end()
      return
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    })
    // Suggest a fast reconnect so a dropped stream re-attaches quickly.
    res.write('retry: 250\n\n')
    clients.add(res)

    // Heartbeat so intermediaries don't reap an idle stream.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        /* connection gone */
      }
    }, 30_000)
    heartbeat.unref?.()

    req.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(res)
    })
  })

  const port = await listenFromPort(server, startPort)

  return {
    port,
    notify: () => {
      for (const res of clients) {
        try {
          res.write('event: reload\ndata: {}\n\n')
        } catch {
          /* connection gone — `close` will prune it */
        }
      }
    },
    close: () =>
      new Promise<void>(resolve => {
        for (const res of clients) {
          try {
            res.end()
          } catch {
            /* already closed */
          }
        }
        clients.clear()
        server.close(() => resolve())
      })
  }
}

/**
 * Bind `server` to `startPort`; on EADDRINUSE try the next port up, and so on.
 * Resolves with the port actually bound.
 */
function listenFromPort(
  server: http.Server,
  startPort: number,
  maxTries = 100
): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = startPort
    let tries = 0

    const attempt = () => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && tries++ < maxTries) {
          port++
          attempt()
        } else {
          reject(err)
        }
      }
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError)
        resolve(port)
      })
    }

    attempt()
  })
}
