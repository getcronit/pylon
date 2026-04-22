import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {extractAdvancedSelectors, extractQueries} from './analyze'

describe('Selector Tracker Ultra-Advanced Analysis', () => {
  it('should handle direct aliasing and function calls with named arguments', () => {
    const input = `
      const id = "123";
      const user = data.user({ id });
      const name = user.name;
      const age = user.age(true); // Positional ignored as per GQL

      console.log(user.name);
      console.log(user.age);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        __args: '{ id }',
        name: true,
        age: [{__args: 'true'}, {}]
      }
    })
  })

  it('should handle deep object destructuring', () => {
    const input = `
      const { user: { profile: { firstName, lastName } } } = data;
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        profile: {
          firstName: true,
          lastName: true
        }
      }
    })
  })

  it('should handle React component props destructuring', () => {
    const input = `
      function MyComponent({ data: { user } }) {
        return <div>{user.name}</div>
      }
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        name: true
      }
    })
  })

  it('should handle nested high-order functions and callbacks', () => {
    const input = `
      data.users.filter(u => u.active).map(u => {
        return <div>{u.profile.email}</div>
      });
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        active: true,
        profile: {
          email: true
        }
      }
    })
  })

  it('should handle re-assignments (flow-sensitive)', () => {
    const input = `
      let x = data.user;
      x.name;
      x = data.admin;
      x.role;
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        name: true
      },
      admin: {
        role: true
      }
    })
  })

  it('should handle recursive functions', () => {
    const input = `
      function traverse(node) {
        console.log(node.label);
        if (node.children) {
          node.children.forEach(child => traverse(child));
        }
      }
      traverse(data.menu);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      menu: {
        label: true,
        children: {
          __isList: true,
          label: true,
          children: {
            __isList: true
          }
        }
      }
    })
  })

  it('should handle generic for-loops with index access (flattened)', () => {
    const input = `
      function processItems(items) {
        for (let i = 0; i < items.length; i++) {
          console.log(items[i].id);
        }
      }
      processItems(data.projects);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      projects: {
        __isList: true,
        id: true
      }
    })
  })

  it('should handle a mega-complex scenario (all features combined)', () => {
    const input = `
      function MegaComponent({ data: root }) {
        const { user } = root.session({ id: "current" });
        const [settings, setSettings] = root.useSettings();
        
        let display = user.profile.name;
        if (settings.anonymous) {
          display = "Anonymous";
        }

        function walk(node) {
          console.log(node.title);
          node.meta?.tags?.forEach(t => console.log(t.name));
          if (node.sub) walk(node.sub);
        }

        return (
          <div>
            <h1>{display}</h1>
            {root.projects.filter(p => !p.hidden).map(p => {
              for (let i=0; i < p.tasks.length; i++) {
                console.log(p.tasks[i].id);
              }
              walk(p.structure);
              return <p>{p.title}</p>;
            })}
          </div>
        );
      }
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      session: {
        __args: '{ id: "current" }',
        user: {
          profile: {name: true}
        }
      },
      useSettings: {
        anonymous: true
      },
      projects: {
        __isList: true,
        hidden: true,
        tasks: {
          __isList: true,
          id: true
        },
        structure: {
          meta: {
            tags: {
              __isList: true,
              name: true
            }
          },
          sub: {
            meta: {
              tags: {
                __isList: true,
                name: true
              }
            },
            sub: true,
            title: true
          },
          title: true
        },
        title: true
      }
    })
  })

  it('should handle optional chaining and nullish coalescing', () => {
    const input = `
      const id = data?.user?.id ?? data?.admin?.id;
      console.log(id);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {id: true},
      admin: {id: true}
    })
  })

  it('should handle array reduce method', () => {
    const input = `
      const total = data.orders.reduce((acc, order) => {
        return acc + order.total.amount;
      }, 0);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      orders: {
        __isList: true,
        total: {amount: true}
      }
    })
  })

  it('should handle destructuring in for-of loops', () => {
    const input = `
      for (const { profile: { email } } of data.users) {
        console.log(email);
      }
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        profile: {email: true}
      }
    })
  })

  it('should handle conditional (ternary) operator', () => {
    const input = `
      const role = data.isAdmin ? data.admin.roles : data.user.roles;
      role.forEach(r => console.log(r.name));
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      isAdmin: true,
      admin: {roles: {__isList: true, name: true}},
      user: {roles: {__isList: true, name: true}}
    })
  })

  it('should track aliases returned from functions', () => {
    const input = `
      function getAdmin() { 
        return data.admin; 
      }
      const adminAlias = getAdmin();
      console.log(adminAlias.permissions[0].level);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      admin: {permissions: {__isList: true, level: true}}
    })
  })

  it('should branch objects into arrays when fields are fetched with different arguments', () => {
    const input = `
      const u1 = data.user({ id: "1" });
      console.log(u1.name);
      
      const u2 = data.user({ id: "2" });
      console.log(u2.age);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: [
        {__args: '{ id: "1" }', name: true},
        {__args: '{ id: "2" }', age: true}
      ]
    })
  })

  it('should merge perfectly identical argument branches', () => {
    const input = `
      data.user({ id: "1" }).name;
      data.user({ id: "1" }).age;
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        __args: '{ id: "1" }',
        name: true,
        age: true
      }
    })
  })

  it('should ignore JS internals and prototype properties', () => {
    const input = `
      const u = data.user;
      console.log(u.name);
      console.log(u.name.length);
      console.log(u.age.toString());
      console.log(data.users.length);
      data.users.push(u);
      
      const boundFn = u.update.bind(u);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        name: true,
        age: true,
        update: true
      },
      users: {
        __isList: true
      }
    })
  })
})

