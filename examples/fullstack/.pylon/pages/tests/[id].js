import {
  require_jsx_runtime
} from "../chunk-WMCGM574.js";
import {
  __toESM
} from "../chunk-B5GXU7YJ.js";

// pages/tests/[id].tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
if (typeof window !== "undefined") {
  const { PylonPageLoader } = await import("../page-loader-2OPOLWZT.js");
  const client = await import("../client-ZJRS4PLI.js");
  const { default: reactDom } = await import("../client-LY44PAOA.js");
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
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PylonPageLoader, { client, Page: null, pageProps: pylonData.pageProps, cacheSnapshot: pylonData.cacheSnapshot })
    );
  } catch (error) {
    console.error("Error hydrating root", error);
  }
}
