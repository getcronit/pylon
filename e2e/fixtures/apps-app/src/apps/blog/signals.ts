// blog app — model signals (Django-style). Records an Activity audit row whenever
// an Author is written. Runs inside the request's DB context, so the audit write
// shares the connection/transaction. Registered by importing this module (see
// index.ts) — the receiver closures capture the model classes from ./models.
import {signals} from '@getcronit/pylon-db'
import {Activity, Author} from './models.js'

signals.postSave.connect(Author, ({instance, created}) => {
  return Activity.objects.create({
    action: created ? 'create' : 'update',
    target: instance.name // `instance` is typed as Author
  })
})