describe('useData Location Extraction', () => {
  it('should extract a single useData basic location', () => {
    const input = `
      import { useData } from "@getcronit/pylon/pages";
      function MyComponent() {
        const data = useData();
        console.log(data.user.name);
      }
    `
    const project = new Project({useInMemoryFileSystem: true})
    project.createSourceFile('temp.tsx', input)
    const {queries} = extractQueries('temp.tsx', project)
    expect(queries.length).toBe(1)
    expect(queries[0].selectors).toEqual({user: {name: true}})
  })

  it('should resolve aliased useData imports', () => {
    const input = `
      import { useData as myQuery } from "@getcronit/pylon/pages";
      function MyComponent() {
        const { admin } = myQuery();
        console.log(admin.role);
      }
    `
    const project = new Project({useInMemoryFileSystem: true})
    project.createSourceFile('temp.tsx', input)
    const {queries} = extractQueries('temp.tsx', project)
    expect(queries.length).toBe(1)
    expect(queries[0].selectors).toEqual({admin: {role: true}})
  })

  it('should ignore pylon internal $ prefixed properties', () => {
    const input = `
      import { useData } from "@getcronit/pylon/pages";
      function MyComponent() {
        const data = useData();
        console.log(data.user.name);
        console.log(data.$state); // skipped
        data.$refetch(); // skipped
        const { $error } = data; // skipped
        if ($error) console.log($error);
      }
    `
    const project = new Project({useInMemoryFileSystem: true})
    project.createSourceFile('temp.tsx', input)
    const {queries} = extractQueries('temp.tsx', project)
    expect(queries.length).toBe(1)
    expect(queries[0].selectors).toEqual({user: {name: true}})
  })

  it('should independently track multiple useData calls in the same file', () => {
    const input = `
      import { useData } from "@getcronit/pylon/pages";
      import { useData as myQuery } from "@getcronit/pylon/pages";

      function ComponentA() {
        const dataA = useData();
        console.log(dataA.post.title);
      }

      function ComponentB() {
        const dataB = useData();
        console.log(dataB.author.name);
        
        const { admin } = myQuery();
        console.log(admin.level);
      }
    `
    const project = new Project({useInMemoryFileSystem: true})
    project.createSourceFile('temp.tsx', input)
    const {queries} = extractQueries('temp.tsx', project)
    expect(queries.length).toBe(3)
    expect(queries[0].selectors).toEqual({post: {title: true}})
    expect(queries[1].selectors).toEqual({author: {name: true}})
    expect(queries[2].selectors).toEqual({admin: {level: true}})
  })

  it('should handle data access inside JSX event handlers', () => {
    const input = `
      import { useData } from "@getcronit/pylon/pages";
      export function MyComponent() {
        const data = useData();
        return <button onClick={() => console.log(data.user.email)}>Click</button>;
      }
    `
    const project = new Project({useInMemoryFileSystem: true})
    project.createSourceFile('temp.tsx', input)
    const {queries} = extractQueries('temp.tsx', project)
    expect(queries[0].selectors).toEqual({user: {email: true}})
  })

  it('should handle dynamic function calls with primitives in JSX', () => {
    const input = `
      import { useData } from "@getcronit/pylon/pages";
      export function MyComponent({ input }) {
        const data = useData();
        return <p>{data.dyno({input})}</p>;
      }
    `
    const project = new Project({useInMemoryFileSystem: true})
    project.createSourceFile('temp.tsx', input)
    const {queries} = extractQueries('temp.tsx', project)
    expect(queries[0].selectors).toEqual({dyno: {__args: '{input}'}})
  })
})

