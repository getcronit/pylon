import {Context} from '@/context'
import {access, stat} from 'fs/promises'
import {createReadStream} from 'fs'
import mime from 'mime'
import {Readable} from 'stream'

export const serveFilePath = async ({
  filePath,
  context
}: {
  filePath: string
  context: Context
}) => {
  try {
    await access(filePath)
  } catch (error) {
    return context.notFound()
  }

  try {
    const contentType = mime.getType(filePath) || 'application/octet-stream'

    context.header('Content-Type', contentType)

    let options: {start?: number; end?: number} = {}
    let start: number | undefined
    let end: number | undefined

    const range = context.req.header('Range')

    if (range) {
      const bytesPrefix = 'bytes='
      if (range.startsWith(bytesPrefix)) {
        const bytesRange = range.substring(bytesPrefix.length)
        const parts = bytesRange.split('-')

        if (parts.length === 2) {
          const rangeStart = parts[0]?.trim()
          if (rangeStart) {
            options.start = start = parseInt(rangeStart, 10)
          }

          const rangeEnd = parts[1]?.trim()
          if (rangeEnd) {
            options.end = end = parseInt(rangeEnd, 10)
          }
        }
      }
    }

    context.header('Accept-Ranges', 'bytes')

    const fileStat = await stat(filePath)
    const contentLength = fileStat.size

    if (context.req.method === 'HEAD') {
      context.status(200)
      context.header('Accept-Ranges', 'bytes')
      context.header('Content-Length', contentLength.toString())

      return context.body(null, 200)
    }

    let retrievedLength: number
    if (start !== undefined && end !== undefined) {
      retrievedLength = end + 1 - start
    } else if (start !== undefined) {
      retrievedLength = contentLength - start
    } else if (end !== undefined) {
      retrievedLength = end + 1
    } else {
      retrievedLength = contentLength
    }

    context.status(start !== undefined || end !== undefined ? 206 : 200)

    context.header('Content-Length', retrievedLength.toString())

    if (range !== undefined) {
      context.header(
        'Content-Range',
        `bytes ${start || 0}-${end || contentLength - 1}/${contentLength}`
      )
      context.header('Accept-Ranges', 'bytes')
    }

    if (contentType === 'video/mp4') {
      console.log('Serving file', filePath, 'with options', options)
      console.log('Content-Length', contentLength)
      console.log('Content-Type', contentType)
      console.log('Range', range)
      console.log('Start', start)
      console.log('End', end)
    }

    const stream = createReadStream(filePath, options)
    const webStream = Readable.toWeb(stream) as ReadableStream

    return context.body(webStream)
  } catch (error) {
    return context.text('Error reading file', 500)
  }
}
