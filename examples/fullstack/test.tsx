import React, { cloneElement, JSX } from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const { default: Page } = await import(".pylon/pages/test/page.js");

const pageProps = {
  params:{},
  searchParams: {}
}

const Head = () => <head>
  <title>Test</title>
  <script id="__PYLON_DATA__" type="application/json">
    {JSON.stringify({
      pageProps: pageProps,
      cacheSnapshot: {},
      layouts: []
    })}
  </script>
</head>

const e1 = <Page data={{}} {...pageProps} />;

const html = renderToString(Object.assign({}, e1, {
  type: (props) => {
    const e2 = e1.type(props);
    
    return Object.assign({}, e2, {
      type: (props) => {
        const e3 = e2.type(props);

        return cloneElement(e3, {
          children: [<Head key="head" />, e3.props.children]
        });
      },
    });
  }
}));


const injectHead = (page: JSX.Element, head: JSX.Element) => {
  return Object.assign({}, page, {
    type: (props) => {
      const pageElement = page.type(props);
      
      return Object.assign({}, pageElement, {
        type: (props) => {
          const pageElement2 = pageElement.type(props);

          return cloneElement(pageElement2, {
            children: [head, pageElement2.props.children]
          });
        }
      });
    }
  });
}

console.log(renderToString(injectHead(<Page data={{}} {...pageProps} />, <Head key="head" />) ));



// override the root.type.type with the updathed root layout