describe('Cross-File Analysis (In-Memory)', () => {
  it('should resolve fields from imported components using in-memory FS', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4 // ReactJSX
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/Child.tsx',
      `
      export function Child({ user }: { user: { name: string, email: string } }) {
        return (
          <div>
            <h1>{user.name}</h1>
          </div>
        );
      }
    `
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon/pages';
      import { Child } from './Child';

      export default function Page() {
        const { data } = useData();
        
        return (
          <div>
            <Child user={data.user} />
            <p>{data.status}</p>
          </div>
        );
      }
    `
    )

    // Perform analysis
    const {queries} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      data: {
        status: true,
        user: {
          name: true
        }
      }
    })
  })

  it('should handle multi-level cross-file resolution', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/GrandChild.tsx',
      `
      export function GrandChild({ info }) {
        return <span>{info.detail}</span>;
      }
    `
    )

    project.createSourceFile(
      '/Child.tsx',
      `
      import { GrandChild } from './GrandChild';
      export function Child({ user }) {
        return (
          <div>
            <h1>{user.name}</h1>
            <GrandChild info={user.meta} />
          </div>
        );
      }
    `
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon/pages';
      import { Child } from './Child';

      export default function Page() {
        const { data } = useData()
        return <Child user={data.user} />;
      }
    `
    )

    const {queries} = extractQueries('/Parent.tsx', project)

    expect(queries[0].selectors).toEqual({
      data: {
        user: {
          name: true,
          meta: {
            detail: true
          }
        }
      }
    })
  })

  it('should track all accessed files in dependencies', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/Child.tsx',
      'export function Child({ user }) { return <h1>{user.name}</h1>; }'
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon/pages';
      import { Child } from './Child';
      export default function Page() {
        const { data } = useData();
        return <Child user={data.user} />;
      }
    `
    )

    const {queries, dependencies} = extractQueries('/Parent.tsx', project)

    expect(queries).toHaveLength(1)
    expect(dependencies).toContain('/Parent.tsx')
    expect(dependencies).toContain('/Child.tsx')
    expect(dependencies.length).toBe(2)
  })
})

describe('High-End Complexity Edge Cases', () => {
  it('should handle branching with different arguments on the same field', () => {
    const input = `
      let u;
      if (condition) {
        u = data.user({ id: "1" });
      } else {
        u = data.user({ id: "2" });
      }
      console.log(u.email);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: [
        {__args: '{ id: "1" }', email: true},
        {__args: '{ id: "2" }', email: true}
      ]
    })
  })

  it('should handle array find/some/every methods with destructuring', () => {
    const input = `
      const found = data.users.find(({ profile: { id } }) => id === "active");
      const isAnyAdmin = data.users.some(u => u.roles.includes("admin"));
      const areAllActive = data.users.every(({ status }) => status === "active");
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        profile: {id: true},
        roles: {__isList: true},
        status: true
      }
    })
  })

  it('should handle element access with list marking', () => {
    const input = `
      const firstUser = data.users[0];
      console.log(firstUser.profile.name);
      
      const specificPost = data.posts["latest"];
      console.log(specificPost.title);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        profile: {name: true}
      },
      posts: {
        __isList: true,
        title: true
      }
    })
  })

  it('should handle switch statements for flow-sensitive tracking', () => {
    const input = `
      let target;
      switch (type) {
        case "user":
          target = data.user;
          break;
        case "admin":
          target = data.admin;
          break;
        default:
          target = data.guest;
      }
      console.log(target.permissions);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {permissions: true},
      admin: {permissions: true},
      guest: {permissions: true}
    })
  })

  it('should handle very deep optional chaining with nullish coalescing', () => {
    const input = `
      const detail = data?.organization?.departments?.[0]?.teams?.find(t => t.active)?.leader?.name ?? "Unknown";
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      organization: {
        departments: {
          __isList: true,
          teams: {
            __isList: true,
            active: true,
            leader: {name: true}
          }
        }
      }
    })
  })
})
