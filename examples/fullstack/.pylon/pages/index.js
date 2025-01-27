import {
  require_jsx_runtime
} from "./chunk-WMCGM574.js";
import {
  __toESM,
  require_react
} from "./chunk-B5GXU7YJ.js";

// pages/index.tsx
var import_react = __toESM(require_react(), 1);
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var Page = ({ data }) => {
  const ref = (0, import_react.useRef)(null);
  const handleRefetch = () => {
    data.$refetch();
  };
  const [showContent, setShowContent] = import_react.default.useState(false);
  const handleClick = () => {
    setShowContent(true);
  };
  console.log("loading", data.$state);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
    "Index Page",
    data.posts.map((post, id) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bg-slate-600", children: [
      post.title,
      " ",
      showContent && post.id
    ] }, id))
  ] });
};
var index_default = Page;
if (typeof window !== "undefined") {
  const { PylonPageLoader } = await import("./page-loader-2OPOLWZT.js");
  const client = await import("./client-ZJRS4PLI.js");
  const { default: reactDom } = await import("./client-LY44PAOA.js");
  console.log("reactDom", reactDom);
  const scriptElement = document.getElementById("__PYLON_DATA__");
  if (!scriptElement) {
    throw new Error("Pylon data script not found");
  }
  try {
    const pylonData = JSON.parse(scriptElement.textContent);
    console.log("pylonData", pylonData);
    reactDom.hydrateRoot(
      document.getElementById("root"),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PylonPageLoader, { client, Page, pageProps: pylonData.pageProps, cacheSnapshot: pylonData.cacheSnapshot })
    );
  } catch (error) {
    console.error("Error hydrating root", error);
  }
}
export {
  index_default as default
};
