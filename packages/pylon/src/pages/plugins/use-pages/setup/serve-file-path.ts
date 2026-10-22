import {Context} from '@getcronit/pylon'
import {createReadStream} from 'fs'
import {stat} from 'fs/promises'
import mime from 'mime'
import {Readable} from 'stream'

export const serveFilePath = async ({
  filePath,
  context
}: {
  filePath: string
  context: Context
}) => {
  let fileStat

  // 1. Optimize I/O: Single stat call replaces access() + stat()
  try {
    fileStat = await stat(filePath)
  } catch (error: any) {
    // If stat fails (file not found), return 404
    return context.notFound()
  }

  // 2. Add Caching: Handle 304 Not Modified
  // This saves massive bandwidth by checking if client has the latest version
  const lastModified = fileStat.mtime.toUTCString()
  const ifModifiedSince = context.req.header('If-Modified-Since')

  if (ifModifiedSince === lastModified) {
    return context.body(null, 304)
  }

  // Standard Headers
  context.header('Last-Modified', lastModified)
  const contentType = mime.getType(filePath) || 'application/octet-stream'
  context.header('Content-Type', contentType)
  context.header('Accept-Ranges', 'bytes')

  const contentLength = fileStat.size

  // Handle HEAD request (return metadata only)
  if (context.req.method === 'HEAD') {
    context.header('Content-Length', contentLength.toString())
    return context.body(null, 200)
  }

  // Range Handling
  let start = 0
  let end = contentLength - 1
  let isPartial = false

  const range = context.req.header('Range')

  if (range && range.startsWith('bytes=')) {
    const parts = range.replace('bytes=', '').split('-')
    const rangeStart = parts[0] ? parseInt(parts[0], 10) : 0
    const rangeEnd = parts[1] ? parseInt(parts[1], 10) : contentLength - 1

    // Basic validation
    if (!isNaN(rangeStart) && !isNaN(rangeEnd) && rangeStart <= rangeEnd) {
      start = rangeStart
      end = rangeEnd
      isPartial = true
    }
  }

  const retrievedLength = end - start + 1

  context.status(isPartial ? 206 : 200)
  context.header('Content-Length', retrievedLength.toString())

  if (isPartial) {
    context.header('Content-Range', `bytes ${start}-${end}/${contentLength}`)
  }

  // 3. Stream Creation
  const stream = createReadStream(filePath, {start, end})

  // Note: If your context supports native Node streams, prefer: return context.body(stream)
  const webStream = Readable.toWeb(stream) as ReadableStream

  return context.body(webStream)
}
