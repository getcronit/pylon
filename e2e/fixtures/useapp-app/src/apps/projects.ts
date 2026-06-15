// One lokalis-shaped app, NEW model: a Pylon whose graphql is declared in the
// constructor, name-tagged tenant-scoped models, owner/shared row abilities, a
// capability-gated admin op (inline requireRole), and role-gated routes. No
// defineApp / .resolvers / useApp — authz primitives only.
import {Pylon} from '@getcronit/pylon'
import {getPrincipal, hasRole, requireRole} from '@getcronit/pylon-auth'
import {authorize, db, defineAbilities, models} from '@getcronit/pylon-db'

// Tenant-scoped (orgId) + deny-by-default. The ability rules register the per-model
// row policy; tenant scoping is the floor underneath them.
const projects_ = models.app('projects', {tenant: 'orgId', secure: true})

@projects_.model() // → projects_task
export class Task extends projects_.Model {
  static objects = db.manager(Task)
  id = projects_.ID()
  orgId = projects_.Text()
  ownerId = projects_.Text()
  shared = projects_.Boolean({default: false})
  title = projects_.Text()
}

// RBAC (admin) + ABAC (owner/shared). Task referenced unconditionally so the
// registration probe governs it; conditions branch on the principal.
defineAbilities((p, can) => {
  const uid = p?.id ?? '__anon__'
  if (hasRole(p, 'admin')) can('manage', 'all')
  can('read', Task, {OR: [{ownerId: uid}, {shared: true}]})
  can('update', Task, {ownerId: uid})
  if (p)
    can('create', Task).stamp(t => {
      t.orgId = String(p.tenant)
      t.ownerId = String(p.id)
    })
})

export const projects = new Pylon({
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
