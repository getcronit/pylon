// One lokalis-shaped app, NEW model: a Pylon whose graphql is declared in the
// constructor, name-tagged tenant-scoped models, owner/shared row abilities, a
// capability-gated admin op (inline requireRole), and role-gated routes. No
// defineApp / .resolvers / useApp — authz primitives only.
import {Pylon} from '@getcronit/pylon'
import {getPrincipal, hasRole, requireRole, type Principal} from '@getcronit/pylon-auth'
import {authorize, db, models} from '@getcronit/pylon-db'

// Decorator-free: plain model; the app names it (→ projects_task) + sets tenant/secure.
// Owner/shared row rules (ABAC) are co-located in `static abilities`.
export class Task extends models.Model {
  static objects = db.manager(Task)
  id = models.ID()
  orgId = models.Text()
  ownerId = models.Text()
  shared = models.Boolean({default: false})
  title = models.Text()

  static abilities(p: Principal | undefined, can: any) {
    const uid = p?.id ?? '__anon__'
    can('read', {OR: [{ownerId: uid}, {shared: true}]})
    can('update', {ownerId: uid})
    if (p)
      can('create').stamp((t: Task) => {
        t.orgId = String(p.tenant)
        t.ownerId = String(p.id)
      })
  }
}

export const projects = new Pylon({
  name: 'projects',
  db: {
    models: [Task],
    tenant: 'orgId',
    secure: true,
    // CROSS-ENTITY rule (admin → anything) → the app's db config.
    abilities: (p, can) => {
      if (hasRole(p, 'admin')) can('manage', 'all')
    }
  },
  graphql: {
    Query: {
      // ability- + tenant-scoped automatically
      tasks: (): Promise<Task[]> => Task.objects.orderBy('title').all()
    },
    Mutation: {
      createTask: (title: string, shared?: boolean): Promise<Task> =>
        Task.objects.create({title, shared: shared ?? false}),
      renameTask: async (id: number, title: string): Promise<Task> => {
        const t = await Task.objects.get({id})
        authorize('update', t) // ForbiddenError if not owner (or admin)
        t.title = title
        await t.$save()
        return t
      },
      adminClearTasks: async (): Promise<number> => {
        requireRole('admin') // capability gate — needs only the Principal
        const all = await Task.objects.unscoped().all()
        for (const t of all) await t.$delete()
        return all.length
      }
    }
  }
})

projects.get('/projects/whoami', (c: any) => {
  const p = getPrincipal()
  return c.json({id: p?.id ?? null, org: p?.tenant ?? null, roles: p?.roles ?? []})
})
projects.get('/projects/admin/export', (c: any) => {
  if (!hasRole(getPrincipal(), 'admin')) return c.json({error: 'Forbidden'}, 403)
  return c.json({ok: true})
})
