import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {extractAdvancedSelectors, extractQueries} from './analyze'

describe('Selector Tracker Ultra-Advanced Analysis', () => {
  it('should handle direct aliasing and function calls with named arguments', () => {
    const input = `
      const u = data.user({ id: "123" });
      const email = u.email;
      console.log(email);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        __args: '{ id: "123" }',
        email: true
      }
    })
  })

  it('should handle deep object destructuring', () => {
    const input = `
      const { profile: { name, address: { city } } } = data.user;
      console.log(name, city);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        profile: {
          name: true,
          address: {
            city: true
          }
        }
      }
    })
  })

  it('should handle React component props destructuring', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Component.tsx',
      `
      export function MyComponent({ data: { user } }) {
        return <div>{user.name}</div>;
      }
      `
    )
    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { MyComponent } from './Component';
      export default function Page() {
        const data = useData();
        return <MyComponent data={data} />;
      }
      `
    )
    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors).toEqual({
      user: {
        name: true
      }
    })
  })

  it('should handle nested high-order functions and callbacks', () => {
    const input = `
      data.users.map(u => {
        return u.posts.filter(p => p.published).map(p => p.title);
      });
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        posts: {
          __isList: true,
          published: true,
          title: true
        }
      }
    })
  })

  it('should handle re-assignments (flow-sensitive)', () => {
    const input = `
      let x;
      if (condition) {
        x = data.user;
      } else {
        x = data.admin;
      }
      console.log(x.permissions);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {permissions: true},
      admin: {permissions: true}
    })
  })

  it('should handle recursive functions', () => {
    const input = `
      function walk(node) {
        console.log(node.name);
        if (node.children) {
          node.children.forEach(walk);
        }
      }
      walk(data.root);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      root: {
        name: true,
        children: {
          __isList: true,
          name: true,
          children: {
            __isList: true
          }
        }
      }
    })
  })

  it('should handle generic for-loops with index access (flattened)', () => {
    const input = `
      const users = data.users;
      for (let i = 0; i < users.length; i++) {
        console.log(users[i].username);
      }
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        username: true
      }
    })
  })

  it('should handle a mega-complex scenario (all features combined)', () => {
    const input = `
      const { tickets } = data;
      const processed = tickets.map(t => {
        const { author, comments } = t;
        const commentAuthors = comments.map(c => c.author.name);
        return {
          title: t.title,
          authorName: author.name,
          commentAuthors
        };
      });
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      tickets: {
        __isList: true,
        title: true,
        author: {
          name: true
        },
        comments: {
          __isList: true,
          author: {
            name: true
          }
        }
      }
    })
  })

  it('should handle optional chaining and nullish coalescing', () => {
    const input = `
      const name = data?.user?.profile?.name ?? "Anonymous";
      const city = data.user.address?.city;
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        profile: {
          name: true
        },
        address: {
          city: true
        }
      }
    })
  })

  it('should select fields whose name collides with a JS builtin', () => {
    // `match`, `filter`, `replace`, `some` are String/Array methods — but here they
    // are never invoked, so they are GraphQL fields, not builtins. Regression: the
    // builtin bail-out used to swallow them and drop them from the query entirely.
    const input = `
      const m = data.hit.match;
      const t = m?.__typename;
      const id = m!.id;
      const f = data.hit.filter.label;
      const s = data.hit.some;
      console.log(t, id, f, s);
    `
    expect(extractAdvancedSelectors(input, 'data')).toEqual({
      hit: {
        match: {__typename: true, id: true},
        filter: {label: true},
        some: true
      }
    })
  })

  it('should still treat invoked builtins as JS, not fields', () => {
    const input = `
      const hits = data.title.match(/x/);
      const big = data.items.filter(i => i.big);
      const n = data.items.length;
      console.log(hits, big, n);
    `
    // `match(...)` and `length` emit no field of their own; `filter(...)` stays a
    // JS array method — it marks the list and traces `i.big` out of its callback.
    expect(extractAdvancedSelectors(input, 'data')).toEqual({
      title: true,
      items: {__isList: true, big: true}
    })
  })

  it('should handle array reduce method', () => {
    const input = `
      const total = data.items.reduce((acc, item) => acc + item.price, 0);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      items: {
        __isList: true,
        price: true
      }
    })
  })

  it('should handle destructuring in for-of loops', () => {
    const input = `
      for (const { id, name } of data.users) {
        console.log(id, name);
      }
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __isList: true,
        id: true,
        name: true
      }
    })
  })

  it('should handle conditional (ternary) operator', () => {
    const input = `
      const info = condition ? data.user.email : data.admin.role;
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {email: true},
      admin: {role: true}
    })
  })

  it('should track aliases returned from functions', () => {
    const input = `
      function getUser() { return data.user; }
      const u = getUser();
      console.log(u.id);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {id: true}
    })
  })

  it('should branch objects into arrays when fields are fetched with different arguments', () => {
    const input = `
      const u1 = data.user({ id: "1" });
      const u2 = data.user({ id: "2" });
      console.log(u1.name, u2.email);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: [
        {__args: '{ id: "1" }', name: true},
        {__args: '{ id: "2" }', email: true}
      ]
    })
  })

  it('should merge perfectly identical argument branches', () => {
    const input = `
      const u1 = data.user({ id: "1" });
      const u2 = data.user({ id: "1" });
      console.log(u1.name, u2.email);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        __args: '{ id: "1" }',
        name: true,
        email: true
      }
    })
  })

  it('should ignore JS internals and prototype properties', () => {
    const input = `
      const u = data.user;
      const s = u.toString();
      const h = u.hasOwnProperty("id");
      const v = u.valueOf();
      console.log(u.name);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      user: {
        name: true
      }
    })
  })
})

