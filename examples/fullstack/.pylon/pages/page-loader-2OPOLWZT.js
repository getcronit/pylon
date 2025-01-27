import {
  require_jsx_runtime
} from "./chunk-WMCGM574.js";
import {
  __toESM
} from "./chunk-B5GXU7YJ.js";

// ../../packages/pylon/page-loader.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
var PylonPageLoader = (props) => {
  props.client.useHydrateCache({ cacheSnapshot: props.cacheSnapshot });
  const data = props.client.useQuery();
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(props.Page, { data, ...props.pageProps });
};
export {
  PylonPageLoader
};
