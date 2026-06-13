import {Project} from 'ts-morph'
import {bench, describe} from 'vitest'
import {extractAdvancedSelectors, extractQueries} from './analyze'

// ---------------------------------------------------------------------------
// extractAdvancedSelectors benchmarks (includes Project creation overhead)
// These measure the full end-to-end cost including Project setup.
// ---------------------------------------------------------------------------

const SIMPLE_INPUT = `
  const u = data.user({ id: "123" });
  const email = u.email;
  const { profile: { name, address: { city } } } = data.user;
  console.log(name, city, email);
`

const COMPLEX_INPUT = `
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

  let x;
  if (condition) {
    x = data.user;
  } else {
    x = data.admin;
  }
  console.log(x.permissions);

  const total = data.items.reduce((acc, item) => acc + item.price, 0);

  for (const { id, name } of data.users) {
    console.log(id, name);
  }
`

const MEGA_INPUT = `
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

  const name = data?.user?.profile?.name ?? "Anonymous";
  const city = data.user.address?.city;

  function walk(node) {
    console.log(node.name);
    if (node.children) {
      node.children.forEach(walk);
    }
  }
  walk(data.root);

  const total = data.items.reduce((acc, item) => acc + item.price, 0);

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

  const detail = data?.organization?.departments?.[0]?.teams?.find(t => t.active)?.leader?.name ?? "Unknown";

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

describe('extractAdvancedSelectors', () => {
  bench('simple input', () => {
    extractAdvancedSelectors(SIMPLE_INPUT, 'data')
  })

  bench('complex input', () => {
    extractAdvancedSelectors(COMPLEX_INPUT, 'data')
  })

  bench('mega input', () => {
    extractAdvancedSelectors(MEGA_INPUT, 'data')
  })
})

// ---------------------------------------------------------------------------
// extractQueries benchmarks (multi-file, in-memory project)
// Project is pre-created outside the bench loop to isolate analysis time.
// ---------------------------------------------------------------------------

describe('extractQueries', () => {
  // -- Cross-file resolution project --
  const crossFileProject = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      baseUrl: '/',
      paths: {'@/*': ['./*']}
    },
    useInMemoryFileSystem: true
  })

  crossFileProject.createSourceFile(
    '/hook.ts',
    'export function useTicketInfo({pageInfo}) { return pageInfo.totalCount; }'
  )
  crossFileProject.createSourceFile(
    '/hooks/index.ts',
    'export * from "../hook";'
  )
  crossFileProject.createSourceFile(
    '/components/ticket.tsx',
    `export function Ticket({ticket}) {
      const title = ticket.title;
      return <div>{title}</div>;
    }`
  )
  crossFileProject.createSourceFile(
    '/components/index.ts',
    "export * from './ticket';"
  )
  crossFileProject.createSourceFile(
    '/Parent.tsx',
    `
    import { useData } from '@getcronit/pylon-pages/pages';
    import { Ticket } from '@/components';
    import { useTicketInfo } from './hooks';

    export default function Page() {
      const data = useData();
      const {edges} = data.tickets({})
      const total = useTicketInfo({ pageInfo: data.tickets({}).pageInfo });

      return <div>{edges.map(({node, cursor: edgeCursor}) => <div key={edgeCursor || node.id}>
        <Ticket ticket={node} id={node.id} />
      </div>)}</div>;
    }
    `
  )
  crossFileProject.resolveSourceFileDependencies()

  bench('cross-file resolution', () => {
    extractQueries('/Parent.tsx', crossFileProject, {
      skipDependencyResolution: true
    })
  })

  // -- Deep component tree project --
  const deepProject = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      baseUrl: '/',
      paths: {'@/*': ['./*']}
    },
    useInMemoryFileSystem: true
  })

  deepProject.createSourceFile(
    '/components/Avatar.tsx',
    `export function Avatar({ user }) {
      return <img src={user.avatarUrl} alt={user.displayName} />;
    }`
  )
  deepProject.createSourceFile(
    '/components/Badge.tsx',
    `export function Badge({ label, color }) {
      return <span style={{ background: color }}>{label}</span>;
    }`
  )
  deepProject.createSourceFile(
    '/components/PostCard.tsx',
    `import { Badge } from "./Badge";
    export function PostCard({ post }) {
      return (
        <article>
          <h3>{post.title}</h3>
          <p>{post.excerpt}</p>
          <span>{post.author.name}</span>
          {post.tags.map(tag => <Badge label={tag.name} color={tag.color} />)}
        </article>
      );
    }`
  )
  deepProject.createSourceFile(
    '/components/CommentThread.tsx',
    `export function CommentThread({ comment }) {
      return (
        <div>
          <p>{comment.body}</p>
          <span>{comment.author.username}</span>
          <small>{comment.createdAt}</small>
        </div>
      );
    }`
  )
  deepProject.createSourceFile(
    '/components/ProfileHeader.tsx',
    `import { Avatar } from "./Avatar";
    export function ProfileHeader({ user }) {
      return (
        <header>
          <Avatar user={user} />
          <h1>{user.displayName}</h1>
          <p>{user.bio}</p>
          <span>{user.location.city}</span>
          <span>{user.location.country}</span>
        </header>
      );
    }`
  )
  deepProject.createSourceFile(
    '/components/Sidebar.tsx',
    `export function Sidebar({ config }) {
      return (
        <nav>
          <h1>{config.siteName}</h1>
          <img src={config.logo.url} alt={config.logo.alt} />
        </nav>
      );
    }`
  )
  deepProject.createSourceFile(
    '/components/Layout.tsx',
    `import { Sidebar } from "./Sidebar";
    export function Layout({ siteConfig, children }) {
      return (
        <div>
          <Sidebar config={siteConfig} />
          <main>{children}</main>
          <footer>{siteConfig.footerText}</footer>
        </div>
      );
    }`
  )
  deepProject.createSourceFile(
    '/ProfilePage.tsx',
    `
    import { useData } from '@getcronit/pylon-pages/pages';
    import { ProfileHeader } from './components/ProfileHeader';
    import { PostCard } from './components/PostCard';
    import { CommentThread } from './components/CommentThread';
    import { Layout } from './components/Layout';

    export default function ProfilePage() {
      const data = useData();
      return (
        <Layout siteConfig={data.siteConfig}>
          <ProfileHeader user={data.profile} />
          {data.profile.posts({ sort: "newest" }).map(post => (
            <div>
              <PostCard post={post} />
              {post.comments({ limit: 5 }).map(comment => (
                <CommentThread comment={comment} />
              ))}
            </div>
          ))}
        </Layout>
      );
    }
    `
  )
  deepProject.resolveSourceFileDependencies()

  bench('deep component tree', () => {
    extractQueries('/ProfilePage.tsx', deepProject, {
      skipDependencyResolution: true
    })
  })

  // -- Large Project Scalability (50+ files) --
  const largeProject = new Project({
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      baseUrl: '/',
      paths: {'@/*': ['./*']}
    },
    useInMemoryFileSystem: true
  })

  // 1. Create a chain of utilities across 5 files
  const noiseText = "/* " + "noise ".repeat(2000) + " */\n";
  largeProject.createSourceFile('/utils/level5.ts', `${noiseText}export function getData(d: any) { return d.final; }`)
  largeProject.createSourceFile('/utils/level4.ts', `${noiseText}import { getData } from "./level5"; export function wrap4(d: any) { return getData(d); }`)
  largeProject.createSourceFile('/utils/level3.ts', `${noiseText}import { wrap4 } from "./level4"; export function wrap3(d: any) { return wrap4(d); }`)
  largeProject.createSourceFile('/utils/level2.ts', `${noiseText}import { wrap3 } from "./level3"; export function wrap2(d: any) { return wrap3(d); }`)
  largeProject.createSourceFile('/utils/level1.ts', `${noiseText}import { wrap2 } from "./level2"; export function wrap1(d: any) { return wrap2(d); }`)

  // 2. Create 45 "noise" files that don't import our utilities
  // Each file is filled with a large amount of noise text to make project-wide scans expensive.
  for (let i = 0; i < 45; i++) {
    largeProject.createSourceFile(`/noise/file_${i}.tsx`, `
      import React from 'react';
      ${noiseText}
      export function NoiseComponent${i}() {
        return <div>Noise ${i}</div>;
      }
      export const noiseValue${i} = ${i} * 100;
    `)
  }

  // 3. Create 10 different entry points that use the utility
  const appFiles: string[] = []
  for (let i = 0; i < 10; i++) {
    const path = `/App_${i}.tsx`
    appFiles.push(path)
    largeProject.createSourceFile(
      path,
      `
      import { useData } from '@getcronit/pylon-pages/pages';
      import { wrap1 } from './utils/level1';

      export default function App${i}() {
        const data = useData();
        const value = wrap1(data.deep.nested.field_${i});
        return <div>{value}</div>;
      }
      `
    )
  }
  largeProject.resolveSourceFileDependencies()

  bench('large project scalability (50 files, 10 calls)', () => {
    for (const path of appFiles) {
      extractQueries(path, largeProject, {
        skipDependencyResolution: true
      })
    }
  })
})
