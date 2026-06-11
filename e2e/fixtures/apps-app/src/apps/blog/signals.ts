// blog app — model signals (Django-style). Records an Activity audit row whenever
// an Author is written. Runs inside the request's DB context, so the audit write
// shares the connection/transaction. Registered by importing this module (see
// index.ts) — the receiver closures capture the model classes from ./models.
import {signals} from '@getcronit/pylon-db'
import {Activity, Author} from './models.js'

signals.postSave.connect(Author, ({instances, created}) =>
  // `instances` is typed Author[] (1 element for a single create/save); a bulk
  // createMany fires once with all of them, so the audit write batches too.
  Activity.objects.createMany(
    instances.map(a => ({action: created ? 'create' : 'update', target: a.name}))
  )
)
