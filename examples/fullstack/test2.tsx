import React, { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";

function injectHead(element: ReactElement): ReactElement {
  // Check if the element is valid
  if (!React.isValidElement(element)) {
    return element as ReactElement;
  }

  console.log("element", element);

  // Check if the element renders to an <html> tag
  if (element.type === Layout1) {
    return React.cloneElement(
      element,
      {},
      <>
        <head>
          <title>Injected Head</title>
        </head>
        {element.props.children}
      </>
    );
  }

  console.log(React.Children.map(element.props.children, (child) => child));    

  // Recursively process children
  const children = React.Children.map(
    element.props.children,
    (child) =>
      child 
        ? injectHead(child as ReactElement)
        : child
  );

  // Clone the element with updated children
  return React.cloneElement(element, {}, children);
}

// Layout components
const Layout1: React.FC<{ children: ReactNode }> = ({ children }) => (
  <html>
    <body>{children}</body>
  </html>
);

const Layout2: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="layout2">{children}</div>
);

const Layout3: React.FC<{ children: ReactNode }> = ({ children }) => (
  <div className="layout3">{children}</div>
);

const Page: React.FC<{ [key: string]: any }> = (props) => (
  <div className="page">
    <h1>Page Content</h1>
    <pre>{JSON.stringify(props, null, 2)}</pre>
  </div>
);

// Layout component that accepts props and passes them to Page
const Layout: React.FC<{ [key: string]: any }> = (props) => (
  <Layout1>
    <Layout2>
      <Layout3>
        <Page {...props} />
      </Layout3>
    </Layout2>
  </Layout1>
);

const renderedLayout = React.createElement(Layout);


// Inject the <head> tag into the layout
const ModifiedLayout = injectHead(renderedLayout);

console.log(renderToString(ModifiedLayout));