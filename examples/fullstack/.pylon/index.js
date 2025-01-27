// src/index.ts
import { app, usePages } from "@getcronit/pylon";
import { handler as __internalPylonHandler } from "@getcronit/pylon";
var Author = class {
  constructor(id, name, email) {
    this.id = id;
    this.name = name;
    this.email = email;
  }
};
var Post = class {
  constructor(id, title, content, author, tags) {
    this.id = id;
    this.title = title;
    this.content = content;
    this.author = author;
    this.tags = tags;
  }
};
var User = class {
  constructor(id, name, email, posts2) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.posts = posts2;
  }
};
var authors = {
  1: new Author(1, "Alice", "alice@example.com"),
  2: new Author(2, "Bob", "bob@example.com"),
  3: new Author(3, "Charlie", "charlie@example.com")
};
var posts = [
  new Post(1, "Foo", "This is the content of the first post.", authors[1], [
    "GraphQL",
    "TypeScript"
  ]),
  new Post(2, "Bar", "This is the content of the second post.", authors[2], [
    "JavaScript",
    "API"
  ])
];
var graphql = {
  Query: {
    posts,
    users: [
      new User(1, "Alice", "alice@example.com", posts.filter((p) => p.author.id === 1)),
      new User(2, "Bob", "bob@test.com", posts.filter((p) => p.author.id === 2))
    ]
  }
};
var config = {
  plugins: [
    // useAuth({
    //   issuer: 'https://accounts2.cronit.io'
    // }),
    usePages({})
  ]
};
var index_default = app;
var __internalPylonConfig = void 0;
try {
  __internalPylonConfig = config;
} catch {
}
app.use(__internalPylonHandler({
  typeDefs: "type Query {\nposts: [Post!]!\nusers: [User!]!\n}\ntype Post {\nid: Number!\ntitle: String!\ncontent: String!\nauthor: Author!\ntags: [String!]!\n}\ntype Author {\nid: Number!\nname: String!\nemail: String!\n}\ntype User {\nid: Number!\nname: String!\nemail: String!\nposts: [Post!]!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  config,
  index_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQge2FwcCwgYXV0aCwgUHlsb25Db25maWcsIHVzZUF1dGgsIHVzZVBhZ2VzfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuXG4vLyBDbGFzc2VzXG5jbGFzcyBBdXRob3Ige1xuICBjb25zdHJ1Y3RvcihwdWJsaWMgaWQ6IG51bWJlciwgcHVibGljIG5hbWU6IHN0cmluZywgcHVibGljIGVtYWlsOiBzdHJpbmcpIHt9XG59XG5cbmNsYXNzIFBvc3Qge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwdWJsaWMgaWQ6IG51bWJlcixcbiAgICBwdWJsaWMgdGl0bGU6IHN0cmluZyxcbiAgICBwdWJsaWMgY29udGVudDogc3RyaW5nLFxuICAgIHB1YmxpYyBhdXRob3I6IEF1dGhvcixcbiAgICBwdWJsaWMgdGFnczogc3RyaW5nW11cbiAgKSB7fVxufVxuXG5jbGFzcyBVc2VyIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHVibGljIGlkOiBudW1iZXIsXG4gICAgcHVibGljIG5hbWU6IHN0cmluZyxcbiAgICBwdWJsaWMgZW1haWw6IHN0cmluZyxcbiAgICBwdWJsaWMgcG9zdHM6IFBvc3RbXVxuICApIHt9XG59XG5cbi8vIEluc3RhbmNlc1xuY29uc3QgYXV0aG9ycyA9IHtcbiAgMTogbmV3IEF1dGhvcigxLCBcIkFsaWNlXCIsIFwiYWxpY2VAZXhhbXBsZS5jb21cIiksXG4gIDI6IG5ldyBBdXRob3IoMiwgXCJCb2JcIiwgXCJib2JAZXhhbXBsZS5jb21cIiksXG4gIDM6IG5ldyBBdXRob3IoMywgXCJDaGFybGllXCIsIFwiY2hhcmxpZUBleGFtcGxlLmNvbVwiKSxcbn07XG5cbmNvbnN0IHBvc3RzID0gW1xuICBuZXcgUG9zdCgxLCBcIkZvb1wiLCBcIlRoaXMgaXMgdGhlIGNvbnRlbnQgb2YgdGhlIGZpcnN0IHBvc3QuXCIsIGF1dGhvcnNbMV0sIFtcbiAgICBcIkdyYXBoUUxcIixcbiAgICBcIlR5cGVTY3JpcHRcIixcbiAgXSksXG4gIG5ldyBQb3N0KDIsIFwiQmFyXCIsIFwiVGhpcyBpcyB0aGUgY29udGVudCBvZiB0aGUgc2Vjb25kIHBvc3QuXCIsIGF1dGhvcnNbMl0sIFtcbiAgICBcIkphdmFTY3JpcHRcIixcbiAgICBcIkFQSVwiLFxuICBdKSxcbl07XG5cblxuLy8gR3JhcGhRTCBzY2hlbWFcbmV4cG9ydCBjb25zdCBncmFwaHFsID0ge1xuICBRdWVyeToge1xuICAgIHBvc3RzLFxuICAgIHVzZXJzOiAgW25ldyBVc2VyKDEsIFwiQWxpY2VcIiwgXCJhbGljZUBleGFtcGxlLmNvbVwiLCBwb3N0cy5maWx0ZXIoKHApID0+IHAuYXV0aG9yLmlkID09PSAxKSksXG4gICAgICBuZXcgVXNlcigyLCBcIkJvYlwiLCBcImJvYkB0ZXN0LmNvbVwiLCBwb3N0cy5maWx0ZXIoKHApID0+IHAuYXV0aG9yLmlkID09PSAyKSksXG4gICAgXSxcbiAgfSxcbn07XG5cblxuZXhwb3J0IGNvbnN0IGNvbmZpZzogUHlsb25Db25maWcgPSB7XG4gIHBsdWdpbnM6IFtcbiAgICAvLyB1c2VBdXRoKHtcbiAgICAvLyAgIGlzc3VlcjogJ2h0dHBzOi8vYWNjb3VudHMyLmNyb25pdC5pbydcbiAgICAvLyB9KSxcbiAgICB1c2VQYWdlcyh7fSlcbiAgXVxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJ0eXBlIFF1ZXJ5IHtcXG5wb3N0czogW1Bvc3QhXSFcXG51c2VyczogW1VzZXIhXSFcXG59XFxudHlwZSBQb3N0IHtcXG5pZDogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxuY29udGVudDogU3RyaW5nIVxcbmF1dGhvcjogQXV0aG9yIVxcbnRhZ3M6IFtTdHJpbmchXSFcXG59XFxudHlwZSBBdXRob3Ige1xcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmVtYWlsOiBTdHJpbmchXFxufVxcbnR5cGUgVXNlciB7XFxuaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuZW1haWw6IFN0cmluZyFcXG5wb3N0czogW1Bvc3QhXSFcXG59XFxuc2NhbGFyIElEXFxuc2NhbGFyIEludFxcbnNjYWxhciBGbG9hdFxcbnNjYWxhciBOdW1iZXJcXG5zY2FsYXIgQW55XFxuc2NhbGFyIFZvaWRcXG5zY2FsYXIgT2JqZWN0XFxuc2NhbGFyIEZpbGVcXG5zY2FsYXIgRGF0ZVxcbnNjYWxhciBKU09OXFxuc2NhbGFyIFN0cmluZ1xcbnNjYWxhciBCb29sZWFuXFxuXCIsXG4gICAgICAgIGdyYXBocWwsXG4gICAgICAgIHJlc29sdmVyczoge30sXG4gICAgICAgIGNvbmZpZzogX19pbnRlcm5hbFB5bG9uQ29uZmlnXG4gICAgICB9KSlcbiAgICAgICJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFRLEtBQWlDLGdCQUFlO0FBbUVsRCxTQUFRLFdBQVcsOEJBQTZCO0FBaEV0RCxJQUFNLFNBQU4sTUFBYTtBQUFBLEVBQ1gsWUFBbUIsSUFBbUIsTUFBcUIsT0FBZTtBQUF2RDtBQUFtQjtBQUFxQjtBQUFBLEVBQWdCO0FBQzdFO0FBRUEsSUFBTSxPQUFOLE1BQVc7QUFBQSxFQUNULFlBQ1MsSUFDQSxPQUNBLFNBQ0EsUUFDQSxNQUNQO0FBTE87QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUFBLEVBQ047QUFDTDtBQUVBLElBQU0sT0FBTixNQUFXO0FBQUEsRUFDVCxZQUNTLElBQ0EsTUFDQSxPQUNBQSxRQUNQO0FBSk87QUFDQTtBQUNBO0FBQ0EsaUJBQUFBO0FBQUEsRUFDTjtBQUNMO0FBR0EsSUFBTSxVQUFVO0FBQUEsRUFDZCxHQUFHLElBQUksT0FBTyxHQUFHLFNBQVMsbUJBQW1CO0FBQUEsRUFDN0MsR0FBRyxJQUFJLE9BQU8sR0FBRyxPQUFPLGlCQUFpQjtBQUFBLEVBQ3pDLEdBQUcsSUFBSSxPQUFPLEdBQUcsV0FBVyxxQkFBcUI7QUFDbkQ7QUFFQSxJQUFNLFFBQVE7QUFBQSxFQUNaLElBQUksS0FBSyxHQUFHLE9BQU8sMENBQTBDLFFBQVEsQ0FBQyxHQUFHO0FBQUEsSUFDdkU7QUFBQSxJQUNBO0FBQUEsRUFDRixDQUFDO0FBQUEsRUFDRCxJQUFJLEtBQUssR0FBRyxPQUFPLDJDQUEyQyxRQUFRLENBQUMsR0FBRztBQUFBLElBQ3hFO0FBQUEsSUFDQTtBQUFBLEVBQ0YsQ0FBQztBQUNIO0FBSU8sSUFBTSxVQUFVO0FBQUEsRUFDckIsT0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBLE9BQVE7QUFBQSxNQUFDLElBQUksS0FBSyxHQUFHLFNBQVMscUJBQXFCLE1BQU0sT0FBTyxDQUFDLE1BQU0sRUFBRSxPQUFPLE9BQU8sQ0FBQyxDQUFDO0FBQUEsTUFDdkYsSUFBSSxLQUFLLEdBQUcsT0FBTyxnQkFBZ0IsTUFBTSxPQUFPLENBQUMsTUFBTSxFQUFFLE9BQU8sT0FBTyxDQUFDLENBQUM7QUFBQSxJQUMzRTtBQUFBLEVBQ0Y7QUFDRjtBQUdPLElBQU0sU0FBc0I7QUFBQSxFQUNqQyxTQUFTO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFJUCxTQUFTLENBQUMsQ0FBQztBQUFBLEVBQ2I7QUFDRjtBQUVBLElBQU8sZ0JBQVE7QUFJVCxJQUFJLHdCQUF3QjtBQUU1QixJQUFJO0FBQ0YsMEJBQXdCO0FBQzFCLFFBQVE7QUFFUjtBQUVBLElBQUksSUFBSSx1QkFBdUI7QUFBQSxFQUM3QixVQUFVO0FBQUEsRUFDVjtBQUFBLEVBQ0EsV0FBVyxDQUFDO0FBQUEsRUFDWixRQUFRO0FBQ1YsQ0FBQyxDQUFDOyIsCiAgIm5hbWVzIjogWyJwb3N0cyJdCn0K
