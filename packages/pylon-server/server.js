#!/usr/bin/env bun

// Set default env variables
process.env.NODE_ENV = process.env.NODE_ENV || 'production'

import {logger} from '@getcronit/pylon'
import {makeApp, runtime} from '@getcronit/pylon-server'
import {Command} from 'commander'
import fs from 'fs'
import path from 'path'

const program = new Command()

program.option('--https', 'Enable HTTPS')
program.option(
  '--key <path>',
  'Path to private key file',
  path.resolve('keys/key.pem')
)
program.option(
  '--cert <path>',
  'Path to certificate file',
  path.resolve('keys/cert.pem')
)
program.option('--passphrase <passphrase>', 'Passphrase for private key')
program.option('--ca <path>', 'Path to CA certificate file')
program.option('--port <port>', 'Port for the server', 3000)

program.parse(process.argv)

const args = program.opts()

let buildLocation = program.args[0] || './.pylon'

const indexLocation = path.resolve(process.cwd(), buildLocation, 'index.js')
const schemaLocation = path.resolve(
  process.cwd(),
  buildLocation,
  'schema.graphql'
)

// Rest of the script remains the same up to importing sfi...

const {
  default: sfi,
  configureApp,
  configureServer,
  configureWebsocket
} = await import(indexLocation)

// Load schema
const typeDefs = fs.readFileSync(schemaLocation, 'utf8')

const app = await makeApp({
  schema: {
    typeDefs: typeDefs,
    resolvers: sfi.graphqlResolvers
  },
  configureApp: configureApp
})

let tls = undefined

if (args.https) {
  tls = {}

  if (!args.key || !args.cert) {
    throw new Error('Both key and cert options are required for HTTPS')
  }
  tls.key = fs.readFileSync(path.resolve(args.key))
  tls.cert = fs.readFileSync(path.resolve(args.cert))

  if (args.passphrase) {
    tls.passphrase = args.passphrase
  }

  if (args.ca) {
    tls.ca = fs.readFileSync(path.resolve(args.ca))
  }
}

const server = Bun.serve({
  ...app,
  port: args.port,
  tls,
  websocket: configureWebsocket ? configureWebsocket(runtime.server) : undefined
})

configureServer?.(server)

runtime.server = server

logger.info(`Server listening on port ${args.port}`)

process.send?.('ready')
