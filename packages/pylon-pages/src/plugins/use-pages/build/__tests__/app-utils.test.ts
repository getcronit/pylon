import fs from 'fs'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
  convertToDynamicRoute,
  getLayoutComponentName,
  makeAppFiles,
  scanDirectory
} from '../app-utils'

vi.mock('fs')

describe('app-utils', () => {
  const mockReaddirSync = vi.mocked(fs.readdirSync)

  beforeEach(() => {
    mockReaddirSync.mockReset()
  })

  function setupMockFileSystem(structure: Record<string, string[]>) {
    mockReaddirSync.mockImplementation((dirPath: any) => {
      // Normalize path: replace backslashes, remove trailing slash
      let normalizedPath = dirPath
        .toString()
        .replace(/\\/g, '/')
        .replace(/\/$/, '')

      if (!normalizedPath.startsWith('./') && !normalizedPath.startsWith('/')) {
        normalizedPath = './' + normalizedPath
      }

      const contents = structure[normalizedPath]
      if (!contents) {
        return []
      }

      return contents.map(name => {
        const childPath =
          normalizedPath === './' ? './' + name : normalizedPath + '/' + name
        const isDir = Object.prototype.hasOwnProperty.call(structure, childPath)

        return {
          name,
          isDirectory: () => isDir,
          isFile: () => !isDir
        } as any
      })
    })
  }

  describe('getLayoutComponentName', () => {
    it('should generate correct layout component name for root layout', () => {
      expect(getLayoutComponentName('./pages/layout.tsx')).toBe('Layout')
    })

    it('should generate correct layout component name for nested layout', () => {
      expect(getLayoutComponentName('./pages/posts/layout.tsx')).toBe(
        'PostsLayout'
      )
    })

    it('should handle dynamic segments in layout name', () => {
      expect(getLayoutComponentName('./pages/posts/[id]/layout.tsx')).toBe(
        'PostsIdLayout'
      )
    })

    it('should handle catch-all segments in layout name', () => {
      expect(getLayoutComponentName('./pages/posts/[...slug]/layout.tsx')).toBe(
        'PostsCatchAllSlugLayout'
      )
    })
  })

  describe('convertToDynamicRoute', () => {
    it('should convert standard dynamic segment', () => {
      expect(convertToDynamicRoute('[id]')).toBe(':id')
    })

    it('should convert catch-all segment', () => {
      expect(convertToDynamicRoute('[...slug]')).toBe('*')
    })

    it('should return static segment as is', () => {
      expect(convertToDynamicRoute('posts')).toBe('posts')
    })
  })

  describe('scanDirectory', () => {
    it('should scan a simple directory with a page', () => {
      setupMockFileSystem({
        './pages': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)
      expect(route).toMatchObject({
        path: '/',
        children: [
          {
            path: undefined,
            index: true,
            lazy: `async () => {const i = await import("./../pages/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "Page", undefined)}}`,
            HydrateFallback: 'HydrateFallback',
            errorElement: '<ErrorElement standalone={false} />'
          }
        ]
      })
    })

    it('should handle a page with the root layout', () => {
      setupMockFileSystem({
        './pages': ['page.tsx', 'layout.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)
      expect(route).toMatchObject({
        path: '/',
        children: [
          {
            path: undefined,
            index: true,
            lazy: `async () => {const i = await import("./../pages/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "Page", undefined)}}`,
            HydrateFallback: 'HydrateFallback',
            errorElement: '<ErrorElement standalone={false} />'
          },
          {
            element: '<NotFoundPage standalone={false} />',
            path: '*'
          }
        ],
        Component:
          'withRouteData((props) => <RootLayout children={<Outlet />} {...props} />, "RootLayout", undefined)',
        shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
        errorElement: '<ErrorElement standalone={true} />',
        HydrateFallback: 'HydrateFallback'
      })
    })

    it('should handle nested pages with just the root layout', () => {
      setupMockFileSystem({
        './pages': ['page.tsx', 'layout.tsx', 'warehouse'],
        './pages/warehouse': ['page.tsx', 'stock', 'inventory'],
        './pages/warehouse/stock': ['page.tsx'],
        './pages/warehouse/inventory': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)
      expect(route).toMatchObject({
        path: '/',
        children: [
          {
            path: undefined,
            index: true,
            lazy: `async () => {const i = await import("./../pages/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "Page", undefined)}}`,
            HydrateFallback: 'HydrateFallback',
            errorElement: '<ErrorElement standalone={false} />'
          },
          {
            path: 'warehouse',
            children: [
              {
                path: undefined,
                index: true,
                lazy: `async () => {const i = await import("./../pages/warehouse/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "WarehousePage", undefined)}}`,
                HydrateFallback: 'HydrateFallback',
                errorElement: '<ErrorElement standalone={false} />'
              },
              {
                path: 'stock',
                children: [
                  {
                    path: undefined,
                    index: true,
                    lazy: `async () => {const i = await import("./../pages/warehouse/stock/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "WarehouseStockPage", undefined)}}`,
                    HydrateFallback: 'HydrateFallback',
                    errorElement: '<ErrorElement standalone={false} />'
                  }
                ]
              },
              {
                path: 'inventory',
                children: [
                  {
                    path: undefined,
                    index: true,
                    lazy: `async () => {const i = await import("./../pages/warehouse/inventory/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "WarehouseInventoryPage", undefined)}}`,
                    HydrateFallback: 'HydrateFallback',
                    errorElement: '<ErrorElement standalone={false} />'
                  }
                ]
              }
            ]
          },
          {
            path: '*',
            element: '<NotFoundPage standalone={false} />'
          }
        ],
        Component: `withRouteData((props) => <RootLayout children={<Outlet />} {...props} />, "RootLayout", undefined)`,
        shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
        errorElement: '<ErrorElement standalone={true} />',
        HydrateFallback: 'HydrateFallback'
      })
    })

    it('should handle nested routes with layouts', () => {
      setupMockFileSystem({
        './pages': ['posts', 'layout.tsx'],
        './pages/posts': ['layout.tsx', '[id]'],
        './pages/posts/[id]': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)
      expect(route).toMatchObject({
        path: '/',
        children: [
          {
            path: 'posts',
            Component:
              'withRouteData((props) => <PostsLayout children={<Outlet />} {...props} />, "PostsLayout", undefined)',
            shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
            HydrateFallback: 'HydrateFallback',
            children: [
              {
                path: ':id',
                children: [
                  {
                    index: true,
                    lazy: 'async () => {const i = await import("./../pages/posts/[id]/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "PostsIdPage", undefined)}}',
                    HydrateFallback: 'HydrateFallback',
                    errorElement: '<ErrorElement standalone={false} />'
                  }
                ]
              },
              {
                path: '*',
                element: '<NotFoundPage standalone={false} />'
              }
            ]
          },
          {
            path: '*',
            element: '<NotFoundPage standalone={false} />'
          }
        ],
        Component:
          'withRouteData((props) => <RootLayout children={<Outlet />} {...props} />, "RootLayout", undefined)',
        shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
        errorElement: '<ErrorElement standalone={true} />',
        HydrateFallback: 'HydrateFallback'
      })
    })

    it('should handle catch-all routes', () => {
      setupMockFileSystem({
        './pages': ['[...slug]'],
        './pages/[...slug]': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)

      // Since it's a single catch-all child without layout, it should merge into the root
      expect(route).toMatchObject({
        path: '*',
        lazy: `async () => {const i = await import("./../pages/[...slug]/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "CatchAllSlugPage", "slug")}}`,
        HydrateFallback: 'HydrateFallback',
        errorElement: '<ErrorElement standalone={false} />'
      })
    })

    it('should handle nested catch-all routes inside dynamic routes', () => {
      setupMockFileSystem({
        './pages': ['posts', 'layout.tsx'],
        './pages/posts': ['[id]', 'layout.tsx'],
        './pages/posts/[id]': ['[...slug]'],
        './pages/posts/[id]/[...slug]': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)

      // Verify full structure
      expect(route).toMatchObject({
        path: '/',
        children: [
          {
            path: 'posts',
            children: [
              {
                path: ':id/*',
                errorElement: '<ErrorElement standalone={false} />',
                HydrateFallback: 'HydrateFallback',
                // We check the specific generated lazy code for correct param handling, and ensure Component/element is not set (it's lazy)
                lazy: `async () => {const i = await import("./../pages/posts/[id]/[...slug]/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "PostsIdCatchAllSlugPage", "slug")}}`,
              },
              {
                path: '*',
                element: '<NotFoundPage standalone={false} />'
              }
            ],
            Component:
              'withRouteData((props) => <PostsLayout children={<Outlet />} {...props} />, "PostsLayout", undefined)',
            shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
            HydrateFallback: 'HydrateFallback'
          },
          {
            path: '*',
            element: '<NotFoundPage standalone={false} />'
          }
        ],
        Component:
          'withRouteData((props) => <RootLayout children={<Outlet />} {...props} />, "RootLayout", undefined)',
        shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
        errorElement: '<ErrorElement standalone={true} />',
        HydrateFallback: 'HydrateFallback'
      })
    })

    it('should handle 404/Not Found route injection when layout exists', () => {
      setupMockFileSystem({
        './pages': ['layout.tsx', 'contact'],
        './pages/contact': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)
      expect(route).toMatchObject({
        path: '/',
        Component:
          'withRouteData((props) => <RootLayout children={<Outlet />} {...props} />, "RootLayout", undefined)',
        shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
        HydrateFallback: 'HydrateFallback',
        errorElement: '<ErrorElement standalone={true} />',
        children: [
          {
            path: 'contact',
            children: [
              {
                index: true,
                lazy: `async () => {const i = await import("./../pages/contact/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "ContactPage", undefined)}}`,
                HydrateFallback: 'HydrateFallback',
                errorElement: '<ErrorElement standalone={false} />'
              }
            ]
          },
          {
            path: '*',
            element: '<NotFoundPage standalone={false} />'
          }
        ]
      })
    })

    it('should NOT inject 404 route if no layout exists', () => {
      setupMockFileSystem({
        './pages': ['contact'],
        './pages/contact': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)
      expect(route).toMatchObject({
        path: '/',
        children: [
          {
            path: 'contact',
            children: [
              {
                index: true,
                lazy: `async () => {const i = await import("./../pages/contact/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "ContactPage", undefined)}}`,
                HydrateFallback: 'HydrateFallback',
                errorElement: '<ErrorElement standalone={false} />'
              }
            ]
          }
        ]
      })
    })

    it('should handle a complex filesystem structure', () => {
      setupMockFileSystem({
        './pages': ['layout.tsx', 'page.tsx', 'auth', 'dashboard', 'files'],
        './pages/auth': ['layout.tsx', 'login', 'register'],
        './pages/auth/login': ['page.tsx'],
        './pages/auth/register': ['page.tsx'],
        './pages/dashboard': ['layout.tsx', 'page.tsx', 'settings', '[teamId]'],
        './pages/dashboard/settings': ['page.tsx'],
        './pages/dashboard/[teamId]': ['layout.tsx', 'page.tsx', '[projectId]'],
        './pages/dashboard/[teamId]/[projectId]': ['page.tsx'],
        './pages/files': ['[...id]'],
        './pages/files/[...id]': ['page.tsx']
      })

      const context = {imports: [], routeSlugs: []}
      const route = scanDirectory('./pages', context)

      expect(route).toMatchObject({
        path: '/',
        children: [
          {
            path: undefined,
            index: true,
            lazy: `async () => {const i = await import("./../pages/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "Page", undefined)}}`,
            HydrateFallback: 'HydrateFallback',
            errorElement: '<ErrorElement standalone={false} />'
          },
          {
            path: 'auth',
            children: [
              {
                path: 'login',
                children: [
                  {
                    path: undefined,
                    index: true,
                    lazy: `async () => {const i = await import("./../pages/auth/login/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "AuthLoginPage", undefined)}}`,
                    HydrateFallback: 'HydrateFallback',
                    errorElement: '<ErrorElement standalone={false} />'
                  }
                ]
              },
              {
                path: 'register',
                children: [
                  {
                    path: undefined,
                    index: true,
                    lazy: `async () => {const i = await import("./../pages/auth/register/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "AuthRegisterPage", undefined)}}`,
                    HydrateFallback: 'HydrateFallback',
                    errorElement: '<ErrorElement standalone={false} />'
                  }
                ]
              },
              {
                path: '*',
                element: '<NotFoundPage standalone={false} />'
              }
            ],
            Component:
              'withRouteData((props) => <AuthLayout children={<Outlet />} {...props} />, "AuthLayout", undefined)',
            shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
            HydrateFallback: 'HydrateFallback'
          },
          {
            path: 'dashboard',
            children: [
              {
                path: undefined,
                index: true,
                lazy: `async () => {const i = await import("./../pages/dashboard/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "DashboardPage", undefined)}}`,
                HydrateFallback: 'HydrateFallback',
                errorElement: '<ErrorElement standalone={false} />'
              },
              {
                path: 'settings',
                children: [
                  {
                    path: undefined,
                    index: true,
                    lazy: `async () => {const i = await import("./../pages/dashboard/settings/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "DashboardSettingsPage", undefined)}}`,
                    HydrateFallback: 'HydrateFallback',
                    errorElement: '<ErrorElement standalone={false} />'
                  }
                ]
              },
              {
                path: ':teamId',
                children: [
                  {
                    path: undefined,
                    index: true,
                    lazy: `async () => {const i = await import("./../pages/dashboard/[teamId]/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "DashboardTeamIdPage", undefined)}}`,
                    HydrateFallback: 'HydrateFallback',
                    errorElement: '<ErrorElement standalone={false} />'
                  },
                  {
                    path: ':projectId',
                    children: [
                      {
                        path: undefined,
                        index: true,
                        lazy: `async () => {const i = await import("./../pages/dashboard/[teamId]/[projectId]/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "DashboardTeamIdProjectIdPage", undefined)}}`,
                        HydrateFallback: 'HydrateFallback',
                        errorElement: '<ErrorElement standalone={false} />'
                      }
                    ]
                  },
                  {
                    path: '*',
                    element: '<NotFoundPage standalone={false} />'
                  }
                ],
                Component:
                  'withRouteData((props) => <DashboardTeamIdLayout children={<Outlet />} {...props} />, "DashboardTeamIdLayout", undefined)',
                shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = ["teamId"];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
                HydrateFallback: 'HydrateFallback'
              },
              {
                path: '*',
                element: '<NotFoundPage standalone={false} />'
              }
            ],
            Component:
              'withRouteData((props) => <DashboardLayout children={<Outlet />} {...props} />, "DashboardLayout", undefined)',
            shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
            HydrateFallback: 'HydrateFallback'
          },
          {
            path: 'files/*',
            lazy: `async () => {const i = await import("./../pages/files/[...id]/page").catch(() => {window.location.reload()}); return {Component: withRouteData(i.default, "FilesCatchAllIdPage", "id")}}`,
            HydrateFallback: 'HydrateFallback',
            errorElement: '<ErrorElement standalone={false} />'
          },
          {
            path: '*',
            element: '<NotFoundPage standalone={false} />'
          }
        ],
        Component:
          'withRouteData((props) => <RootLayout children={<Outlet />} {...props} />, "RootLayout", undefined)',
        shouldRevalidate: `({ currentParams, nextParams, formData, defaultShouldRevalidate }) => {
    // Revalidate if a form was submitted (standard behavior)
    if (formData) return true;

    // List of params this layout segment depends on
    const relevantKeys = [];
    
    // Check if any relevant URL parameter changed
    const hasParamChanged = relevantKeys.some(key => 
      JSON.stringify(currentParams[key]) !== JSON.stringify(nextParams[key])
    );

    // If it's the RootLayout, we might only want to revalidate on hard refreshes 
    // or specific global triggers. Otherwise, follow param changes.
    return hasParamChanged || (relevantKeys.length === 0 && defaultShouldRevalidate);
  }`,
        errorElement: '<ErrorElement standalone={true} />',
        HydrateFallback: 'HydrateFallback'
      })
    })
  })
  describe('makeAppFiles', () => {
    it('should generate the correct app files content', () => {
      setupMockFileSystem({
        './pages': ['layout.tsx', 'page.tsx', 'auth', 'dashboard'],
        './pages/auth': ['layout.tsx', 'login'],
        './pages/auth/login': ['page.tsx'],
        './pages/dashboard': ['layout.tsx', 'page.tsx', 'settings'],
        './pages/dashboard/settings': ['page.tsx']
      })

      const result = makeAppFiles()

      expect(result.routes).toMatchSnapshot()
      expect(result.slugs).toMatchSnapshot()
    })
  })
})
