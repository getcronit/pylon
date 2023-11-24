import {build} from '@cronitio/pylon-builder'

import {sfiBuildPath, sfiSourcePath} from '../constants.js'

export default async (options: {client?: boolean}) => {
  await build({
    sfiFilePath: sfiSourcePath,
    outputFilePath: sfiBuildPath,
    withClient: options.client
  })
}
