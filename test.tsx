

import { renderToString, version } from 'react-dom/server'
import { createElement, version as reactVersion } from 'react'

console.log('Version', version, reactVersion)

console.log('Page', renderToString(<></>))