describe('useData Location Extraction', () => {
  it('should extract a single useData basic location', () => {
    const project = new Project({useInMemoryFileSystem: true})
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      import { useData } from '@getcronit/pylon-pages';
      export default function Page() {
        const data = useData();
        return data.user.name;
      }
    `
    )

    const {queries} = extractQueries('test.ts', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      user: {name: true}
    })
  })

  it('should resolve aliased useData imports', () => {
    const project = new Project({useInMemoryFileSystem: true})
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      import { useData as usePylonData } from '@getcronit/pylon-pages';
      export default function Page() {
        const data = usePylonData();
        return data.user.email;
      }
    `
    )

    const {queries} = extractQueries('test.ts', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      user: {email: true}
    })
  })

  it('should ignore pylon internal $ prefixed properties', () => {
    const project = new Project({useInMemoryFileSystem: true})
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      import { useData } from '@getcronit/pylon-pages';
      export default function Page() {
        const data = useData();
        data.$on('event', () => {});
        return data.user.id;
      }
    `
    )

    const {queries} = extractQueries('test.ts', project)
    expect(queries[0].selectors).toEqual({
      user: {id: true}
    })
  })

  it('should independently track multiple useData calls in the same file', () => {
    const project = new Project({useInMemoryFileSystem: true})
    const sourceFile = project.createSourceFile(
      'test.ts',
      `
      import { useData } from '@getcronit/pylon-pages';
      export default function Page() {
        const data1 = useData();
        const data2 = useData();
        console.log(data1.user.name);
        console.log(data2.admin.role);
      }
    `
    )

    const {queries} = extractQueries('test.ts', project)
    expect(queries).toHaveLength(2)
    expect(queries.find(q => q.selectors.user)?.selectors).toEqual({
      user: {name: true}
    })
    expect(queries.find(q => q.selectors.admin)?.selectors).toEqual({
      admin: {role: true}
    })
  })
})

describe('Cross-File Analysis (In-Memory)', () => {
  it('should handle data access inside JSX event handlers', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      'test.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      export default function Page() {
        const data = useData();
        return <button onClick={() => alert(data.user.name)}>Click me</button>;
      }
    `
    )
    const {queries} = extractQueries('test.tsx', project)
    expect(queries[0].selectors).toEqual({
      user: {name: true}
    })
  })

  it('should handle dynamic function calls with primitives in JSX', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      'test.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      const format = (name) => "User: " + name;
      export default function Page() {
        const data = useData();
        return <div>{format(data.user.name)}</div>;
      }
    `
    )
    const {queries} = extractQueries('test.tsx', project)
    expect(queries[0].selectors).toEqual({
      user: {name: true}
    })
  })

  it('should resolve fields from imported components using in-memory FS', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Ticket.tsx',
      `
      export function Ticket({ticket}) {
        return <div>{ticket.title}</div>;
      }
    `
    )
    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { Ticket } from './Ticket';
      export default function Page() {
        const data = useData();
        return <Ticket ticket={data.ticket} />;
      }
    `
    )
    const {queries, dependencies} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(dependencies).toContain('/Ticket.tsx')
    expect(queries[0].selectors).toEqual({
      ticket: {title: true}
    })
  })

  it('should handle multi-level cross-file resolution', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Profile.tsx',
      'export function Profile({user}) { return <div>{user.name}</div>; }'
    )
    project.createSourceFile(
      '/UserCard.tsx',
      `
      import { Profile } from './Profile';
      export function UserCard({user}) {
        return (
          <div>
            <h1>{user.id}</h1>
            <Profile user={user} />
          </div>
        );
      }
    `
    )
    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { UserCard } from './UserCard';
      export default function Page() {
        const data = useData();
        return <UserCard user={data.user} />;
      }
    `
    )
    const {queries, dependencies} = extractQueries('/Parent.tsx', project)
    expect(dependencies).toContain('/Profile.tsx')
    expect(dependencies).toContain('/UserCard.tsx')
    expect(queries[0].selectors).toEqual({
      user: {
        id: true,
        name: true
      }
    })
  })

  it('should track all accessed files in dependencies', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile('/a.ts', 'export const a = 1;')
    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { a } from './a';
      export default function Page() {
        const data = useData();
        return <div>{a} {data.user.id}</div>;
      }
    `
    )
    const {dependencies} = extractQueries('/Parent.tsx', project)
    // expect(dependencies).toContain('/a.ts')
    expect(dependencies).toContain('/Parent.tsx')
  })

  it('should handle passing data to a function re-exported via index', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/hook.ts',
      'export function useTicketInfo(props) { return props.pageInfo.totalCount; }'
    )

    project.createSourceFile('/hooks/index.ts', 'export * from "../hook";')

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { useTicketInfo } from './hooks';
      export default function Page() {
        const data = useData();
        return <div>{useTicketInfo({ pageInfo: data.tickets({}).pageInfo })}</div>;
      }
    `
    )

    const {queries, dependencies} = extractQueries('/Parent.tsx', project)

    expect(queries).toHaveLength(1)
    expect(dependencies).toContain('/Parent.tsx')
    expect(dependencies).toContain('/hook.ts')
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{}',
        pageInfo: {
          totalCount: true
        }
      }
    })
  })

  it('should handle passing data to a function with destructured parameters re-exported via index', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/hook.ts',
      'export function useTicketInfo({pageInfo}) { return pageInfo.totalCount; }'
    )

    project.createSourceFile('/hooks/index.ts', 'export * from "../hook";')

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { useTicketInfo } from './hooks';
      export default function Page() {
        const data = useData();
        return <div>{useTicketInfo({ pageInfo: data.tickets({}).pageInfo })}</div>;
      }
    `
    )

    const {queries, dependencies} = extractQueries('/Parent.tsx', project)

    expect(queries).toHaveLength(1)
    expect(dependencies).toContain('/Parent.tsx')
    expect(dependencies).toContain('/hook.ts')
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{}',
        pageInfo: {
          totalCount: true
        }
      }
    })
  })
  it('should handle call expression without arguments', () => {
    const input = `
      const users = data.users();
      console.log(users.id);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __args: '',
        id: true
      }
    })
  })

  it('should handle call expression without arguments (standalone)', () => {
    const input = `data.users();`
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      users: {
        __args: ''
      }
    })
  })

  it('should handle call expression without arguments in Parent.tsx', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/hook.ts',
      'export function useTicketInfo({pageInfo}) { return pageInfo.totalCount; }'
    )

    project.createSourceFile('/hooks/index.ts', 'export * from "../hook";')

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { useTicketInfo } from './hooks';
      export default function Page() {
        const data = useData();
        return <div>{useTicketInfo({ pageInfo: data.tickets().pageInfo })}</div>;
      }
    `
    )

    const {queries, dependencies} = extractQueries('/Parent.tsx', project)

    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '',
        pageInfo: {
          totalCount: true
        }
      }
    })
  })

  it('should handle passing data to a arrow function as an argument ', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      
      const useTicketInfo = (props) => { return props.pageInfo.totalCount; }

      export default function Page() {
        const data = useData();
        return <div>{useTicketInfo({ pageInfo: data.tickets().pageInfo })}</div>;
      }
    `
    )
    const {queries, dependencies} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '',
        pageInfo: {
          totalCount: true
        }
      }
    })
  })

  it('JSX .map on edges and pass to child component', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/components/ticket.tsx',
      `
      export function Ticket({ticket}) {
        const title = ticket.title;
        return <div>{title}</div>;
      }
    `
    )

    project.createSourceFile(
      '/components/index.ts',
      "export * from './ticket';"
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { Ticket } from '@/components';
      
      export default function Page() {
        const data = useData();

        const {edges} = data.tickets({})

        return <div>{edges.map(({node, cursor: edgeCursor}) => <div key={edgeCursor || node.id}>
          <Ticket ticket={node} id={node.id} />
        </div>)}</div>;
      }
    `
    )
    const {queries, dependencies} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{}',
        edges: {
          __isList: true,
          cursor: true,
          node: {
            id: true,
            title: true
          }
        }
      }
    })
  })

  it('should handle components defined as constants (arrow functions)', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/components/ticket.tsx',
      `
      export const Ticket = ({ticket}) => {
        const title = ticket.title;
        return <div>{title}</div>;
      }
    `
    )

    project.createSourceFile(
      '/components/index.ts',
      "export * from './ticket';"
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { Ticket } from '@/components';
      
      export default function Page() {
        const data = useData();
        const {edges} = data.tickets({})

        return <div>{edges.map(({node}) => <Ticket ticket={node} />)}</div>;
      }
    `
    )
    const {queries} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{}',
        edges: {
          __isList: true,
          node: {
            title: true
          }
        }
      }
    })
  })

  it('should handle components with optional chaining', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/components/ticket.tsx',
      `
      export const Ticket = ({ticket}) => {
        const name = ticket.lastMessage?.author?.name;
        return <div>{name}</div>;
      }
    `
    )

    project.createSourceFile(
      '/components/index.ts',
      "export * from './ticket';"
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { Ticket } from '@/components';
      
      export default function Page() {
        const data = useData();
        const {edges} = data.tickets({})

        return <div>{edges.map(({node}) => <Ticket ticket={node} />)}</div>;
      }
    `
    )
    const {queries} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{}',
        edges: {
          __isList: true,
          node: {
            lastMessage: {
              author: {
                name: true
              }
            }
          }
        }
      }
    })
  })

  it('should handle components using React.FC type annotation', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/components/ticket.tsx',
      `
      import React from 'react';
      interface TicketProps { ticket: any; }
      export const Ticket: React.FC<TicketProps> = ({ticket}) => {
        return <div>{ticket.title}</div>;
      }
    `
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { Ticket } from './components/ticket';
      
      export default function Page() {
        const data = useData();
        const {edges} = data.tickets({})

        return <div>{edges.map(({node}) => <Ticket ticket={node} />)}</div>;
      }
    `
    )
    const {queries} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{}',
        edges: {
          __isList: true,
          node: {
            title: true
          }
        }
      }
    })
  })

  it('should handle list status update after initial merge', () => {
    const input = `
      const tickets = data.tickets({});
      const edges = tickets.edges;
      const nodes = edges.map(e => e.node);
      console.log(nodes[0].title);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      tickets: {
        __args: '{}',
        edges: {
          __isList: true,
          node: {
            title: true
          }
        }
      }
    })
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
    const data = {
      posts: {
        latest: {
          title: "test"
        }
      },
      users: [
        {
          profile: {
            name: "test"
          }
        }
      ]
    } 
      
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
        latest: {
          title: true
        }
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

  it('should handle components wrapped in React.memo in the same file', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import React from 'react';
      
      const TicketRow = React.memo(({ node }) => {
        return (
          <div>
            <span>{node.title}</span>
          </div>
        );
      });

      export default function Page() {
        const data = useData();
        return (
          <div>
            {data.tickets.map(node => (
              <TicketRow node={node} />
            ))}
          </div>
        );
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors.tickets.title).toBe(true)
  })

  it('should handle components wrapped in React.memo', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/components/ticket-row.tsx',
      `
      import React from 'react';
      export const TicketRow = React.memo(({ node, pageIndex }) => {
        return (
          <div>
            <span>#{node.serialId} (Page: {pageIndex})</span>
            <span>{node.title || "Kein Titel"}</span>
            <span>{node.updatedAt}</span>
          </div>
        );
      });

      TicketRow.displayName = "TicketRow";
    `
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { TicketRow } from './components/ticket-row';
      
      export default function Page() {
        const data = useData();
        const {edges} = data.tickets({})

        return <div>{edges.map(({node}) => <TicketRow node={node} pageIndex={0} />)}</div>;
      }
    `
    )
    const {queries} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{}',
        edges: {
          __isList: true,
          node: {
            serialId: true,
            title: true,
            updatedAt: true
          }
        }
      }
    })
  })

  it('should handle multi-level component resolution (general fix)', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/components/ticket-row.tsx',
      `
      import React from 'react';
      const RawTicketRow = ({ node }) => {
        return <div>{node.title}</div>;
      };
      const MemoizedRow = React.memo(RawTicketRow);
      export const TicketRow = MemoizedRow;
    `
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { TicketRow } from './components/ticket-row';
      
      export default function Page() {
        const data = useData();
        return <div><TicketRow node={data.ticket} /></div>;
      }
    `
    )
    const {queries} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      ticket: {
        title: true
      }
    })
  })

  it('should handle custom HOCs (general fix)', () => {
    const project = new Project({
      compilerOptions: {
        allowJs: true,
        jsx: 4,
        baseUrl: '/',
        paths: {
          '@/*': ['./*']
        }
      },
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/components/ticket-row.tsx',
      `
      const withLogging = (Component) => (props) => {
        return <Component {...props} />;
      };
      const RawTicketRow = ({ node }) => {
        return <div>{node.id}</div>;
      };
      export const TicketRow = withLogging(RawTicketRow);
    `
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { TicketRow } from './components/ticket-row';
      
      export default function Page() {
        const data = useData();
        return <div><TicketRow node={data.ticket} /></div>;
      }
    `
    )
    const {queries} = extractQueries('/Parent.tsx', project)
    expect(queries).toHaveLength(1)
    expect(queries[0].selectors).toEqual({
      ticket: {
        id: true
      }
    })
  })

  it('should handle complex array transformations inside useMemo', () => {
    const input = `
      const messagesByDate = useMemo(() => {
        const groups = [];
        [...data.messages].reverse().forEach((msg) => {
          const lastGroup = groups[groups.length - 1];
          if (lastGroup && lastGroup.date === msg.createdAt) {
            lastGroup.messages.push(msg);
          } else {
            groups.push({ date: msg.createdAt, messages: [msg] });
          }
        });
        return groups;
      }, [data.messages]);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      messages: {
        __isList: true,
        createdAt: true
      }
    })
  })

  it('should handle selecting from a memoized array that was built via push', () => {
    const input = `
      const messagesByDate = useMemo(() => {
        const groups = [];
        [...data.messages].reverse().forEach((msg) => {
          const lastGroup = groups[groups.length - 1];
          if (lastGroup && lastGroup.date === msg.createdAt) {
            lastGroup.messages.push(msg);
          } else {
            groups.push({ date: msg.createdAt, messages: [msg] });
          }
        });
        return groups;
      }, [data.messages]);

      console.log(messagesByDate[0].messages[0].id);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      messages: {
        __isList: true,
        createdAt: true,
        id: true
      }
    })
  })

  it('should handle logical OR with empty array (Issue 1)', () => {
    const input = `
      const attachments = data.message.attachments || [];
      console.log(attachments[0].id);
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      message: {
        attachments: {
          __isList: true,
          id: true
        }
      }
    })
  })

  it('should not mark properties as lists when calling string methods like startsWith (Issue 2)', () => {
    const input = `
      const attachments = data.message.attachments || [];
      attachments.forEach(attachment => {
        if (attachment.mimeType.startsWith('image/')) {
          console.log(attachment.id);
        }
      });
    `
    const result = extractAdvancedSelectors(input, 'data')
    // mimeType should NOT be a list
    expect(result.message.attachments.mimeType).toBe(true)
    expect(result.message.attachments.id).toBe(true)
  })

  it('should handle nested function calls and closures inside .map', () => {
    const input = `
      const getFileIcon = (mimeType) => {
        if (mimeType?.startsWith('image/')) return 'image-icon';
        return 'file-icon';
      };

      const opener = (file) => () => {
        console.log(file.links.map(l => l.url));
      };

      const render = () => {
        const files = data.files || [];
        return (
          <div>
            {files.map((file) => {
              const mimeType = "mimeType" in file ? file.mimeType : undefined;
              const Icon = getFileIcon(mimeType);
              const openFilePreview = opener(file);
              
              return (
                <div onClick={openFilePreview} key={file.id}>
                  {file.name}
                </div>
              );
            })}
          </div>
        );
      };
    `
    const result = extractAdvancedSelectors(input, 'data')
    expect(result).toEqual({
      files: {
        __isList: true,
        id: true,
        name: true,
        mimeType: true,
        links: {
          __isList: true,
          url: true
        }
      }
    })
  })

  it('should handle passing a function derived from useData as a prop and calling it', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/TicketsList.tsx',
      `
      export function TicketsList({ connection }) {
        const totalCount = connection({ arg1: "foo" }).totalCount;
        return <div>{totalCount}</div>;
      }
      `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { TicketsList } from './TicketsList';
      export default function Page() {
        const data = useData();
        const connection = data.tickets;
        return <TicketsList connection={connection} />;
      }
      `
    )

    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors).toEqual({
      tickets: {
        __args: '{ arg1: "foo" }',
        totalCount: true
      }
    })
  })

  it('should correctly mark nested attachments as list even if accessed through a map', () => {
    const project = new Project({useInMemoryFileSystem: true})
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `
      import { useData } from "@getcronit/pylon-pages";
      
      export function MyComp() {
        const data = useData();
        const versions = data.ticket.versions.map(v => ({
          id: v.id,
          content: v.content,
          createdAt: v.createdAt,
          attachments: v.attachments
        }));
        
        return (
          <div>
            {versions.map(rev => (
              <div key={rev.id}>
                {rev.attachments.length > 0 && (
                   <div>
                     {rev.attachments.map(a => <span key={a.id}>{a.name}</span>)}
                   </div>
                )}
              </div>
            ))}
          </div>
        );
      }
    `
    )

    const {queries} = extractQueries('test.tsx', project, {
      pylonPackage: '@getcronit/pylon-pages',
      hookName: 'useData'
    })

    expect(queries.length).toBe(1)

    expect(queries[0].selectors).toEqual({
      ticket: {
        versions: {
          __isList: true,
          id: true,
          content: true,
          createdAt: true,
          attachments: {
            __isList: true,
            id: true,
            name: true
          }
        }
      }
    })
  })
})

describe('Query Extraction: Prop Drilling & Argument Mapping', () => {
  const compilerOptions = {allowJs: true, jsx: 4}

  // State Variable Mapping
  it('should map query arguments to local useState variables passed as props', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/Child.tsx',
      `
      export function Child({ connection, filter }) {
        const nodes = connection({ filter }).edges.map(e => e.node.id);
        return <div>{nodes.length}</div>;
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { useState } from 'react';
      import { Child } from './Child';
      
      export default function Page() {
        const [stateFilter] = useState('active');
        const data = useData();
        return <Child connection={data.notifications} filter={stateFilter} />;
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors.notifications.__args).toEqual(
      '{ filter: stateFilter }'
    )
  })

  // Static Prop Resolution
  it('should resolve static variables defined in parent and passed to child', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/Child.tsx',
      `
      export function Child({ connection, parentFilter }) {
        return <div>{connection({ filter: parentFilter }).edges.length}</div>;
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { Child } from './Child';
      
      export default function Page() {
        const parentFilter = "active";
        const data = useData();
        return <Child connection={data.notifications} parentFilter={parentFilter} />;
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors.notifications.__args).toEqual(
      '{ filter: parentFilter }'
    )
  })

  // Inline Literal Mapping
  it('should handle hardcoded string literals passed directly into props', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/Child.tsx',
      `
      export function Child({ connection, status }) {
        return <div>{connection({ status }).edges.length}</div>;
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { Child } from './Child';
      
      export default function Page() {
        const data = useData();
        return <Child connection={data.notifications} status="archived" />;
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors.notifications.__args).toEqual('{ status }')
  })

  it('should handle connection passing through customProps in a dynamic wrapper', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/ChildComponent.tsx',
      `
      export function ChildComponent({ connection, parentFilter }) {
        const nodes = connection({ filter: parentFilter }).edges.map(e => e.node.id);
        return <div>{nodes.length}</div>;
      }
    `
    )

    project.createSourceFile(
      '/MainComponent.tsx',
      `
      export function MainComponent({ chunkComponent: Chunk, chunkProps }) {
        return <Chunk {...chunkProps} />;
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { MainComponent } from './MainComponent';
      import { ChildComponent } from './ChildComponent';
      
      export default function Page() {
        const parentFilter = "active";
        const data = useData();
        return (
          <MainComponent 
            chunkComponent={ChildComponent} 
            chunkProps={{ connection: data.notifications, parentFilter }} 
          />
        );
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors.notifications).toEqual({
      __args: '{ filter: parentFilter }',
      edges: {
        __isList: true,
        node: {id: true}
      }
    })
  })

  it('should handle spread arguments and conditional logic in connection calls', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    // The Child/List component that uses complex argument construction
    project.createSourceFile(
      '/ListComponent.tsx',
      `
    export function ListComponent({ connection, args, pageSize }) {
      const before = undefined; // Mocking variable state for extraction context
      const skip = 0;
      const after = undefined;

      const { edges, pageInfo } = connection({
        ...args,
        first: before ? undefined : pageSize,
        last: before ? pageSize : undefined,
        skip,
        after,
        before,
      });

      return <div>{edges.length}</div>;
    }
  `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
    import { useData } from '@getcronit/pylon-pages';
    import { ListComponent } from './ListComponent';
    
    export default function Page() {
       const connectionArgs = { filter: "active" };
      const pageSize = 10;
      const data = useData();
   

      return (
        <ListComponent 
          connection={data.notifications} 
          args={connectionArgs} 
          pageSize={pageSize} 
        />
      );
    }
  `
    )

    const {queries} = extractQueries('/Page.tsx', project)

    // We expect the extractor to use the local variable names
    expect(queries[0].selectors.notifications.__args).toEqual(
      '{ ...connectionArgs, first: before ? undefined : pageSize, last: before ? pageSize : undefined, skip, after, before }'
    )

    // Ensure the fields accessed via destructuring are captured
    expect(queries[0].selectors.notifications.edges).toBeDefined()
    expect(queries[0].selectors.notifications.pageInfo).toBeDefined()
  })

  it('should handle nested object prop drilling and expansion', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      '/ListComponent.tsx',
      `
    export function ListComponent({ connection, listArgs, pageSize }) {
      const { args } = listArgs;
      const skip = 0;

      const { edges } = connection({
        ...args,
        first: pageSize,
        skip,
      });

      return <div>{edges.length}</div>;
    }
  `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
    import { useData } from '@getcronit/pylon-pages';
    import { ListComponent } from './ListComponent';
    
    export default function Page() {
          const connectionArgs = { filter: "active" };
      const data = useData();
      const pageSize = 10;

      return (
        <ListComponent 
          connection={data.notifications} 
          listArgs={{args: connectionArgs}} 
          pageSize={pageSize} 
        />
      );
    }
  `
    )

    const {queries} = extractQueries('/Page.tsx', project)

    console.log(queries[0].selectors.notifications.__args)

    expect(queries[0].selectors.notifications.__args).toEqual(
      '{ ...connectionArgs, first: pageSize, skip }'
    )
  })

  it('should resolve connectionArgs all the way through DataList and VirtualListBase', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/virtual-pagination.ts',
      `
      export function useChunkIntersection() { return { topSentinelRef: null, bottomSentinelRef: null }; }
    `
    )

    project.createSourceFile(
      '/virtual-list-base.tsx',
      `
      import React from 'react';
      export function VirtualListBase({ chunkComponent: Chunk, chunkProps }) {
        return <Chunk {...chunkProps} pageIndex={0} skip={0} isTopChunk={true} isBottomChunk={true} />;
      }
    `
    )

    project.createSourceFile(
      '/data-list.tsx',
      `
      import React from 'react';
      import { VirtualListBase } from './virtual-list-base';
      
      function DataListChunk({ connection, args, pageSize, skip, before }) {
        const { edges } = connection({
          ...args,
          first: before ? undefined : pageSize,
          skip,
        });
        return <div>{edges.length}</div>;
      }

      export function DataList({ connection, connectionArgs, pageSize }) {
        return (
          <VirtualListBase 
            chunkComponent={DataListChunk} 
            chunkProps={{ connection, args: connectionArgs, pageSize }} 
          />
        );
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import React, { useMemo } from 'react';
      import { DataList } from './data-list';
      
      export default function Page() {
       const filters = { status: 'ALL' };
        const connectionArgs = useMemo(() => ({
          filters: { isArchived: filters.status === 'ARCHIVED' }
        }), [filters.status]);
        const data = useData();
        
        return (
          <DataList 
            connection={data.notifications} 
            connectionArgs={connectionArgs} 
            pageSize={10} 
          />
        );
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)

    // Check if the first query found (which should be from DataListChunk)
    // has correctly resolved arguments.
    // The expected output should contain 'connectionArgs'.
    const notificationQuery = queries.find(q => q.selectors.notifications)
    expect(notificationQuery).toBeDefined()

    const notifications = notificationQuery.selectors.notifications
    const targetBranch = Array.isArray(notifications)
      ? notifications.find(b => b.__args?.includes('...connectionArgs'))
      : notifications

    expect(targetBranch).toBeDefined()
    expect(targetBranch.__args).toContain('...connectionArgs')
  })

  it('should resolve connectionArgs in child component using useData directly (InboxChunk pattern)', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/VirtualListBase.tsx',
      `
      import React from 'react';
      export function VirtualListBase({ children }) {
        const chunk = { pageIndex: 0, skip: 0, after: 'cursor1' };
        return <div>{children(chunk)}</div>;
      }
    `
    )

    project.createSourceFile(
      '/InboxChunk.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import React from 'react';
      
      export function InboxChunk(props) {
        const data = useData({ operationName: "InboxSidebar" });
        const PAGE_SIZE = 48;
        const connection = data.me.session.user.notifications({
          ...props.connectionArgs,
          first: props.before ? undefined : PAGE_SIZE,
          last: props.before ? PAGE_SIZE : undefined,
          skip: props.skip,
          after: props.after,
          before: props.before,
        });
        return <div>{connection.totalCount}</div>;
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import React, { useMemo } from 'react';
      import { VirtualListBase } from './VirtualListBase';
      import { InboxChunk } from './InboxChunk';

      export default function Page() {
      const connectionArgs = useMemo(() => ({ filters: { isRead: false } }), []);
        const data = useData();
        
        const totalCount = data.me.session.user.notifications({connectionArgs}).totalCount;
        
        return (
          <VirtualListBase>
            {(chunk) => (
              <InboxChunk {...chunk} connectionArgs={connectionArgs} />
            )}
          </VirtualListBase>
        );
      }
    `
    )

    const {queries: pageQueries} = extractQueries('/Page.tsx', project)

    expect(pageQueries[0].selectors).toEqual({
      me: {
        session: {
          user: {
            notifications: {
              __args: '{ connectionArgs }',
              totalCount: true
            }
          }
        }
      }
    })

    const {queries: inboxQueries} = extractQueries('/InboxChunk.tsx', project)

    expect(inboxQueries[0].selectors).toEqual({
      me: {
        session: {
          user: {
            notifications: {
              __args:
                '{ ...props.connectionArgs, first: props.before ? undefined : PAGE_SIZE, last: props.before ? PAGE_SIZE : undefined, skip: props.skip, after: props.after, before: props.before }',
              totalCount: true
            }
          }
        }
      }
    })
  })

  it('should resolve fields accessed inside a renderItem function', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/ListView.tsx',
      `
      import React from 'react';
      export function ListView({ items, renderItem }) {
        return <div>{items.map(item => renderItem(item))}</div>;
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import React from 'react';
      import { ListView } from './ListView';

      export default function Page() {
        const data = useData();
        return (
          <ListView 
            items={data.notifications.edges} 
            renderItem={(edge) => (
              <div>
                <span>{edge.node.title}</span>
                <span>{edge.node.message}</span>
              </div>
            )} 
          />
        );
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)

    expect(queries[0].selectors).toEqual({
      notifications: {
        edges: {
          __isList: true,
          node: {
            title: true,
            message: true
          }
        }
      }
    })
  })

  it('should handle passing connection in customProps and dynamic ChildComponent', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/ChildComponent.tsx',
      `
      export function ChildComponent({ customProps }) {
        const { connection } = customProps;
        const totalCount = connection({ arg1: "foo" }).totalCount;
        return <div>{totalCount}</div>;
      }
    `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import React from 'react';
      import { ChildComponent } from './ChildComponent';

      export default function Page() {
        const data = useData();
        const connection = data.tickets;
        
        const DynamicComp = ChildComponent;

        return (
          <DynamicComp 
            customProps={{ connection }}
          />
        );
      }
    `
    )

    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries.length).toBe(1)
    expect(queries[0].selectors.tickets).toBeDefined()
    expect(queries[0].selectors.tickets.__args).toContain('arg1: "foo"')
    expect(queries[0].selectors.tickets.totalCount).toBe(true)
  })

  it('should not resolve iterator parameters back to the source array in stringified arguments', () => {
    const project = new Project({compilerOptions, useInMemoryFileSystem: true})

    project.createSourceFile(
      '/TicketChunk.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      export function TicketChunk({ before, skip }) {
        const data = useData();
        const { edges } = data.tickets({
          before: before,
          skip: skip
        });
        return <div>{edges.length}</div>;
      }
      `
    )

    project.createSourceFile(
      '/Page.tsx',
      `
      import { useState } from 'react';
      import { TicketChunk } from './TicketChunk';

      export default function Page() {
        const [listState, setListState] = useState({
          anchorPage: 0,
          backwardCursors: ['a', 'b']
        });

        const chunks = [
          ...listState.backwardCursors.map(cursor => ({
            key: cursor,
            before: cursor
          })),
          {
            key: 'anchor',
            skip: listState.anchorPage * 10
          }
        ];

        return (
          <div>
            {chunks.map(chunk => (
              <TicketChunk key={chunk.key} {...chunk} />
            ))}
          </div>
        );
      }
      `
    )

    const {queries} = extractQueries('/TicketChunk.tsx', project)
    expect(queries).toHaveLength(1)

    const {tickets} = queries[0].selectors as any
    expect(tickets).toBeDefined()

    // Check that it correctly uses the identifier name 'before' and 'skip' instead of 'listState.backwardCursors'
    // This ensures that the generated prepareFn uses the closure variables.
    expect(tickets.__args).toContain('before: before')
    expect(tickets.__args).toContain('skip: skip')
    expect(tickets.__args).not.toContain('listState.backwardCursors')
  })

  it('should handle components with a single props parameter without merging paths improperly', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Component.tsx',
      `
      export function MyComponent(props) {
        return <div>{props.user.name} {props.admin.role}</div>;
      }
      `
    )
    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { MyComponent } from './Component';
      export default function Page() {
        const data = useData();
        return <MyComponent user={data.user} admin={data.admin} />;
      }
      `
    )
    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors).toEqual({
      user: {
        name: true
      },
      admin: {
        role: true
      }
    })
  })

  it('should handle components with a single props parameter and key prop properly', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Component.tsx',
      `
      export function MyComponent(props) {
        return <div>{props.title}</div>;
      }
      `
    )
    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { MyComponent } from './Component';
      export default function Page() {
        const data = useData();
        const ticket = data.ticket({ id: '1' });
        return <MyComponent key={ticket.id} title={ticket.title} />;
      }
      `
    )
    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors).toEqual({
      ticket: {
        __args: "{ id: '1' }",
        id: true,
        title: true
      }
    })
  })

  it('should isolate component scopes to prevent variable bleeding from parent to child', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Component.tsx',
      `
      export function SubComponent() {
        // 'd' is not defined in this file/scope, 
        // but it exists in Page.tsx. It should not bleed here.
        return <div>{d.hiddenField}</div>;
      }
      `
    )
    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { SubComponent } from './Component';
      export default function Page() {
        const d = useData();
        return (
          <div>
            {d.visibleField}
            <SubComponent />
          </div>
        );
      }
      `
    )
    const {queries} = extractQueries('/Page.tsx', project)
    expect(queries[0].selectors).toEqual({
      visibleField: true
    })
    // hiddenField should NOT be in selectors
    expect((queries[0].selectors as any).hiddenField).toBeUndefined()
  })

  it('should still allow access to file-level globals in subcomponents', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      '/Component.tsx',
      `
      export const globalData = { field: 'value' };
      export function SubComponent() {
        // globalData is defined at the file level, so it should be visible
        // even if the scope is isolated from the caller.
        return <div>{globalData.field}</div>;
      }
      `
    )
    project.createSourceFile(
      '/Page.tsx',
      `
      import { useData } from '@getcronit/pylon-pages';
      import { SubComponent } from './Component';
      export default function Page() {
        const d = useData();
        return <SubComponent />;
      }
      `
    )
    const {queries} = extractQueries('/Page.tsx', project)
    // This just verifies that it doesn't crash and correctly handles globals
    expect(queries[0].selectors).toEqual({})
  })
})
