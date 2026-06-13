import {Plugin} from 'esbuild'
import path from 'path'
import fs from 'fs/promises'
import loadConfig from 'postcss-load-config'
import postcss from 'postcss'

export const postcssPlugin: Plugin = {
  name: 'postcss-plugin',
  setup(build) {
    build.onLoad({filter: /.css$/, namespace: 'file'}, async args => {
      const {plugins, options} = await loadConfig()

      const css = await fs.readFile(args.path, 'utf-8')

      const result = await postcss(plugins)
        .process(css, {
          ...options,
          from: args.path
        })
        .then(result => result)

      return {
        contents: result.css,
        loader: 'css'
      }
    })
  }
}
