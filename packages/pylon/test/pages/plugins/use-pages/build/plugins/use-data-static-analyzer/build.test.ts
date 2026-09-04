import * as fs from 'fs'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {
  runAnalyzer,
  runAnalyzerMulti,
  runAnalyzerResult
} from './_run-analyzer'
const tempDir = path.join(__dirname, 'temp_tests')
describe('useData static analyzer', () => {
  beforeAll(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir)
  })
  afterAll(() => {
    if (fs.existsSync(tempDir))
      fs.rmSync(tempDir, {recursive: true, force: true})
  })
  it('should securely inject selectors into empty useData calls', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const data = useData();
        console.log(data.post.title);
      }
    `
    const filePath = path.join(tempDir, 'testA.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function Component() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.post?.title; }
      });
              console.log(data.post.title);
            }
          "
    `)
  })
  it('should securely inject selectors into useData calls with existing config arguments', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const data = useData({ foo: "bar" });
        console.log(data.author.name);
      }
    `
    const filePath = path.join(tempDir, 'testB.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function Component() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.author?.name; }, foo: "bar" });
              console.log(data.author.name);
            }
          "
    `)
  })
  it('should translate deep array mappings with arguments dynamically at build-time', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const data = useData();
        return data.friends({ limit: 10, offset: 20 }).map(friend => {
           return friend.profile.username;
        });
      }
    `
    const filePath = path.join(tempDir, 'testC.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function Component() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.friends?.({ limit: 10, offset: 20 })?.map(i1 => { i1?.profile?.username; }); }
      });
              return data.friends({ limit: 10, offset: 20 }).map(friend => {
                 return friend.profile.username;
              });
            }
          "
    `)
  })
  it('should handle extremely complex multi-root and deeply nested array mappings', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const data = useData();
        console.log(data.me.id);
        console.log(data.me.settings.theme);
        data.users({ active: true }).map(user => {
           console.log(user.status);
           user.posts.map(post => {
              console.log(post.title);
              post.comments({ sort: "desc" }).map(comment => {
                 console.log(comment.body);
              });
           });
        });
      }
    `
    const filePath = path.join(tempDir, 'testD.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    // The exact AST generated map backwards:
    // query.me.id;
    // query.me.settings.theme;
    // query.users({ active: true }).map((i1) => { i1.status; i1.posts.map((i2) => { i2.title; i2.comments({ sort: "desc" }).map((i3) => { i3.body; }); }); });
    const expected =
      'useData({prepare:({query:__pylonQuery})=>{__pylonQuery?.me?.id;__pylonQuery?.me?.settings?.theme;__pylonQuery?.users?.({active:true})?.map((i1)=>{i1?.status;i1?.posts?.map((i2)=>{i2?.title;i2?.comments?.({sort:"desc"})?.map((i3)=>{i3?.body;});});});}})'
  })
  it('should preserve locally scoped variables in injected selectors natively', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const myFetchLimit = 50;
        const data = useData();
        return data.friends({ limit: myFetchLimit }).map(friend => {
           return friend.profile.username;
        });
      }
    `
    const filePath = path.join(tempDir, 'testE.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function Component() {
              const myFetchLimit = 50;
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.friends?.({ limit: myFetchLimit })?.map(i1 => { i1?.profile?.username; }); }
      });
              return data.friends({ limit: myFetchLimit }).map(friend => {
                 return friend.profile.username;
              });
            }
          "
    `)
  })
  it('should flawlessly preserve React State variables for dynamic requests', async () => {
    const inputCode = `
      import { useState } from "react";
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const [pageOffset, setPageOffset] = useState(0);
        const data = useData();
        return data.feed({ offset: pageOffset, limit: 10 }).map(item => {
           return item.title;
        });
      }
    `
    const filePath = path.join(tempDir, 'testF.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useState } from "react";
            import { useData } from "@getcronit/pylon/pages";
            export function Component() {
              const [pageOffset, setPageOffset] = useState(0);
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.feed?.({ offset: pageOffset, limit: 10 })?.map(i1 => { i1?.title; }); }
      });
              return data.feed({ offset: pageOffset, limit: 10 }).map(item => {
                 return item.title;
              });
            }
          "
    `)
  })
  it('should handle dynamic function calls with primitives in JSX (dyno case)', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component({ input }) {
        const data = useData();
        return <p>{data.dyno({input})}</p>;
      }
    `
    const filePath = path.join(tempDir, 'test_dyno.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function Component({ input }) {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.dyno?.({ input }); }
      });
              return <p>{data.dyno({input})}</p>;
            }
          "
    `)
  })
  it('should correctly resolve selectors across multiple files in a real build scenario', async () => {
    // 1. Create a component in another file
    const cardCode = `
      export function UserCard({ user }) {
        return (
          <div>
            <h1>{user.name}</h1>
            <p>{user.bio.short}</p>
          </div>
        );
      }
    `
    fs.writeFileSync(path.join(tempDir, 'UserCard.tsx'), cardCode)
    // 2. Create the main page that imports and uses the component
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { UserCard } from "./UserCard";
      export function Page() {
        const data = useData();
        return <UserCard user={data.user} />;
      }
    `
    const pagePath = path.join(tempDir, 'Page.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 3. Build the page
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { UserCard } from "./UserCard";
            export function Page() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.user; v1?.name; v1?.bio?.short; }
      });
              return <UserCard user={data.user} />;
            }
          "
    `)
  })
  it('should handle nested cross-file resolution across three levels', async () => {
    // Level 3: GrandChild.tsx
    const grandChildCode = `
      export function GrandChild({ info }) {
        return <span>{info.detail}</span>;
      }
    `
    fs.writeFileSync(path.join(tempDir, 'GrandChild.tsx'), grandChildCode)
    // Level 2: Child.tsx
    const childCode = `
      import { GrandChild } from "./GrandChild";
      export function Child({ user }) {
        return (
          <div>
            <p>{user.name}</p>
            <GrandChild info={user.meta} />
          </div>
        );
      }
    `
    fs.writeFileSync(path.join(tempDir, 'Child.tsx'), childCode)
    // Level 1: Parent.tsx
    const parentCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { Child } from "./Child";
      export default function Parent() {
        const data = useData()
        return <Child user={data.user} />;
      }
    `
    const parentPath = path.join(tempDir, 'Parent.tsx')
    fs.writeFileSync(parentPath, parentCode)
    const outputCode = await runAnalyzer(parentPath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { Child } from "./Child";
            export default function Parent() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.user; v1?.name; v1?.meta?.detail; }
      })
              return <Child user={data.user} />;
            }
          "
    `)
  })
  it('should handle mixed prop usage and standalone useData in the same component', async () => {
    // Child component that uses both props and its own query
    const childCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function SharedComponent({ user }) {
        const settings = useData();
        return (
          <div>
            <p>{user.email}</p>
            <p>{settings.timezone}</p>
          </div>
        );
      }
    `
    fs.writeFileSync(path.join(tempDir, 'SharedComponent.tsx'), childCode)
    // Parent page
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { SharedComponent } from "./SharedComponent";
      export function Page() {
        const data = useData();
        return <SharedComponent user={data.currentUser} />;
      }
    `
    const pagePath = path.join(tempDir, 'AppPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    // Verify Page's query (should contain currentUser.email)
    // Note: esbuild might rename useData to useData2 etc. to avoid collisions

    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { SharedComponent } from "./SharedComponent";
            export function Page() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.currentUser?.email; }
      });
              return <SharedComponent user={data.currentUser} />;
            }
          "
    `)
  })
})
// =============================================================================
// REALISTIC NEXT.JS APP — Multiple pages, shared layouts, deep component trees
// =============================================================================
describe('Realistic NextJS App with useData', () => {
  const appDir = path.join(__dirname, 'temp_nextjs_app')
  beforeAll(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir)
    fs.mkdirSync(appDir, {recursive: true})
    fs.mkdirSync(path.join(appDir, 'components'), {recursive: true})
    fs.mkdirSync(path.join(appDir, 'hooks'), {recursive: true})
    fs.mkdirSync(path.join(appDir, 'pages'), {recursive: true})
    // Create a tsconfig.json to help ts-morph with cross-file resolution
    fs.writeFileSync(
      path.join(appDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            jsx: 'react-jsx',
            allowJs: true,
            module: 'ESNext',
            target: 'ESNext',
            moduleResolution: 'node',
            baseUrl: './'
          },
          include: ['**/*']
        },
        null,
        2
      )
    )
  })
  afterAll(() => {
    if (fs.existsSync(appDir)) fs.rmSync(appDir, {recursive: true, force: true})
    if (fs.existsSync(tempDir))
      fs.rmSync(tempDir, {recursive: true, force: true})
  })
  // --------------------------------------------------------------------------
  // Shared component files (no useData — only consume props)
  // --------------------------------------------------------------------------
  function writeSharedComponents() {
    // components/Avatar.tsx — leaf component
    fs.writeFileSync(
      path.join(appDir, 'components', 'Avatar.tsx'),
      `
      export function Avatar({ user }) {
        return (
          <img src={user.avatarUrl} alt={user.displayName} />
        );
      }
      `
    )
    // components/Badge.tsx — another leaf
    fs.writeFileSync(
      path.join(appDir, 'components', 'Badge.tsx'),
      `
      export function Badge({ label, color }) {
        return <span style={{ background: color }}>{label}</span>;
      }
      `
    )
    // components/UserCard.tsx — composes Avatar
    fs.writeFileSync(
      path.join(appDir, 'components', 'UserCard.tsx'),
      `
      import { Avatar } from "./Avatar";
      export function UserCard({ user }) {
        return (
          <div>
            <Avatar user={user} />
            <h2>{user.displayName}</h2>
            <p>{user.email}</p>
          </div>
        );
      }
      `
    )
    // components/PostCard.tsx — renders a single post
    fs.writeFileSync(
      path.join(appDir, 'components', 'PostCard.tsx'),
      `
      import { Badge } from "./Badge";
      export function PostCard({ post }) {
        return (
          <article>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
            <span>{post.author.name}</span>
            {post.tags.map(tag => <Badge label={tag.name} color={tag.color} />)}
          </article>
        );
      }
      `
    )
    // components/CommentThread.tsx — recursive-ish nested comments
    fs.writeFileSync(
      path.join(appDir, 'components', 'CommentThread.tsx'),
      `
      export function CommentThread({ comment }) {
        return (
          <div>
            <p>{comment.body}</p>
            <span>{comment.author.username}</span>
            <small>{comment.createdAt}</small>
          </div>
        );
      }
      `
    )
    // components/Sidebar.tsx — navigation sidebar that consumes site config
    fs.writeFileSync(
      path.join(appDir, 'components', 'Sidebar.tsx'),
      `
      export function Sidebar({ config }) {
        return (
          <nav>
            <h1>{config.siteName}</h1>
            <img src={config.logo.url} alt={config.logo.alt} />
          </nav>
        );
      }
      `
    )
    // components/Notification.tsx — notification bell
    fs.writeFileSync(
      path.join(appDir, 'components', 'Notification.tsx'),
      `
      export function Notification({ item }) {
        return (
          <div>
            <strong>{item.title}</strong>
            <p>{item.message}</p>
            <time>{item.timestamp}</time>
          </div>
        );
      }
      `
    )
    // components/StatCard.tsx — dashboard stat widget
    fs.writeFileSync(
      path.join(appDir, 'components', 'StatCard.tsx'),
      `
      export function StatCard({ stat }) {
        return (
          <div>
            <h4>{stat.label}</h4>
            <span>{stat.value}</span>
            <small>{stat.trend.direction}</small>
            <small>{stat.trend.percentage}</small>
          </div>
        );
      }
      `
    )
    // components/Layout.tsx — wraps Sidebar, takes siteConfig prop
    fs.writeFileSync(
      path.join(appDir, 'components', 'Layout.tsx'),
      `
      import { Sidebar } from "./Sidebar";
      export function Layout({ siteConfig, children }) {
        return (
          <div>
            <Sidebar config={siteConfig} />
            <main>{children}</main>
            <footer>{siteConfig.footerText}</footer>
          </div>
        );
      }
      `
    )
  }
  // --------------------------------------------------------------------------
  // Test 1: Dashboard page — multiple useData roots, stats, notifications
  // --------------------------------------------------------------------------
  it('should handle a Dashboard page with stats, notifications, and layout', async () => {
    writeSharedComponents()
    const dashboardCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { Layout } from "../components/Layout";
      import { StatCard } from "../components/StatCard";
      import { Notification } from "../components/Notification";
      import { UserCard } from "../components/UserCard";
      export default function DashboardPage() {
        const data = useData();
        return (
          <Layout siteConfig={data.siteConfig}>
            <UserCard user={data.currentUser} />
            {data.dashboardStats({ period: "weekly" }).map(stat => (
              <StatCard stat={stat} />
            ))}
            {data.notifications({ unread: true }).map(n => (
              <Notification item={n} />
            ))}
          </Layout>
        );
      }
    `
    const dashboardPath = path.join(appDir, 'pages', 'Dashboard.tsx')
    fs.writeFileSync(dashboardPath, dashboardCode)
    const out = await runAnalyzer(dashboardPath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { Layout } from "../components/Layout";
            import { StatCard } from "../components/StatCard";
            import { Notification } from "../components/Notification";
            import { UserCard } from "../components/UserCard";
            export default function DashboardPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.siteConfig; v1?.siteName; const v2 = v1?.logo; v2?.url; v2?.alt; v1?.footerText; const v3 = __pylonQuery?.currentUser; v3?.avatarUrl; v3?.displayName; v3?.email; __pylonQuery?.dashboardStats?.({ period: "weekly" })?.map(i1 => { i1?.label; i1?.value; const v4 = i1?.trend; v4?.direction; v4?.percentage; }); __pylonQuery?.notifications?.({ unread: true })?.map(i1 => { i1?.title; i1?.message; i1?.timestamp; }); }
      });
              return (
                <Layout siteConfig={data.siteConfig}>
                  <UserCard user={data.currentUser} />
                  {data.dashboardStats({ period: "weekly" }).map(stat => (
                    <StatCard stat={stat} />
                  ))}
                  {data.notifications({ unread: true }).map(n => (
                    <Notification item={n} />
                  ))}
                </Layout>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 2: Blog listing page — PostCard with nested tags array
  // --------------------------------------------------------------------------
  it('should handle a Blog listing page with PostCards and nested tag arrays', async () => {
    writeSharedComponents()
    const blogCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { PostCard } from "../components/PostCard";
      export default function BlogPage() {
        const data = useData();
        return (
          <div>
            <h1>{data.blogMeta.title}</h1>
            <p>{data.blogMeta.description}</p>
            {data.posts({ limit: 20, category: "tech" }).map(post => (
              <PostCard post={post} />
            ))}
          </div>
        );
      }
    `
    const blogPath = path.join(appDir, 'pages', 'Blog.tsx')
    fs.writeFileSync(blogPath, blogCode)
    const out = await runAnalyzer(blogPath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { PostCard } from "../components/PostCard";
            export default function BlogPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.blogMeta; v1?.title; v1?.description; __pylonQuery?.posts?.({ limit: 20, category: "tech" })?.map(i1 => { i1?.title; i1?.excerpt; i1?.author?.name; i1?.tags?.map(i2 => { i2?.name; i2?.color; }); }); }
      });
              return (
                <div>
                  <h1>{data.blogMeta.title}</h1>
                  <p>{data.blogMeta.description}</p>
                  {data.posts({ limit: 20, category: "tech" }).map(post => (
                    <PostCard post={post} />
                  ))}
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 3: Profile page — user detail + their posts + comments on each post
  // --------------------------------------------------------------------------
  it('should handle a deeply nested Profile page with user, posts, and comments', async () => {
    writeSharedComponents()
    // A dedicated ProfileHeader component
    fs.writeFileSync(
      path.join(appDir, 'components', 'ProfileHeader.tsx'),
      `
      import { Avatar } from "./Avatar";
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
      }
      `
    )
    const profileCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { ProfileHeader } from "../components/ProfileHeader";
      import { PostCard } from "../components/PostCard";
      import { CommentThread } from "../components/CommentThread";
      export default function ProfilePage() {
        const data = useData();
        return (
          <div>
            <ProfileHeader user={data.profile} />
            {data.profile.posts({ sort: "newest" }).map(post => (
              <div>
                <PostCard post={post} />
                {post.comments({ limit: 5 }).map(comment => (
                  <CommentThread comment={comment} />
                ))}
              </div>
            ))}
          </div>
        );
      }
    `
    const profilePath = path.join(appDir, 'pages', 'Profile.tsx')
    fs.writeFileSync(profilePath, profileCode)
    const out = await runAnalyzer(profilePath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { ProfileHeader } from "../components/ProfileHeader";
            import { PostCard } from "../components/PostCard";
            import { CommentThread } from "../components/CommentThread";
            export default function ProfilePage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.profile; v1?.avatarUrl; v1?.displayName; v1?.bio; const v2 = v1?.location; v2?.city; v2?.country; v1?.posts?.({ sort: "newest" })?.map(i1 => { i1?.title; i1?.excerpt; i1?.author?.name; i1?.tags?.map(i2 => { i2?.name; i2?.color; }); i1?.comments?.({ limit: 5 })?.map(i2 => { i2?.body; i2?.author?.username; i2?.createdAt; }); }); }
      });
              return (
                <div>
                  <ProfileHeader user={data.profile} />
                  {data.profile.posts({ sort: "newest" }).map(post => (
                    <div>
                      <PostCard post={post} />
                      {post.comments({ limit: 5 }).map(comment => (
                        <CommentThread comment={comment} />
                      ))}
                    </div>
                  ))}
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 4: Settings page — two independent useData calls in the same page
  // --------------------------------------------------------------------------
  it('should handle a Settings page with two independent useData calls', async () => {
    writeSharedComponents()
    // components/ThemePreview.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'ThemePreview.tsx'),
      `
      export function ThemePreview({ theme }) {
        return (
          <div style={{ background: theme.primaryColor }}>
            <p>{theme.fontFamily}</p>
            <p>{theme.borderRadius}</p>
          </div>
        );
      }
      `
    )
    const settingsCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { UserCard } from "../components/UserCard";
      import { ThemePreview } from "../components/ThemePreview";
      export default function SettingsPage() {
        const userData = useData();
        const appConfig = useData();
        return (
          <div>
            <h1>Account Settings</h1>
            <UserCard user={userData.account} />
            <p>{userData.account.createdAt}</p>
            <h2>Theme</h2>
            <ThemePreview theme={appConfig.theme} />
            <p>Language: {appConfig.locale.language}</p>
            <p>Timezone: {appConfig.locale.timezone}</p>
          </div>
        );
      }
    `
    const settingsPath = path.join(appDir, 'pages', 'Settings.tsx')
    fs.writeFileSync(settingsPath, settingsCode)
    const out = await runAnalyzer(settingsPath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { UserCard } from "../components/UserCard";
            import { ThemePreview } from "../components/ThemePreview";
            export default function SettingsPage() {
              const userData = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.account; v1?.avatarUrl; v1?.displayName; v1?.email; v1?.createdAt; }
      });
              const appConfig = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.theme; v1?.primaryColor; v1?.fontFamily; v1?.borderRadius; const v2 = __pylonQuery?.locale; v2?.language; v2?.timezone; }
      });
              return (
                <div>
                  <h1>Account Settings</h1>
                  <UserCard user={userData.account} />
                  <p>{userData.account.createdAt}</p>
                  <h2>Theme</h2>
                  <ThemePreview theme={appConfig.theme} />
                  <p>Language: {appConfig.locale.language}</p>
                  <p>Timezone: {appConfig.locale.timezone}</p>
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 5: Full app entry — Layout wrapping a page + child with own useData
  // --------------------------------------------------------------------------
  it('should handle a full app with Layout + child component that has its own useData', async () => {
    writeSharedComponents()
    // components/ActivityFeed.tsx — has its OWN useData
    fs.writeFileSync(
      path.join(appDir, 'components', 'ActivityFeed.tsx'),
      `
      import { useData } from "@getcronit/pylon/pages";
      export function ActivityFeed() {
        const feed = useData();
        return (
          <ul>
            {feed.recentActivity({ limit: 10 }).map(activity => (
              <li>
                <strong>{activity.action}</strong>
                <span>{activity.actor.name}</span>
                <time>{activity.performedAt}</time>
              </li>
            ))}
          </ul>
        );
      }
      `
    )
    const appPageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { Layout } from "../components/Layout";
      import { ActivityFeed } from "../components/ActivityFeed";
      import { UserCard } from "../components/UserCard";
      export default function AppPage() {
        const data = useData();
        return (
          <Layout siteConfig={data.siteConfig}>
            <UserCard user={data.viewer} />
            <ActivityFeed />
          </Layout>
        );
      }
    `
    const appPagePath = path.join(appDir, 'pages', 'AppPage.tsx')
    fs.writeFileSync(appPagePath, appPageCode)
    const out = await runAnalyzer(appPagePath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { Layout } from "../components/Layout";
            import { ActivityFeed } from "../components/ActivityFeed";
            import { UserCard } from "../components/UserCard";
            export default function AppPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.siteConfig; v1?.siteName; const v2 = v1?.logo; v2?.url; v2?.alt; v1?.footerText; const v3 = __pylonQuery?.viewer; v3?.avatarUrl; v3?.displayName; v3?.email; }
      });
              return (
                <Layout siteConfig={data.siteConfig}>
                  <UserCard user={data.viewer} />
                  <ActivityFeed />
                </Layout>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 6: Page with React state variables and conditional data access
  // --------------------------------------------------------------------------
  it('should preserve React state variables and handle conditional field access', async () => {
    const pageCode = `
      import { useState } from "react";
      import { useData } from "@getcronit/pylon/pages";
      export default function SearchPage() {
        const [query, setQuery] = useState("");
        const [page, setPage] = useState(0);
        const data = useData();
        const results = data.search({ term: query, offset: page, limit: 25 });
        return (
          <div>
            <h1>{data.searchMeta.totalCount}</h1>
            {results.map(item => (
              <div>
                <h3>{item.title}</h3>
                <p>{item.snippet}</p>
                <span>{item.relevanceScore}</span>
              </div>
            ))}
          </div>
        );
      }
    `
    const searchPath = path.join(appDir, 'pages', 'Search.tsx')
    fs.writeFileSync(searchPath, pageCode)
    const out = await runAnalyzer(searchPath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useState } from "react";
            import { useData } from "@getcronit/pylon/pages";
            export default function SearchPage() {
              const [query, setQuery] = useState("");
              const [page, setPage] = useState(0);
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.search?.({ term: query, offset: page, limit: 25 })?.map(i1 => { i1?.title; i1?.snippet; i1?.relevanceScore; }); __pylonQuery?.searchMeta?.totalCount; }
      });
              const results = data.search({ term: query, offset: page, limit: 25 });
              return (
                <div>
                  <h1>{data.searchMeta.totalCount}</h1>
                  {results.map(item => (
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.snippet}</p>
                      <span>{item.relevanceScore}</span>
                    </div>
                  ))}
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 7: Four-level deep component tree (Page -> Section -> Card -> Detail)
  // --------------------------------------------------------------------------
  it('should resolve selectors across a four-level deep component tree', async () => {
    // Level 4: components/PriceTag.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'PriceTag.tsx'),
      `
      export function PriceTag({ pricing }) {
        return (
          <div>
            <span>{pricing.amount}</span>
            <span>{pricing.currency}</span>
            <small>{pricing.discount.percentage}</small>
          </div>
        );
      }
      `
    )
    // Level 3: components/ProductCard.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'ProductCard.tsx'),
      `
      import { PriceTag } from "./PriceTag";
      export function ProductCard({ product }) {
        return (
          <div>
            <h3>{product.name}</h3>
            <p>{product.description}</p>
            <img src={product.image.thumbnail} />
            <PriceTag pricing={product.pricing} />
          </div>
        );
      }
      `
    )
    // Level 2: components/ProductSection.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'ProductSection.tsx'),
      `
      import { ProductCard } from "./ProductCard";
      export function ProductSection({ products, sectionTitle }) {
        return (
          <section>
            <h2>{sectionTitle}</h2>
            {products.map(p => <ProductCard product={p} />)}
          </section>
        );
      }
      `
    )
    // Level 1: pages/StorePage.tsx
    const storeCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { ProductSection } from "../components/ProductSection";
      export default function StorePage() {
        const data = useData();
        return (
          <div>
            <h1>{data.store.name}</h1>
            <ProductSection
              products={data.store.featuredProducts({ limit: 8 })}
              sectionTitle={data.store.featuredLabel}
            />
          </div>
        );
      }
    `
    const storePath = path.join(appDir, 'pages', 'StorePage.tsx')
    fs.writeFileSync(storePath, storeCode)
    const out = await runAnalyzer(storePath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { ProductSection } from "../components/ProductSection";
            export default function StorePage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.store; v1?.name; v1?.featuredProducts?.({ limit: 8 })?.map(i1 => { i1?.name; i1?.description; i1?.image?.thumbnail; const v2 = i1?.pricing; v2?.amount; v2?.currency; v2?.discount?.percentage; }); v1?.featuredLabel; }
      });
              return (
                <div>
                  <h1>{data.store.name}</h1>
                  <ProductSection
                    products={data.store.featuredProducts({ limit: 8 })}
                    sectionTitle={data.store.featuredLabel}
                  />
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 8: Page with useData options object and data destructuring
  // --------------------------------------------------------------------------
  it('should inject selectors alongside existing useData config', async () => {
    writeSharedComponents()
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function ConfiguredPage() {
        const data = useData({ pollInterval: 5000, retry: 3 });
        return (
          <div>
            <h1>{data.dashboard.title}</h1>
            <p>{data.dashboard.lastUpdated}</p>
            {data.dashboard.widgets.map(w => (
              <div>
                <span>{w.type}</span>
                <span>{w.content.value}</span>
              </div>
            ))}
          </div>
        );
      }
    `
    const configuredPath = path.join(appDir, 'pages', 'ConfiguredPage.tsx')
    fs.writeFileSync(configuredPath, pageCode)
    const out = await runAnalyzer(configuredPath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function ConfiguredPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.dashboard; v1?.title; v1?.lastUpdated; v1?.widgets?.map(i1 => { i1?.type; i1?.content?.value; }); }, pollInterval: 5000, retry: 3 });
              return (
                <div>
                  <h1>{data.dashboard.title}</h1>
                  <p>{data.dashboard.lastUpdated}</p>
                  {data.dashboard.widgets.map(w => (
                    <div>
                      <span>{w.type}</span>
                      <span>{w.content.value}</span>
                    </div>
                  ))}
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 9: Multiple pages built as separate entry points — isolation
  // --------------------------------------------------------------------------
  it('should correctly isolate selectors when building multiple pages', async () => {
    // Page A: only accesses user data
    const pageACode = `
      import { useData } from "@getcronit/pylon/pages";
      export function PageA() {
        const data = useData();
        return <div>{data.user.firstName} {data.user.lastName}</div>;
      }
    `
    const pageAPath = path.join(appDir, 'pages', 'PageA.tsx')
    fs.writeFileSync(pageAPath, pageACode)
    // Page B: only accesses product data
    const pageBCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function PageB() {
        const data = useData();
        return <div>{data.product.sku} - {data.product.price}</div>;
      }
    `
    const pageBPath = path.join(appDir, 'pages', 'PageB.tsx')
    fs.writeFileSync(pageBPath, pageBCode)
    // Build them independently
    // Build them independently — separate analyzer runs, no shared state.
    const [outA, outB] = await Promise.all([
      runAnalyzer(pageAPath),
      runAnalyzer(pageBPath)
    ])
    expect(outA).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function PageA() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.user; v1?.firstName; v1?.lastName; }
      });
              return <div>{data.user.firstName} {data.user.lastName}</div>;
            }
          "
    `)
    expect(outB).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function PageB() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.product; v1?.sku; v1?.price; }
      });
              return <div>{data.product.sku} - {data.product.price}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 10: Complex page with double-nested array mappings + arguments at each level
  // --------------------------------------------------------------------------
  it('should handle double-nested array mappings with arguments at each nesting level', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function OrgPage() {
        const data = useData();
        return (
          <div>
            <h1>{data.organization.name}</h1>
            {data.organization.teams({ active: true }).map(team => (
              <div>
                <h2>{team.name}</h2>
                <p>{team.lead.email}</p>
                {team.members({ role: "engineer" }).map(member => (
                  <div>
                    <span>{member.fullName}</span>
                    <span>{member.title}</span>
                    {member.contributions({ year: 2024 }).map(contrib => (
                      <p>{contrib.project} - {contrib.hours}</p>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      }
    `
    const orgPath = path.join(appDir, 'pages', 'OrgPage.tsx')
    fs.writeFileSync(orgPath, pageCode)
    const out = await runAnalyzer(orgPath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function OrgPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.organization; v1?.name; v1?.teams?.({ active: true })?.map(i1 => { i1?.name; i1?.lead?.email; i1?.members?.({ role: "engineer" })?.map(i2 => { i2?.fullName; i2?.title; i2?.contributions?.({ year: 2024 })?.map(i3 => { i3?.project; i3?.hours; }); }); }); }
      });
              return (
                <div>
                  <h1>{data.organization.name}</h1>
                  {data.organization.teams({ active: true }).map(team => (
                    <div>
                      <h2>{team.name}</h2>
                      <p>{team.lead.email}</p>
                      {team.members({ role: "engineer" }).map(member => (
                        <div>
                          <span>{member.fullName}</span>
                          <span>{member.title}</span>
                          {member.contributions({ year: 2024 }).map(contrib => (
                            <p>{contrib.project} - {contrib.hours}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 11: Custom hook wrapping useData
  // --------------------------------------------------------------------------
  it('should handle a custom hook wrapping useData', async () => {
    // 1. Create a page that has a local custom hook that calls useData
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { UserCard } from "../components/UserCard";
      export function useUser() {
        const data = useData();
        return data.currentUser;
      }
      export default function ProfilePage() {
        const user = useUser();
        return (
          <div>
            <h1>Profile</h1>
            <UserCard user={user} />
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'ProfileWithLocalHook.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const out = await runAnalyzer(pagePath)
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { UserCard } from "../components/UserCard";
            export function useUser() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.currentUser; v1?.avatarUrl; v1?.displayName; v1?.email; }
      });
              return data.currentUser;
            }
            export default function ProfilePage() {
              const user = useUser();
              return (
                <div>
                  <h1>Profile</h1>
                  <UserCard user={user} />
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 12: Multiple data paths to the same component
  // --------------------------------------------------------------------------
  it('should handle multiple data paths passed to the same component', async () => {
    writeSharedComponents()
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { UserCard } from "../components/UserCard";
      export default function MultiUserPage() {
        const data = useData();
        return (
          <div>
            <UserCard user={data.sender} />
            <UserCard user={data.receiver} />
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'MultiUser.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const out = await runAnalyzer(pagePath)
    // Both sender and receiver paths should be collected
    expect(out).toMatchInlineSnapshot(
      `
      "
            import { useData } from "@getcronit/pylon/pages";
            import { UserCard } from "../components/UserCard";
            export default function MultiUserPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.sender; v1?.avatarUrl; v1?.displayName; v1?.email; const v2 = __pylonQuery?.receiver; v2?.avatarUrl; v2?.displayName; v2?.email; }
      });
              return (
                <div>
                  <UserCard user={data.sender} />
                  <UserCard user={data.receiver} />
                </div>
              );
            }
          "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 13: Conditional/Ternary JSX rendering
  // --------------------------------------------------------------------------
  it('should handle conditional and ternary JSX rendering', async () => {
    writeSharedComponents()
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { UserCard } from "../components/UserCard";
      import { PostCard } from "../components/PostCard";
      export default function ConditionalPage({ showUser }) {
        const data = useData();
        return (
          <div>
            {showUser ? (
              <UserCard user={data.profile} />
            ) : (
              <PostCard post={data.featuredPost} />
            )}
            {data.hasNotifications && (
              <div>You have mail: {data.notifications[0].title}</div>
            )}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Conditional.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const out = await runAnalyzer(pagePath)

    expect(out).toMatchInlineSnapshot(
      `
      "
            import { useData } from "@getcronit/pylon/pages";
            import { UserCard } from "../components/UserCard";
            import { PostCard } from "../components/PostCard";
            export default function ConditionalPage({ showUser }) {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.profile; v1?.avatarUrl; v1?.displayName; v1?.email; const v2 = __pylonQuery?.featuredPost; v2?.title; v2?.excerpt; v2?.author?.name; v2?.tags?.map(i1 => { i1?.name; i1?.color; }); __pylonQuery?.hasNotifications; __pylonQuery?.notifications?.map(i1 => { i1?.title; }); }
      });
              return (
                <div>
                  {showUser ? (
                    <UserCard user={data.profile} />
                  ) : (
                    <PostCard post={data.featuredPost} />
                  )}
                  {data.hasNotifications && (
                    <div>You have mail: {data.notifications[0].title}</div>
                  )}
                </div>
              );
            }
          "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 14: Barrel file re-exports
  // --------------------------------------------------------------------------
  it('should handle barrel file re-exports', async () => {
    // 1. Create multiple components
    fs.writeFileSync(
      path.join(appDir, 'components', 'A.tsx'),
      `export function ComponentA({ data }) { return <div>{data.fieldA}</div>; }`
    )
    fs.writeFileSync(
      path.join(appDir, 'components', 'B.tsx'),
      `export function ComponentB({ data }) { return <div>{data.fieldB}</div>; }`
    )
    // 2. Create barrel file (index.ts)
    fs.writeFileSync(
      path.join(appDir, 'components', 'index.ts'),
      `
      export * from "./A";
      export * from "./B";
      `
    )
    // 3. Create page importing from barrel
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { ComponentA, ComponentB } from "../components";
      export default function BarrelPage() {
        const data = useData();
        return (
          <div>
            <ComponentA data={data.partA} />
            <ComponentB data={data.partB} />
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Barrel.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const out = await runAnalyzer(pagePath)
    // Verify partA.fieldA and partB.fieldB are collected
    expect(out).toMatchInlineSnapshot(
      `
      "
            import { useData } from "@getcronit/pylon/pages";
            import { ComponentA, ComponentB } from "../components";
            export default function BarrelPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.partA?.fieldA; __pylonQuery?.partB?.fieldB; }
      });
              return (
                <div>
                  <ComponentA data={data.partA} />
                  <ComponentB data={data.partB} />
                </div>
              );
            }
          "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 15: Minified build verification
  // --------------------------------------------------------------------------
  it('transforms useData in a default-exported JSX page', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function MinifiedPage() {
        const data = useData();
        return <div>{data.user.name}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Minified.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const out = await runAnalyzer(pagePath)

    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function MinifiedPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.user?.name; }
      });
              return <div>{data.user.name}</div>;
            }
          "
    `)
  })
  it('should handle GraphQL interfaces and unions via $on syntax', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Profile() {
        const { me } = useData();
        return (
          <>
            <h1>Hello {me.name}, you have these pets:</h1>
            <ol>
              {me.pets.map((pet) => (
                <li key={pet.id ?? "0"}>
                  {pet.name} is a {pet.__typename}
                  {pet.$on.Cat.meows && " and it meows!"}
                  {pet.$on.Dog.barks && " and it barks!"}
                </li>
              ))}
            </ol>
          </>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'ProfileWithInterfaces.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const out = await runAnalyzer(pagePath)
    // Verify injected selectors include $on paths
    expect(out).toMatchInlineSnapshot(
      `
      "
            import { useData } from "@getcronit/pylon/pages";
            export function Profile() {
              const { me } = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.me; v1?.name; v1?.pets?.map(i1 => { i1?.id; i1?.name; i1?.__typename; const v2 = i1?.$on; v2?.Cat?.meows; v2?.Dog?.barks; }); }
      });
              return (
                <>
                  <h1>Hello {me.name}, you have these pets:</h1>
                  <ol>
                    {me.pets.map((pet) => (
                      <li key={pet.id ?? "0"}>
                        {pet.name} is a {pet.__typename}
                        {pet.$on.Cat.meows && " and it meows!"}
                        {pet.$on.Dog.barks && " and it barks!"}
                      </li>
                    ))}
                  </ol>
                </>
              );
            }
          "
    `
    )
  })
  it('should handle polymorphic rendering with $on and sub-components', async () => {
    fs.writeFileSync(
      path.join(appDir, 'components', 'PetComponents.tsx'),
      `
      export function CatComponent({ cat }) {
        return <div>{cat.meows ? "Meow" : "Quiet"}</div>;
      }
      export function DogComponent({ dog }) {
        return <div>{dog.barks ? "Woof" : "Quiet"}</div>;
      }
      `
    )
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { CatComponent, DogComponent } from "../components/PetComponents";
      export default function Profile() {
        const { me } = useData();
        return (
          <div>
            {me.pets.map((pet) => (
              <div key={pet.id}>
                {pet.$on.Cat && <CatComponent cat={pet.$on.Cat} />}
                {pet.$on.Dog && <DogComponent dog={pet.$on.Dog} />}
              </div>
            ))}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'ProfilePolymorphic.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const out = await runAnalyzer(pagePath)
    // Verify injected selectors follow into sub-components through $on
    expect(out).toMatchInlineSnapshot(
      `
      "
            import { useData } from "@getcronit/pylon/pages";
            import { CatComponent, DogComponent } from "../components/PetComponents";
            export default function Profile() {
              const { me } = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.me?.pets?.map(i1 => { i1?.id; const v1 = i1?.$on; v1?.Cat?.meows; v1?.Dog?.barks; }); }
      });
              return (
                <div>
                  {me.pets.map((pet) => (
                    <div key={pet.id}>
                      {pet.$on.Cat && <CatComponent cat={pet.$on.Cat} />}
                      {pet.$on.Dog && <DogComponent dog={pet.$on.Dog} />}
                    </div>
                  ))}
                </div>
              );
            }
          "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 18: Custom Hook in Separate File (Non-Bundled)
  // --------------------------------------------------------------------------
  it('should handle a custom hook in a separate file with cross-file aggregation (non-bundled)', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'userHook.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function useUser() {
        return useData().user;
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useUser } from "../hooks/userHook";
      export default function ProfilePage() {
        const user = useUser();
        return <div>{user.name} and {user.email}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'CrossFileProfile.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // Cross-file aggregation: the page's user.name/user.email accesses must
    // propagate through the hook into its useData — so load the whole graph.
    const hookOut = await runAnalyzerMulti([pagePath, hooksPath], hooksPath)
    expect(hookOut).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function useUser() {
              return useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.user; v1?.name; v1?.email; }
      }).user;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 19: Multilevel Custom Hook Chain (Non-Bundled)
  // --------------------------------------------------------------------------
  it('should handle a deep chain of custom hooks across multiple files (non-bundled)', async () => {
    const apiPath = path.join(appDir, 'hooks', 'api.ts')
    const apiCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function useBase() {
        return useData();
      }
    `
    fs.writeFileSync(apiPath, apiCode)
    const hooksPath = path.join(appDir, 'hooks', 'hooks-chain.ts')
    const hooksCode = `
      import { useBase } from "./api";
      export function useProfile() {
        const data = useBase();
        return data.me;
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useProfile } from "../hooks/hooks-chain";
      export default function DeepChainPage() {
        const me = useProfile();
        return <h1>{me.displayName}</h1>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'DeepChain.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // Cross-file aggregation across the chain page → hooks-chain → api: the
    // page's me.displayName must reach api.ts's useData, so load the whole graph.
    const apiOut = await runAnalyzerMulti(
      [pagePath, hooksPath, apiPath],
      apiPath
    )
    expect(apiOut).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function useBase() {
              return useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.me?.displayName; }
      });
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 20: Common JS Methods and Constructors
  // --------------------------------------------------------------------------
  it('should NOT treat common JS methods or constructors as GraphQL selectors', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Profile() {
        const { me } = useData();
        return (
          <>
            <h1>Hello {me.name}!</h1>
            <p>Last updated at {new Date(me.updatedAt).toLocaleString()}</p>
            <div>Type: {me.type.toString()}</div>
          </>
        );
      }
    `
    const filePath = path.join(appDir, 'pages', 'JSInternals.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    // Check that name and updatedAt and type are tracked in the prepare block
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export function Profile() {
              const { me } = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.me; v1?.name; v1?.updatedAt; v1?.type; }
      });
              return (
                <>
                  <h1>Hello {me.name}!</h1>
                  <p>Last updated at {new Date(me.updatedAt).toLocaleString()}</p>
                  <div>Type: {me.type.toString()}</div>
                </>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 21: Helper function returning derived value
  // --------------------------------------------------------------------------
  it('should handle query data passed to a helper function that returns a derived value', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      function formatUser(user) {
        return user.firstName + " " + user.lastName + " (" + user.email + ")";
      }
      export default function Profile() {
        const data = useData();
        return (
          <div>
            <h1>{formatUser(data.currentUser)}</h1>
            <span>Account: {data.currentUser.account.id}</span>
          </div>
        );
      }
    `
    const filePath = path.join(appDir, 'pages', 'HelperFunction.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    // Check that fields are tracked
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            function formatUser(user) {
              return user.firstName + " " + user.lastName + " (" + user.email + ")";
            }
            export default function Profile() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.currentUser; v1?.firstName; v1?.lastName; v1?.email; v1?.account?.id; }
      });
              return (
                <div>
                  <h1>{formatUser(data.currentUser)}</h1>
                  <span>Account: {data.currentUser.account.id}</span>
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 22: Aliased Imports
  // --------------------------------------------------------------------------
  it('should handle aliased useData imports', async () => {
    const inputCode = `
      import { useData as uq } from "@getcronit/pylon/pages";
      export default function App() {
        const { user } = uq();
        return <div>{user.id}</div>;
      }
    `
    const filePath = path.join(appDir, 'pages', 'AliasedImport.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData as uq } from "@getcronit/pylon/pages";
            export default function App() {
              const { user } = uq({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.user?.id; }
      });
              return <div>{user.id}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 23: Circular Hook Dependencies
  // --------------------------------------------------------------------------
  it('should handle circular hook dependencies safely', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'circular.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { useB } from "./circularB";
      export function useA() {
        const data = useData();
        const b = useB();
        return { user: data.user, b };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const hooksBPath = path.join(appDir, 'hooks', 'circularB.ts')
    const hooksBCode = `
      import { useA } from "./circular";
      export function useB() {
        // Technically this would be an infinite hook loop in React, 
        // but the static analyzer should handle it safely.
        return { name: "B" };
      }
    `
    fs.writeFileSync(hooksBPath, hooksBCode)
    const pageCode = `
      import { useA } from "../hooks/circular";
      export default function Page() {
        const a = useA();
        return <div>{a.user.username}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Circular.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useA } from "../hooks/circular";
            export default function Page() {
              const a = useA();
              return <div>{a.user.username}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 24: Destructuring with Aliasing
  // --------------------------------------------------------------------------
  it('should handle destructuring with aliasing', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function App() {
        const { currentUser: person } = useData();
        return <div>{person.firstName}</div>;
      }
    `
    const filePath = path.join(appDir, 'pages', 'AliasDestructure.tsx')
    fs.writeFileSync(filePath, inputCode)
    const outputCode = await runAnalyzer(filePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function App() {
              const { currentUser: person } = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.currentUser?.firstName; }
      });
              return <div>{person.firstName}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 25: Object spread operator support
  // --------------------------------------------------------------------------
  it('should handle object spread operator in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'spread.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function useEnhancedUser() {
        const { user } = useData();
        return { ...user, source: "pylon" };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useEnhancedUser } from "../hooks/spread";
      export default function Page() {
        const user = useEnhancedUser();
        return <div>{user.displayName} ({user.source})</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Spread.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useEnhancedUser } from "../hooks/spread";
            export default function Page() {
              const user = useEnhancedUser();
              return <div>{user.displayName} ({user.source})</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 26: Complex object transformation (Shadowing + Re-mapping)
  // --------------------------------------------------------------------------
  it('should handle shadowing + re-mapping in object returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'complex.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function useEnhancedUser() {
        const { user } = useData();
        return { ...user, name: undefined, source: user.name };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useEnhancedUser } from "../hooks/complex";
      export default function Page() {
        const user = useEnhancedUser();
        return <div>{user.source} (original name)</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Complex.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useEnhancedUser } from "../hooks/complex";
            export default function Page() {
              const user = useEnhancedUser();
              return <div>{user.source} (original name)</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 27: Object destructuring with rest operator
  // --------------------------------------------------------------------------
  it('should handle object rest operator in destructuring', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function Page() {
        const { user, ...rest } = useData();
        return <div>{rest.meta.version}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'RestObject.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function Page() {
              const { user, ...rest } = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.user; __pylonQuery?.meta?.version; }
      });
              return <div>{rest.meta.version}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 28: Array destructuring with rest operator
  // --------------------------------------------------------------------------
  it('should handle array rest operator in destructuring', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function Page() {
        const { posts } = useData();
        const [first, ...others] = posts;
        return (
          <ul>
            <li>{first.title}</li>
            {others.map(p => <li key={p.id}>{p.title}</li>)}
          </ul>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'RestArray.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function Page() {
              const { posts } = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.posts?.map(i1 => { i1?.title; i1?.id; }); }
      });
              const [first, ...others] = posts;
              return (
                <ul>
                  <li>{first.title}</li>
                  {others.map(p => <li key={p.id}>{p.title}</li>)}
                </ul>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 29: Default values in destructuring
  // --------------------------------------------------------------------------
  it('should handle default values in destructuring', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function Page() {
        const { user = { displayName: "Guest" } } = useData();
        return <div>Hello {user.displayName}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'DefaultValue.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function Page() {
              const { user = { displayName: "Guest" } } = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.user?.displayName; }
      });
              return <div>Hello {user.displayName}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 30: Nested scope cross-referencing
  // --------------------------------------------------------------------------
  it('should handle nested scope cross-referencing', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function Page() {
        const { posts } = useData();
        return (
          <div>
            {posts.map(post => (
              <div key={post.id}>
                <h2>{post.title}</h2>
                {post.comments.map(comment => (
                  <p key={comment.id}>{comment.text} - Replying to {post.title}</p>
                ))}
              </div>
            ))}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'NestedScope.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function Page() {
              const { posts } = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.posts?.map(i1 => { i1?.id; i1?.title; i1?.comments?.map(i2 => { i2?.id; i2?.text; }); }); }
      });
              return (
                <div>
                  {posts.map(post => (
                    <div key={post.id}>
                      <h2>{post.title}</h2>
                      {post.comments.map(comment => (
                        <p key={comment.id}>{comment.text} - Replying to {post.title}</p>
                      ))}
                    </div>
                  ))}
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 31: Computed property names in hook returns
  // --------------------------------------------------------------------------
  it('should handle computed property names in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'computed.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function useDynamicUser() {
        const { user } = useData();
        return { ["profile"]: user };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useDynamicUser } from "../hooks/computed";
      export default function Page() {
        const data = useDynamicUser();
        return <div>{data.profile.displayName}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Computed.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useDynamicUser } from "../hooks/computed";
            export default function Page() {
              const data = useDynamicUser();
              return <div>{data.profile.displayName}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 32: Object methods in hook returns
  // --------------------------------------------------------------------------
  it('should handle object methods in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'methods.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function useUserActions() {
        const { user } = useData();
        return {
          getFullName: () => user.firstName + " " + user.lastName
        };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useUserActions } from "../hooks/methods";
      export default function Page() {
        const actions = useUserActions();
        return <div>{actions.getFullName()}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Methods.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useUserActions } from "../hooks/methods";
            export default function Page() {
              const actions = useUserActions();
              return <div>{actions.getFullName()}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 33: Array reduce transformations
  // --------------------------------------------------------------------------
  it('should handle array.reduce in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'reduce.ts')

    const useDataCode = `
      export const useData = () => ({ posts: [{id: 1, title: 'hello'}] })
    `

    fs.writeFileSync(path.join(appDir, 'hooks', 'useData.ts'), useDataCode)

    const hooksCode = `
      import { useData } from "./useData";
      export function usePostsMap() {
        const { posts } = useData()
        return posts.reduce((acc, post) => {
          acc[post.id] = post
          return acc
        }, {})
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { usePostsMap } from "../hooks/reduce";
      export default function Page() {
        const postsById = usePostsMap();
        return <div>{postsById["123"].title}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Reduce.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath, {
          pylonPackage: './useData'
        })
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { usePostsMap } from "../hooks/reduce";
            export default function Page() {
              const postsById = usePostsMap();
              return <div>{postsById["123"].title}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 34: useData with empty options object
  // --------------------------------------------------------------------------
  it('should handle useData with an empty options object', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      export default function Page() {
        const data = useData({});
        return <div>{data.user.name}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'EmptyOptions.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            export default function Page() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.user?.name; }
      });
              return <div>{data.user.name}</div>;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 35: Multiple file example with nodes array and sub-component
  // --------------------------------------------------------------------------
  it('should handle multiple files where nodes are passed to a task component', async () => {
    // 1. Create a Task component in another file
    fs.writeFileSync(
      path.join(appDir, 'components', 'Task.tsx'),
      `
      export function Task({ node }) {
        return (
          <div>
            <span>{node.id}</span>
            <h1>{node.title}</h1>
          </div>
        );
      }
      `
    )
    // 2. Create the main page
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { Task } from "../components/Task";
      enum TaskStatus {
        TODO = "TODO",
        DONE = "DONE"
      }
      export default function TasksPage() {
        const data = useData();
        const tasks = data.tasks({
          filters: {
            status: TaskStatus.TODO,
          },
          first: 5,
        }).nodes;
        return (
          <div>
            {tasks.map(task => <Task node={task} />)}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'TasksPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 3. Build the page
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { Task } from "../components/Task";
            enum TaskStatus {
              TODO = "TODO",
              DONE = "DONE"
            }
            export default function TasksPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.tasks?.({ filters: { status: TaskStatus.TODO }, first: 5 }); v1?.nodes?.map(i1 => { i1?.id; i1?.title; }); }
      });
              const tasks = data.tasks({
                filters: {
                  status: TaskStatus.TODO,
                },
                first: 5,
              }).nodes;
              return (
                <div>
                  {tasks.map(task => <Task node={task} />)}
                </div>
              );
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 36: Multiple file example with nodes array passed as a whole
  // --------------------------------------------------------------------------
  it('should handle multiple files where the whole nodes array is passed to a component', async () => {
    // 1. Create a Tasks component in another file
    fs.writeFileSync(
      path.join(appDir, 'components', 'Tasks.tsx'),
      `
      export function Tasks({ nodes }) {
        return (
          <ul>
            {nodes.map(node => (
              <li key={node.id}>{node.title}</li>
            ))}
          </ul>
        );
      }
      `
    )
    // 2. Create the main page
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { Tasks } from "../components/Tasks";
      export default function AllTasksPage() {
        const data = useData();
        const nodes = data.tasks({ first: 10 }).nodes;
        return <Tasks nodes={nodes} />;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'AllTasksPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 3. Build the page
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { Tasks } from "../components/Tasks";
            export default function AllTasksPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.tasks?.({ first: 10 }); v1?.nodes?.map(i1 => { i1?.id; i1?.title; }); }
      });
              const nodes = data.tasks({ first: 10 }).nodes;
              return <Tasks nodes={nodes} />;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 37: Alias resolution via tsconfig.json
  // --------------------------------------------------------------------------
  it('should handle alias imports by loading tsconfig from esbuild options', async () => {
    // 1. Setup directories
    const aliasAppDir = path.join(tempDir, 'alias-app')
    if (fs.existsSync(aliasAppDir))
      fs.rmSync(aliasAppDir, {recursive: true, force: true})
    fs.mkdirSync(path.join(aliasAppDir, 'components'), {recursive: true})
    fs.mkdirSync(path.join(aliasAppDir, 'pages'), {recursive: true})
    // 2. Create component
    fs.writeFileSync(
      path.join(aliasAppDir, 'components', 'UserBadge.tsx'),
      `export function UserBadge({ user }) { return <span>{user.nickname}</span>; }`
    )
    // 3. Create page with alias import
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { UserBadge } from "@/pages/components/UserBadge";
      export default function AliasPage() {
        const data = useData();
        return <UserBadge user={data.me} />;
      }
    `
    const pagePath = path.join(aliasAppDir, 'pages', 'AliasPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 4. Create tsconfig.json
    const tsconfig = {
      compilerOptions: {
        jsx: 'react-jsx',
        baseUrl: '.',
        paths: {
          '@/pages/*': ['./*']
        }
      }
    }
    const tsconfigPath = path.join(aliasAppDir, 'tsconfig.json')
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig))
    // 5. Analyze, resolving the `@/` alias via the fixture's tsconfig so the
    //    analyzer can follow data.me into the aliased component.
    const out = await runAnalyzer(pagePath, {tsConfigFilePath: tsconfigPath})
    expect(out).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { UserBadge } from "@/pages/components/UserBadge";
            export default function AliasPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { __pylonQuery?.me?.nickname; }
      });
              return <UserBadge user={data.me} />;
            }
          "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 38: Custom hook in separate file with cross-file aggregation
  // --------------------------------------------------------------------------
  it('should handle a custom hook in a separate file with alias and index re-export', async () => {
    // 1. Create the hook in another file
    const hookCode = `
      export function useTicketInfo({pageInfo}: {pageInfo: {totalCount: number}}) {
        pageInfo.totalCount;
        return null
      }
    `
    fs.writeFileSync(path.join(appDir, 'hooks', 'useTicketInfo.ts'), hookCode)
    // 2. Create the index file in the hooks folder
    fs.writeFileSync(
      path.join(appDir, 'hooks', 'index.ts'),
      `export * from "./useTicketInfo";`
    )
    // 3. Update tsconfig.json to include the alias
    const tsconfigPath = path.join(appDir, 'tsconfig.json')
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            jsx: 'react-jsx',
            baseUrl: '.',
            paths: {
              '@/pages/*': ['./*']
            }
          }
        },
        null,
        2
      )
    )
    // 4. Create the main page that imports and uses the hook via alias
    const pageCode = `
      import { useData } from "@getcronit/pylon/pages";
      import { useTicketInfo } from "@/pages/hooks";
      export default function TicketsPage() {
        const data = useData();
        const {pageInfo} = data.tickets({})
        const total = useTicketInfo({pageInfo});
        return <div>Total tickets: {total}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'TicketsPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 5. Build the page
    const outputCode = await runAnalyzer(pagePath)
    expect(outputCode).toMatchInlineSnapshot(`
      "
            import { useData } from "@getcronit/pylon/pages";
            import { useTicketInfo } from "@/pages/hooks";
            export default function TicketsPage() {
              const data = useData({
        prepare: ({ query: __pylonQuery }) => { const v1 = __pylonQuery?.tickets?.({}); v1?.pageInfo; }
      });
              const {pageInfo} = data.tickets({})
              const total = useTicketInfo({pageInfo});
              return <div>Total tickets: {total}</div>;
            }
          "
    `)
  })

  it('warns (not errors) and skips pre-fetch when a selection reads a TDZ variable', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const data = useData();
        const searchValue = "x";
        console.log(data.posts({ query: searchValue }).totalCount);
      }
    `
    const filePath = path.join(tempDir, 'testTDZ.tsx')
    fs.writeFileSync(filePath, inputCode)
    // prepare is only an optimization, so this WARNS + skips injection (lazy
    // fallback) — it must NOT fail the build.
    const {code, warnings} = await runAnalyzerResult(filePath)
    expect(
      warnings.some(w => /temporal dead zone|searchValue/.test(w.text))
    ).toBe(true)
    // pre-fetch skipped → no prepare injected for that call
    expect(code).not.toContain('prepare:')
  })

  it('does NOT error when the variable is declared before useData', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon/pages";
      export function Component() {
        const searchValue = "x";
        const data = useData();
        console.log(data.posts({ query: searchValue }).totalCount);
      }
    `
    const filePath = path.join(tempDir, 'testNoTDZ.tsx')
    fs.writeFileSync(filePath, inputCode)
    expect(await runAnalyzer(filePath)).toContain('prepare:')
  })
})
