const routes = [
    {
      "pagePath": "pages/page.tsx",
      "slug": "/",
      "layouts": [
        "pages/layout.tsx"
      ]
    },
    {
      "pagePath": "pages/test/[slug]/page.tsx",
      "slug": "/test/:slug",
      "layouts": [
        "pages/layout.tsx"
      ]
    },
    {
      "pagePath": "pages/test/page.tsx",
      "slug": "/test",
      "layouts": [
        "pages/layout.tsx",
        "pages/layout.tsx"
      ]
    }
  ]

const makePageMap = (routes: any) => {
    const pageMap: Record<string, string> = {}
    for (const route of routes) {
      pageMap[route.pagePath] = `Page${fnv1aHash(route.pagePath)}`
    }
    return pageMap
  }



const makeLayoutMap = (routes: any) => {
    const layoutMap: Record<string, string> = {}
    for (const route of routes) {
      for (const layout of route.layouts) {
        layoutMap[layout] = `Layout${fnv1aHash(layout)}`
      }
    }
    return layoutMap
  }

    const layoutMap = makeLayoutMap(routes)

    console.log(layoutMap)

    const pageMap = makePageMap(routes)

    console.log(pageMap)

  function fnv1aHash(str: string) {
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }