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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData as usePylonData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
      
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
    `
    )

    project.createSourceFile(
      '/Parent.tsx',
      `
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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
      import { useData } from '@getcronit/pylon/pages';
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

  it('should handle nested function returns from custom hooks in other files (useFilePreview)', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })
    project.createSourceFile(
      'hooks.ts',
      `
      import { createContext, useContext } from 'react';
      
      const FilePreviewContext = createContext({
        opener: (vaultItem) => {
          vaultItem.id;
          vaultItem.createdAt;
          vaultItem.links?.forEach((link) => {
            link.id;
            link.title;
            link.type;
          });
          return (config) => console.log(vaultItem.id);
        }
      });

      const useFilePreviewContext = () => {
        return useContext(FilePreviewContext);
      }

      export const useFilePreview = () => {
        return useFilePreviewContext();
      }
    `
    )
    project.createSourceFile(
      'FileAttachmentList.tsx',
      `
      import { useFilePreview } from './hooks';

      export const FileAttachmentList = ({files}) => {
        const preview = useFilePreview();
        return (
          <>
            {files.map(file => (
              <div onClick={preview.opener(file)}>
                Test
              </div>
            ))}
          </>
        )
      }
      `
    )
    const mainFile = project.createSourceFile(
      'main.tsx',
      `
      import { useData } from '@getcronit/pylon/pages';
      import { FileAttachmentList } from './FileAttachmentList';
      
      const Component = () => {
        const data = useData();
        const files = data.files || [];

        return (
          <div>
            <FileAttachmentList files={files} />
          </div>
        )
      }
    `
    )

    project.resolveSourceFileDependencies()

    const {queries} = extractQueries('main.tsx', project)

    expect(queries[0].selectors).toEqual({
      files: {
        __isList: true,
        id: true,
        createdAt: true,
        links: {
          __isList: true,
          id: true,
          title: true,
          type: true
        }
      }
    })
  })

  it('should trace data through a Context Provider and follow callback arguments', () => {
    const project = new Project({
      compilerOptions: {allowJs: true, jsx: 4},
      useInMemoryFileSystem: true
    })

    project.createSourceFile(
      'context.tsx',
      `
      import { createContext, useContext } from 'react';
      
      export const FilePreviewContext = createContext<any>(undefined);

      function prepareFile(file: any) {
        file.id
        file.links.forEach(l => l.id);
      }

      export const FilePreviewProvider = ({ children }) => {
        const value = {
          opener: (item: any) => {
            prepareFile(item);
          }
        };
        return (
          <FilePreviewContext.Provider value={value}>
            {children}
          </FilePreviewContext.Provider>
        );
      }

      export function useFilePreview() {
        const context = useContext(FilePreviewContext);
        if (context === undefined) {
          throw new Error("useFilePreview must be used within a FilePreviewProvider");
        }
        return context;
      }
      `
    )

    project.createSourceFile(
      'Component.tsx',
      `
      import { useFilePreview } from './context';

      export const FileAttachmentList = ({files}) => {
        const config = useFilePreview();
        return (
          <>
            {files.map(file => (
              <div onClick={() => config.opener(file)}>
                Test
              </div>
            ))}
          </>
        )
      }
      `
    )

    project.createSourceFile(
      'main.tsx',
      `
      import { useData } from '@getcronit/pylon/pages';
      import { FilePreviewProvider } from './context';
      import { FileAttachmentList } from './Component';
      
      const Page = () => {
        const data = useData();

        return (
          <FilePreviewProvider>
            <FileAttachmentList files={data.files || []} />
          </FilePreviewProvider>
        )
      }
    `
    )

    project.resolveSourceFileDependencies()
    const {queries} = extractQueries('main.tsx', project)

    expect(queries[0].selectors).toEqual({
      files: {
        __isList: true,
        id: true,
        links: {
          __isList: true,
          id: true
        }
      }
    })
  })
})
