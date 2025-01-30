import { JSX, cloneElement } from "react";

import Page from "./.pylon/pages/app"

console.log('Page', Page)

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

const page = <Page pageProps={{}} />

console.log(injectHead(page, <head><title>Test</title></head>))

