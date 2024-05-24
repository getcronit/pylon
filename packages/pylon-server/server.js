#!/usr/bin/env bun

// Set default env variables
process.env.NODE_ENV = process.env.NODE_ENV || 'production'

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

let buildLocation = program.args[0] || './.pylon/index.js'

// Rest of the script remains the same up to importing sfi...

const {
  default: sfi,
  typeDefs,
  configureApp,
  configureServer,
  configureWebsocket
} = await import(path.resolve(process.cwd(), buildLocation))

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

console.log(`Listening on localhost:`, server.port)
