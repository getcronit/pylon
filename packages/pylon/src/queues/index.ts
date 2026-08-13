export {
  defineQueue,
  cron,
  startWorkers,
  registeredQueues,
  setJobRunner,
  QueueDefinition,
  type QueueOptions,
  type JobContext,
  type Processor,
  type PayloadSchema
} from './queue.js'
// Queues authored as classes (the model-mirrored form). No decorator — registration is
// the `new Pylon({queues: [...]})` constructor option; per-queue options live in `static config`.
export {
  Queue,
  manager,
  getQueueDefinition,
  type JobManager,
  type QueueClassOptions,
  type QueueConfig,
  type PayloadSchemaLike,
  type Parsed
} from './queue-class.js'
// Importing app.js registers the queue construct-hook on core's extension bus (evaluating
// a re-exported value runs the module). No-op until core loads — keeps core an optional peer.
export {queuesOf} from './app.js'
// `useQueues` is the CONFIG PLUGIN → `@getcronit/pylon/queues/plugin` (plugin.ts),
// not the authoring-API root. Uniform convention: root = API, /plugin = plugin.
export {getConnection, setConnection, closeConnection} from './connection.js'
export {
  setOutboxDriver,
  getOutboxDriver,
  relayOnce,
  runOutboxRelay,
  type OutboxDriver,
  type OutboxRow
} from './outbox.js'
export {createPgOutbox} from './pg-outbox.js'
