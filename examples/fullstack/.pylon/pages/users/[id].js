import {
  require_jsx_runtime
} from "../chunk-WMCGM574.js";
import {
  __toESM
} from "../chunk-B5GXU7YJ.js";

// components/PostCard.tsx
var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
function PostCard({ post }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "bg-white shadow-md rounded-lg p-6 mb-4", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "text-2xl font-semibold mb-2", children: post.title }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "text-gray-600 mb-4", children: post.content }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "flex justify-between items-center", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: `/users/${post.author.id}`, className: "text-blue-500 hover:underline", children: post.author.name }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "space-x-2", children: post.tags.map((tag, key) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "bg-gray-200 text-gray-700 px-2 py-1 rounded text-sm", children: tag }, key)) })
    ] })
  ] });
}

// pages/users/[id].tsx
var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
var Page = ({ data, params, searchParams }) => {
  console.log("data", data, "params", params, "searchParams", searchParams);
  const user = data.users.find((user2) => {
    console.log("user match", user2.id, params.id, user2.id === Number(params.id));
    return user2.id === Number(params.id);
  }) || data.users[0];
  console.log("user", user);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h2", { className: "text-3xl font-semibold mb-6", children: [
      user?.name,
      "'s Profile"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "mb-8", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { className: "text-lg", children: [
      "Email: ",
      user?.email
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("h3", { className: "text-2xl font-semibold mb-4", children: [
      "Posts by ",
      user?.name
    ] }),
    user?.posts.map((post, key) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(PostCard, { post }, key))
  ] });
};
var id_default = Page;
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
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(PylonPageLoader, { client, Page, pageProps: pylonData.pageProps, cacheSnapshot: pylonData.cacheSnapshot })
    );
  } catch (error) {
    console.error("Error hydrating root", error);
  }
}
export {
  id_default as default
};
