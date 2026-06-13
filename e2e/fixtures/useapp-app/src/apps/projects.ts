// One lokalis-shaped app: a tenant-scoped Task, owner/shared row abilities, a
// capability-gated admin op, and a role-gated route — all from one defineApp.
import {
  authorize,
  db,
  defineAbilities,
  defineApp,
  getPrincipal,
  hasRole
} from '@getcronit/pylon-app'

// Tenant-scoped (orgId) + deny-by-default. The ability rules below register the
// per-model row policy; tenant scoping is the floor underneath them.
export const projects = defineApp('projects', {tenant: 'orgId', secure: true})

@projects.model() // → projects_task
export class Task extends projects.Model {
  static objects = db.manager(Task)
  id = projects.ID()
  orgId = projects.Text()
  ownerId = projects.Text()
  shared = projects.Boolean({default: false})
  title = projects.Text()
}

// RBAC (admin) + ABAC (owner/shared). Task is referenced unconditionally so the
// registration probe governs it; conditions branch on the principal.
defineAbilities((p, can) => {
  const uid = p?.id ?? '__anon__'
  if (hasRole(p, 'admin')) can('manage', 'all') // org admin
  can('read', Task, {OR: [{ownerId: uid}, {shared: true}]})
  can('update', Task, {ownerId: uid})
  if (p) can('create', Task)
})

export const projectsApp = projects
  .resolvers({
    Query: {
      // ability- + tenant-scoped automatically (no manual auth in the resolver)
      tasks: (): Promise<Task[]> => Task.objects.orderBy('title').all()
    },
    Mutation: {
      createTask: (title: string, shared?: boolean): Promise<Task> => {
        const p = getPrincipal()!
        return Task.objects.create({
          title,
          shared: shared ?? false,
          orgId: String(p.tenant),
          ownerId: String(p.id)
        })
      },
      // get() is read-scoped; authorize('update') is the instance gate
      renameTask: async (id: number, title: string): Promise<Task> => {
        const t = await Task.objects.get({id})
        authorize('update', t) // ForbiddenError if not owner (or admin)
        t.title = title
        await t.$save()
        return t
      },
      // capability gate — needs only the Principal
      adminClearTasks: async (): Promise<number> => {
        const {requireRole} = await import('@getcronit/pylon-app')
        requireRole('admin')
        const all = await Task.objects.unscoped().all()
        for (const t of all) await t.$delete()
        return all.length
      }
    }
  })
  .routes((r: any) => {
    r.get('/projects/whoami', (c: any) => {
      const p = getPrincipal()
      return c.json({id: p?.id ?? null, org: p?.tenant ?? null, roles: p?.roles ?? []})
    })
    // role-gated route (returns 403 directly — clean for a REST surface)
    r.get('/projects/admin/export', (c: any) => {
      if (!hasRole(getPrincipal(), 'admin')) return c.json({error: 'Forbidden'}, 403)
      return c.json({ok: true})
    })
  })
