import {createHash} from 'crypto'
import {Plugin} from 'esbuild'
import path from 'path'
import fs from 'fs/promises'

export const imagePlugin: Plugin = {
  name: 'image-plugin',
  setup(build) {
    const outdir = build.initialOptions.outdir
    const publicPath = build.initialOptions.publicPath

    if (!outdir || !publicPath) {
      throw new Error('outdir and publicPath must be set in esbuild options')
    }

    build.onResolve({filter: /\.(png|jpe?g)$/}, async args => {
      const filePath = path.resolve(args.resolveDir, args.path)

      const fileName = path.basename(filePath)
      const extname = path.extname(filePath)
      const hash = createHash('md5')
        .update(filePath + (await fs.readFile(filePath)))
        .digest('hex')
        .slice(0, 8)
      const newFilename = `${fileName}-${hash}${extname}`
      const newFilePath = path.join(outdir, 'media', newFilename)

      // Ensure the directory exists
      await fs.mkdir(path.dirname(newFilePath), {recursive: true})

      // Copy the file
      await fs.copyFile(filePath, newFilePath)

      return {
        path: newFilePath,
        namespace: 'image'
      }
    })

    build.onLoad({filter: /\.png$|\.jpg$/}, async args => {
      const sharp = (await import('sharp')).default

      // Load file and read the dimensions
      const image = sharp(args.path)
      const metadata = await image.metadata()

      // Build the URL with the publicPath and w/h search params
      const url = `${publicPath}/media/${path.basename(args.path)}`

      const searchParams = new URLSearchParams({})

      if (metadata.width) {
        searchParams.set('w', metadata.width.toString())
      }
      if (metadata.height) {
        searchParams.set('h', metadata.height.toString())
      }

      const output = image
        .resize({
          width: Math.min(metadata.width ?? 16, 16),
          height: Math.min(metadata.height ?? 16, 16),
          fit: 'inside'
        })
        .toFormat('webp', {
          quality: 20,
          alphaQuality: 20,
          smartSubsample: true
        })

      const {data, info} = await output.toBuffer({resolveWithObject: true})
      const dataURIBase64 = `data:image/${info.format};base64,${data.toString(
        'base64'
      )}`

      if (dataURIBase64) {
        searchParams.set('blurDataURL', dataURIBase64)
      }

      return {
        contents: `${url}?${searchParams.toString()}`,
        loader: 'text'
      }
    })
  }
}
