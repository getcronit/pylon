import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {useDataStaticAnalyzer} from './index'
const tempDir = path.join(__dirname, 'temp_tests')
describe('Esbuild useDataStaticAnalyzer', () => {
  beforeAll(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir)
  })
  afterAll(() => {
    if (fs.existsSync(tempDir))
      fs.rmSync(tempDir, {recursive: true, force: true})
  })
  it('should securely inject selectors into empty useData calls', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const data = useData();
        console.log(data.post.title);
      }
    `
    const filePath = path.join(tempDir, 'testA.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/testA.tsx
      import { useData } from "@getcronit/pylon-pages";
      function Component() {
        const data = useData({
          prepare: ({ query }) => {
            query?.post?.title;
          }
        });
        console.log(data.post.title);
      }
      export {
        Component
      };
      "
    `)
  })
  it('should securely inject selectors into useData calls with existing config arguments', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const data = useData({ foo: "bar" });
        console.log(data.author.name);
      }
    `
    const filePath = path.join(tempDir, 'testB.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/testB.tsx
      import { useData } from "@getcronit/pylon-pages";
      function Component() {
        const data = useData({
          prepare: ({ query }) => {
            query?.author?.name;
          },
          foo: "bar"
        });
        console.log(data.author.name);
      }
      export {
        Component
      };
      "
    `)
  })
  it('should translate deep array mappings with arguments dynamically at build-time', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const data = useData();
        return data.friends({ limit: 10, offset: 20 }).map(friend => {
           return friend.profile.username;
        });
      }
    `
    const filePath = path.join(tempDir, 'testC.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/testC.tsx
      import { useData } from "@getcronit/pylon-pages";
      function Component() {
        const data = useData({
          prepare: ({ query }) => {
            query?.friends?.({ limit: 10, offset: 20 })?.map((i1) => {
              i1?.profile?.username;
            });
          }
        });
        return data.friends({ limit: 10, offset: 20 }).map((friend) => {
          return friend.profile.username;
        });
      }
      export {
        Component
      };
      "
    `)
  })
  it('should handle extremely complex multi-root and deeply nested array mappings', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const data = useData();
        console.log(data.me.id);
        console.log(data.me.settings.theme);
        data.users({ active: true }).map(user => {
           console.log(user.status);
           user.posts.map(post => {
              console.log(post.title);
              post.comments({ sort: "desc" }).map(comment => {
                 console.log(comment.body);
              });
           });
        });
      }
    `
    const filePath = path.join(tempDir, 'testD.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages']
    })
    const outputCode = result.outputFiles[0].text
    // The exact AST generated map backwards:
    // query.me.id;
    // query.me.settings.theme;
    // query.users({ active: true }).map((i1) => { i1.status; i1.posts.map((i2) => { i2.title; i2.comments({ sort: "desc" }).map((i3) => { i3.body; }); }); });
    const expected =
      'useData({prepare:({query})=>{query?.me?.id;query?.me?.settings?.theme;query?.users?.({active:true})?.map((i1)=>{i1?.status;i1?.posts?.map((i2)=>{i2?.title;i2?.comments?.({sort:"desc"})?.map((i3)=>{i3?.body;});});});}})'
  })
  it('should preserve locally scoped variables in injected selectors natively', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const myFetchLimit = 50;
        const data = useData();
        return data.friends({ limit: myFetchLimit }).map(friend => {
           return friend.profile.username;
        });
      }
    `
    const filePath = path.join(tempDir, 'testE.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/testE.tsx
      import { useData } from "@getcronit/pylon-pages";
      function Component() {
        const myFetchLimit = 50;
        const data = useData({
          prepare: ({ query }) => {
            query?.friends?.({ limit: myFetchLimit })?.map((i1) => {
              i1?.profile?.username;
            });
          }
        });
        return data.friends({ limit: myFetchLimit }).map((friend) => {
          return friend.profile.username;
        });
      }
      export {
        Component
      };
      "
    `)
  })
  it('should flawlessly preserve React State variables for dynamic requests', async () => {
    const inputCode = `
      import { useState } from "react";
      import { useData } from "@getcronit/pylon-pages";
      export function Component() {
        const [pageOffset, setPageOffset] = useState(0);
        const data = useData();
        return data.feed({ offset: pageOffset, limit: 10 }).map(item => {
           return item.title;
        });
      }
    `
    const filePath = path.join(tempDir, 'testF.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/testF.tsx
      import { useState } from "react";
      import { useData } from "@getcronit/pylon-pages";
      function Component() {
        const [pageOffset, setPageOffset] = useState(0);
        const data = useData({
          prepare: ({ query }) => {
            query?.feed?.({ offset: pageOffset, limit: 10 })?.map((i1) => {
              i1?.title;
            });
          }
        });
        return data.feed({ offset: pageOffset, limit: 10 }).map((item) => {
          return item.title;
        });
      }
      export {
        Component
      };
      "
    `)
  })
  it('should handle dynamic function calls with primitives in JSX (dyno case)', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Component({ input }) {
        const data = useData();
        return <p>{data.dyno({input})}</p>;
      }
    `
    const filePath = path.join(tempDir, 'test_dyno.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "var __create = Object.create;
      var __defProp = Object.defineProperty;
      var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
      var __getOwnPropNames = Object.getOwnPropertyNames;
      var __getProtoOf = Object.getPrototypeOf;
      var __hasOwnProp = Object.prototype.hasOwnProperty;
      var __commonJS = (cb, mod) => function __require() {
        return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
      };
      var __copyProps = (to, from, except, desc) => {
        if (from && typeof from === "object" || typeof from === "function") {
          for (let key of __getOwnPropNames(from))
            if (!__hasOwnProp.call(to, key) && key !== except)
              __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
        }
        return to;
      };
      var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
        // If the importer is in node compatibility mode or this is not an ESM
        // file that has been converted to a CommonJS file using a Babel-
        // compatible transform (i.e. "__esModule" has not been set), then set
        // "default" to the CommonJS "module.exports" for node compatibility.
        isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
        mod
      ));

      // ../../node_modules/.pnpm/react@19.1.2/node_modules/react/cjs/react.development.js
      var require_react_development = __commonJS({
        "../../node_modules/.pnpm/react@19.1.2/node_modules/react/cjs/react.development.js"(exports, module) {
          "use strict";
          (function() {
            function defineDeprecationWarning(methodName, info) {
              Object.defineProperty(Component2.prototype, methodName, {
                get: function() {
                  console.warn(
                    "%s(...) is deprecated in plain JavaScript React classes. %s",
                    info[0],
                    info[1]
                  );
                }
              });
            }
            function getIteratorFn(maybeIterable) {
              if (null === maybeIterable || "object" !== typeof maybeIterable)
                return null;
              maybeIterable = MAYBE_ITERATOR_SYMBOL && maybeIterable[MAYBE_ITERATOR_SYMBOL] || maybeIterable["@@iterator"];
              return "function" === typeof maybeIterable ? maybeIterable : null;
            }
            function warnNoop(publicInstance, callerName) {
              publicInstance = (publicInstance = publicInstance.constructor) && (publicInstance.displayName || publicInstance.name) || "ReactClass";
              var warningKey = publicInstance + "." + callerName;
              didWarnStateUpdateForUnmountedComponent[warningKey] || (console.error(
                "Can't call %s on a component that is not yet mounted. This is a no-op, but it might indicate a bug in your application. Instead, assign to \`this.state\` directly or define a \`state = {};\` class property with the desired state in the %s component.",
                callerName,
                publicInstance
              ), didWarnStateUpdateForUnmountedComponent[warningKey] = true);
            }
            function Component2(props, context, updater) {
              this.props = props;
              this.context = context;
              this.refs = emptyObject;
              this.updater = updater || ReactNoopUpdateQueue;
            }
            function ComponentDummy() {
            }
            function PureComponent(props, context, updater) {
              this.props = props;
              this.context = context;
              this.refs = emptyObject;
              this.updater = updater || ReactNoopUpdateQueue;
            }
            function testStringCoercion(value) {
              return "" + value;
            }
            function checkKeyStringCoercion(value) {
              try {
                testStringCoercion(value);
                var JSCompiler_inline_result = false;
              } catch (e) {
                JSCompiler_inline_result = true;
              }
              if (JSCompiler_inline_result) {
                JSCompiler_inline_result = console;
                var JSCompiler_temp_const = JSCompiler_inline_result.error;
                var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
                JSCompiler_temp_const.call(
                  JSCompiler_inline_result,
                  "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
                  JSCompiler_inline_result$jscomp$0
                );
                return testStringCoercion(value);
              }
            }
            function getComponentNameFromType(type) {
              if (null == type) return null;
              if ("function" === typeof type)
                return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
              if ("string" === typeof type) return type;
              switch (type) {
                case REACT_FRAGMENT_TYPE:
                  return "Fragment";
                case REACT_PROFILER_TYPE:
                  return "Profiler";
                case REACT_STRICT_MODE_TYPE:
                  return "StrictMode";
                case REACT_SUSPENSE_TYPE:
                  return "Suspense";
                case REACT_SUSPENSE_LIST_TYPE:
                  return "SuspenseList";
                case REACT_ACTIVITY_TYPE:
                  return "Activity";
              }
              if ("object" === typeof type)
                switch ("number" === typeof type.tag && console.error(
                  "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
                ), type.$$typeof) {
                  case REACT_PORTAL_TYPE:
                    return "Portal";
                  case REACT_CONTEXT_TYPE:
                    return (type.displayName || "Context") + ".Provider";
                  case REACT_CONSUMER_TYPE:
                    return (type._context.displayName || "Context") + ".Consumer";
                  case REACT_FORWARD_REF_TYPE:
                    var innerType = type.render;
                    type = type.displayName;
                    type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
                    return type;
                  case REACT_MEMO_TYPE:
                    return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
                  case REACT_LAZY_TYPE:
                    innerType = type._payload;
                    type = type._init;
                    try {
                      return getComponentNameFromType(type(innerType));
                    } catch (x) {
                    }
                }
              return null;
            }
            function getTaskName(type) {
              if (type === REACT_FRAGMENT_TYPE) return "<>";
              if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE)
                return "<...>";
              try {
                var name = getComponentNameFromType(type);
                return name ? "<" + name + ">" : "<...>";
              } catch (x) {
                return "<...>";
              }
            }
            function getOwner() {
              var dispatcher = ReactSharedInternals.A;
              return null === dispatcher ? null : dispatcher.getOwner();
            }
            function UnknownOwner() {
              return Error("react-stack-top-frame");
            }
            function hasValidKey(config) {
              if (hasOwnProperty.call(config, "key")) {
                var getter = Object.getOwnPropertyDescriptor(config, "key").get;
                if (getter && getter.isReactWarning) return false;
              }
              return void 0 !== config.key;
            }
            function defineKeyPropWarningGetter(props, displayName) {
              function warnAboutAccessingKey() {
                specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
                  "%s: \`key\` is not a prop. Trying to access it will result in \`undefined\` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
                  displayName
                ));
              }
              warnAboutAccessingKey.isReactWarning = true;
              Object.defineProperty(props, "key", {
                get: warnAboutAccessingKey,
                configurable: true
              });
            }
            function elementRefGetterWithDeprecationWarning() {
              var componentName = getComponentNameFromType(this.type);
              didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
                "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
              ));
              componentName = this.props.ref;
              return void 0 !== componentName ? componentName : null;
            }
            function ReactElement(type, key, self, source, owner, props, debugStack, debugTask) {
              self = props.ref;
              type = {
                $$typeof: REACT_ELEMENT_TYPE,
                type,
                key,
                props,
                _owner: owner
              };
              null !== (void 0 !== self ? self : null) ? Object.defineProperty(type, "ref", {
                enumerable: false,
                get: elementRefGetterWithDeprecationWarning
              }) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
              type._store = {};
              Object.defineProperty(type._store, "validated", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: 0
              });
              Object.defineProperty(type, "_debugInfo", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: null
              });
              Object.defineProperty(type, "_debugStack", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: debugStack
              });
              Object.defineProperty(type, "_debugTask", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: debugTask
              });
              Object.freeze && (Object.freeze(type.props), Object.freeze(type));
              return type;
            }
            function cloneAndReplaceKey(oldElement, newKey) {
              newKey = ReactElement(
                oldElement.type,
                newKey,
                void 0,
                void 0,
                oldElement._owner,
                oldElement.props,
                oldElement._debugStack,
                oldElement._debugTask
              );
              oldElement._store && (newKey._store.validated = oldElement._store.validated);
              return newKey;
            }
            function isValidElement(object) {
              return "object" === typeof object && null !== object && object.$$typeof === REACT_ELEMENT_TYPE;
            }
            function escape(key) {
              var escaperLookup = { "=": "=0", ":": "=2" };
              return "$" + key.replace(/[=:]/g, function(match) {
                return escaperLookup[match];
              });
            }
            function getElementKey(element, index) {
              return "object" === typeof element && null !== element && null != element.key ? (checkKeyStringCoercion(element.key), escape("" + element.key)) : index.toString(36);
            }
            function noop$1() {
            }
            function resolveThenable(thenable) {
              switch (thenable.status) {
                case "fulfilled":
                  return thenable.value;
                case "rejected":
                  throw thenable.reason;
                default:
                  switch ("string" === typeof thenable.status ? thenable.then(noop$1, noop$1) : (thenable.status = "pending", thenable.then(
                    function(fulfilledValue) {
                      "pending" === thenable.status && (thenable.status = "fulfilled", thenable.value = fulfilledValue);
                    },
                    function(error) {
                      "pending" === thenable.status && (thenable.status = "rejected", thenable.reason = error);
                    }
                  )), thenable.status) {
                    case "fulfilled":
                      return thenable.value;
                    case "rejected":
                      throw thenable.reason;
                  }
              }
              throw thenable;
            }
            function mapIntoArray(children, array, escapedPrefix, nameSoFar, callback) {
              var type = typeof children;
              if ("undefined" === type || "boolean" === type) children = null;
              var invokeCallback = false;
              if (null === children) invokeCallback = true;
              else
                switch (type) {
                  case "bigint":
                  case "string":
                  case "number":
                    invokeCallback = true;
                    break;
                  case "object":
                    switch (children.$$typeof) {
                      case REACT_ELEMENT_TYPE:
                      case REACT_PORTAL_TYPE:
                        invokeCallback = true;
                        break;
                      case REACT_LAZY_TYPE:
                        return invokeCallback = children._init, mapIntoArray(
                          invokeCallback(children._payload),
                          array,
                          escapedPrefix,
                          nameSoFar,
                          callback
                        );
                    }
                }
              if (invokeCallback) {
                invokeCallback = children;
                callback = callback(invokeCallback);
                var childKey = "" === nameSoFar ? "." + getElementKey(invokeCallback, 0) : nameSoFar;
                isArrayImpl(callback) ? (escapedPrefix = "", null != childKey && (escapedPrefix = childKey.replace(userProvidedKeyEscapeRegex, "$&/") + "/"), mapIntoArray(callback, array, escapedPrefix, "", function(c) {
                  return c;
                })) : null != callback && (isValidElement(callback) && (null != callback.key && (invokeCallback && invokeCallback.key === callback.key || checkKeyStringCoercion(callback.key)), escapedPrefix = cloneAndReplaceKey(
                  callback,
                  escapedPrefix + (null == callback.key || invokeCallback && invokeCallback.key === callback.key ? "" : ("" + callback.key).replace(
                    userProvidedKeyEscapeRegex,
                    "$&/"
                  ) + "/") + childKey
                ), "" !== nameSoFar && null != invokeCallback && isValidElement(invokeCallback) && null == invokeCallback.key && invokeCallback._store && !invokeCallback._store.validated && (escapedPrefix._store.validated = 2), callback = escapedPrefix), array.push(callback));
                return 1;
              }
              invokeCallback = 0;
              childKey = "" === nameSoFar ? "." : nameSoFar + ":";
              if (isArrayImpl(children))
                for (var i = 0; i < children.length; i++)
                  nameSoFar = children[i], type = childKey + getElementKey(nameSoFar, i), invokeCallback += mapIntoArray(
                    nameSoFar,
                    array,
                    escapedPrefix,
                    type,
                    callback
                  );
              else if (i = getIteratorFn(children), "function" === typeof i)
                for (i === children.entries && (didWarnAboutMaps || console.warn(
                  "Using Maps as children is not supported. Use an array of keyed ReactElements instead."
                ), didWarnAboutMaps = true), children = i.call(children), i = 0; !(nameSoFar = children.next()).done; )
                  nameSoFar = nameSoFar.value, type = childKey + getElementKey(nameSoFar, i++), invokeCallback += mapIntoArray(
                    nameSoFar,
                    array,
                    escapedPrefix,
                    type,
                    callback
                  );
              else if ("object" === type) {
                if ("function" === typeof children.then)
                  return mapIntoArray(
                    resolveThenable(children),
                    array,
                    escapedPrefix,
                    nameSoFar,
                    callback
                  );
                array = String(children);
                throw Error(
                  "Objects are not valid as a React child (found: " + ("[object Object]" === array ? "object with keys {" + Object.keys(children).join(", ") + "}" : array) + "). If you meant to render a collection of children, use an array instead."
                );
              }
              return invokeCallback;
            }
            function mapChildren(children, func, context) {
              if (null == children) return children;
              var result = [], count = 0;
              mapIntoArray(children, result, "", "", function(child) {
                return func.call(context, child, count++);
              });
              return result;
            }
            function lazyInitializer(payload) {
              if (-1 === payload._status) {
                var ctor = payload._result;
                ctor = ctor();
                ctor.then(
                  function(moduleObject) {
                    if (0 === payload._status || -1 === payload._status)
                      payload._status = 1, payload._result = moduleObject;
                  },
                  function(error) {
                    if (0 === payload._status || -1 === payload._status)
                      payload._status = 2, payload._result = error;
                  }
                );
                -1 === payload._status && (payload._status = 0, payload._result = ctor);
              }
              if (1 === payload._status)
                return ctor = payload._result, void 0 === ctor && console.error(
                  "lazy: Expected the result of a dynamic import() call. Instead received: %s\\n\\nYour code should look like: \\n  const MyComponent = lazy(() => import('./MyComponent'))\\n\\nDid you accidentally put curly braces around the import?",
                  ctor
                ), "default" in ctor || console.error(
                  "lazy: Expected the result of a dynamic import() call. Instead received: %s\\n\\nYour code should look like: \\n  const MyComponent = lazy(() => import('./MyComponent'))",
                  ctor
                ), ctor.default;
              throw payload._result;
            }
            function resolveDispatcher() {
              var dispatcher = ReactSharedInternals.H;
              null === dispatcher && console.error(
                "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for one of the following reasons:\\n1. You might have mismatching versions of React and the renderer (such as React DOM)\\n2. You might be breaking the Rules of Hooks\\n3. You might have more than one copy of React in the same app\\nSee https://react.dev/link/invalid-hook-call for tips about how to debug and fix this problem."
              );
              return dispatcher;
            }
            function noop() {
            }
            function enqueueTask(task) {
              if (null === enqueueTaskImpl)
                try {
                  var requireString = ("require" + Math.random()).slice(0, 7);
                  enqueueTaskImpl = (module && module[requireString]).call(
                    module,
                    "timers"
                  ).setImmediate;
                } catch (_err) {
                  enqueueTaskImpl = function(callback) {
                    false === didWarnAboutMessageChannel && (didWarnAboutMessageChannel = true, "undefined" === typeof MessageChannel && console.error(
                      "This browser does not have a MessageChannel implementation, so enqueuing tasks via await act(async () => ...) will fail. Please file an issue at https://github.com/facebook/react/issues if you encounter this warning."
                    ));
                    var channel = new MessageChannel();
                    channel.port1.onmessage = callback;
                    channel.port2.postMessage(void 0);
                  };
                }
              return enqueueTaskImpl(task);
            }
            function aggregateErrors(errors) {
              return 1 < errors.length && "function" === typeof AggregateError ? new AggregateError(errors) : errors[0];
            }
            function popActScope(prevActQueue, prevActScopeDepth) {
              prevActScopeDepth !== actScopeDepth - 1 && console.error(
                "You seem to have overlapping act() calls, this is not supported. Be sure to await previous act() calls before making a new one. "
              );
              actScopeDepth = prevActScopeDepth;
            }
            function recursivelyFlushAsyncActWork(returnValue, resolve, reject) {
              var queue = ReactSharedInternals.actQueue;
              if (null !== queue)
                if (0 !== queue.length)
                  try {
                    flushActQueue(queue);
                    enqueueTask(function() {
                      return recursivelyFlushAsyncActWork(returnValue, resolve, reject);
                    });
                    return;
                  } catch (error) {
                    ReactSharedInternals.thrownErrors.push(error);
                  }
                else ReactSharedInternals.actQueue = null;
              0 < ReactSharedInternals.thrownErrors.length ? (queue = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, reject(queue)) : resolve(returnValue);
            }
            function flushActQueue(queue) {
              if (!isFlushing) {
                isFlushing = true;
                var i = 0;
                try {
                  for (; i < queue.length; i++) {
                    var callback = queue[i];
                    do {
                      ReactSharedInternals.didUsePromise = false;
                      var continuation = callback(false);
                      if (null !== continuation) {
                        if (ReactSharedInternals.didUsePromise) {
                          queue[i] = callback;
                          queue.splice(0, i);
                          return;
                        }
                        callback = continuation;
                      } else break;
                    } while (1);
                  }
                  queue.length = 0;
                } catch (error) {
                  queue.splice(0, i + 1), ReactSharedInternals.thrownErrors.push(error);
                } finally {
                  isFlushing = false;
                }
              }
            }
            "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
            var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = Symbol.for("react.profiler");
            Symbol.for("react.provider");
            var REACT_CONSUMER_TYPE = Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = Symbol.for("react.memo"), REACT_LAZY_TYPE = Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = Symbol.for("react.activity"), MAYBE_ITERATOR_SYMBOL = Symbol.iterator, didWarnStateUpdateForUnmountedComponent = {}, ReactNoopUpdateQueue = {
              isMounted: function() {
                return false;
              },
              enqueueForceUpdate: function(publicInstance) {
                warnNoop(publicInstance, "forceUpdate");
              },
              enqueueReplaceState: function(publicInstance) {
                warnNoop(publicInstance, "replaceState");
              },
              enqueueSetState: function(publicInstance) {
                warnNoop(publicInstance, "setState");
              }
            }, assign = Object.assign, emptyObject = {};
            Object.freeze(emptyObject);
            Component2.prototype.isReactComponent = {};
            Component2.prototype.setState = function(partialState, callback) {
              if ("object" !== typeof partialState && "function" !== typeof partialState && null != partialState)
                throw Error(
                  "takes an object of state variables to update or a function which returns an object of state variables."
                );
              this.updater.enqueueSetState(this, partialState, callback, "setState");
            };
            Component2.prototype.forceUpdate = function(callback) {
              this.updater.enqueueForceUpdate(this, callback, "forceUpdate");
            };
            var deprecatedAPIs = {
              isMounted: [
                "isMounted",
                "Instead, make sure to clean up subscriptions and pending requests in componentWillUnmount to prevent memory leaks."
              ],
              replaceState: [
                "replaceState",
                "Refactor your code to use setState instead (see https://github.com/facebook/react/issues/3236)."
              ]
            }, fnName;
            for (fnName in deprecatedAPIs)
              deprecatedAPIs.hasOwnProperty(fnName) && defineDeprecationWarning(fnName, deprecatedAPIs[fnName]);
            ComponentDummy.prototype = Component2.prototype;
            deprecatedAPIs = PureComponent.prototype = new ComponentDummy();
            deprecatedAPIs.constructor = PureComponent;
            assign(deprecatedAPIs, Component2.prototype);
            deprecatedAPIs.isPureReactComponent = true;
            var isArrayImpl = Array.isArray, REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"), ReactSharedInternals = {
              H: null,
              A: null,
              T: null,
              S: null,
              V: null,
              actQueue: null,
              isBatchingLegacy: false,
              didScheduleLegacyUpdate: false,
              didUsePromise: false,
              thrownErrors: [],
              getCurrentStack: null,
              recentlyCreatedOwnerStacks: 0
            }, hasOwnProperty = Object.prototype.hasOwnProperty, createTask = console.createTask ? console.createTask : function() {
              return null;
            };
            deprecatedAPIs = {
              react_stack_bottom_frame: function(callStackForError) {
                return callStackForError();
              }
            };
            var specialPropKeyWarningShown, didWarnAboutOldJSXRuntime;
            var didWarnAboutElementRef = {};
            var unknownOwnerDebugStack = deprecatedAPIs.react_stack_bottom_frame.bind(
              deprecatedAPIs,
              UnknownOwner
            )();
            var unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
            var didWarnAboutMaps = false, userProvidedKeyEscapeRegex = /\\/+/g, reportGlobalError = "function" === typeof reportError ? reportError : function(error) {
              if ("object" === typeof window && "function" === typeof window.ErrorEvent) {
                var event = new window.ErrorEvent("error", {
                  bubbles: true,
                  cancelable: true,
                  message: "object" === typeof error && null !== error && "string" === typeof error.message ? String(error.message) : String(error),
                  error
                });
                if (!window.dispatchEvent(event)) return;
              } else if ("object" === typeof process && "function" === typeof process.emit) {
                process.emit("uncaughtException", error);
                return;
              }
              console.error(error);
            }, didWarnAboutMessageChannel = false, enqueueTaskImpl = null, actScopeDepth = 0, didWarnNoAwaitAct = false, isFlushing = false, queueSeveralMicrotasks = "function" === typeof queueMicrotask ? function(callback) {
              queueMicrotask(function() {
                return queueMicrotask(callback);
              });
            } : enqueueTask;
            deprecatedAPIs = Object.freeze({
              __proto__: null,
              c: function(size) {
                return resolveDispatcher().useMemoCache(size);
              }
            });
            exports.Children = {
              map: mapChildren,
              forEach: function(children, forEachFunc, forEachContext) {
                mapChildren(
                  children,
                  function() {
                    forEachFunc.apply(this, arguments);
                  },
                  forEachContext
                );
              },
              count: function(children) {
                var n = 0;
                mapChildren(children, function() {
                  n++;
                });
                return n;
              },
              toArray: function(children) {
                return mapChildren(children, function(child) {
                  return child;
                }) || [];
              },
              only: function(children) {
                if (!isValidElement(children))
                  throw Error(
                    "React.Children.only expected to receive a single React element child."
                  );
                return children;
              }
            };
            exports.Component = Component2;
            exports.Fragment = REACT_FRAGMENT_TYPE;
            exports.Profiler = REACT_PROFILER_TYPE;
            exports.PureComponent = PureComponent;
            exports.StrictMode = REACT_STRICT_MODE_TYPE;
            exports.Suspense = REACT_SUSPENSE_TYPE;
            exports.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = ReactSharedInternals;
            exports.__COMPILER_RUNTIME = deprecatedAPIs;
            exports.act = function(callback) {
              var prevActQueue = ReactSharedInternals.actQueue, prevActScopeDepth = actScopeDepth;
              actScopeDepth++;
              var queue = ReactSharedInternals.actQueue = null !== prevActQueue ? prevActQueue : [], didAwaitActCall = false;
              try {
                var result = callback();
              } catch (error) {
                ReactSharedInternals.thrownErrors.push(error);
              }
              if (0 < ReactSharedInternals.thrownErrors.length)
                throw popActScope(prevActQueue, prevActScopeDepth), callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
              if (null !== result && "object" === typeof result && "function" === typeof result.then) {
                var thenable = result;
                queueSeveralMicrotasks(function() {
                  didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
                    "You called act(async () => ...) without await. This could lead to unexpected testing behaviour, interleaving multiple act calls and mixing their scopes. You should - await act(async () => ...);"
                  ));
                });
                return {
                  then: function(resolve, reject) {
                    didAwaitActCall = true;
                    thenable.then(
                      function(returnValue) {
                        popActScope(prevActQueue, prevActScopeDepth);
                        if (0 === prevActScopeDepth) {
                          try {
                            flushActQueue(queue), enqueueTask(function() {
                              return recursivelyFlushAsyncActWork(
                                returnValue,
                                resolve,
                                reject
                              );
                            });
                          } catch (error$0) {
                            ReactSharedInternals.thrownErrors.push(error$0);
                          }
                          if (0 < ReactSharedInternals.thrownErrors.length) {
                            var _thrownError = aggregateErrors(
                              ReactSharedInternals.thrownErrors
                            );
                            ReactSharedInternals.thrownErrors.length = 0;
                            reject(_thrownError);
                          }
                        } else resolve(returnValue);
                      },
                      function(error) {
                        popActScope(prevActQueue, prevActScopeDepth);
                        0 < ReactSharedInternals.thrownErrors.length ? (error = aggregateErrors(
                          ReactSharedInternals.thrownErrors
                        ), ReactSharedInternals.thrownErrors.length = 0, reject(error)) : reject(error);
                      }
                    );
                  }
                };
              }
              var returnValue$jscomp$0 = result;
              popActScope(prevActQueue, prevActScopeDepth);
              0 === prevActScopeDepth && (flushActQueue(queue), 0 !== queue.length && queueSeveralMicrotasks(function() {
                didAwaitActCall || didWarnNoAwaitAct || (didWarnNoAwaitAct = true, console.error(
                  "A component suspended inside an \`act\` scope, but the \`act\` call was not awaited. When testing React components that depend on asynchronous data, you must await the result:\\n\\nawait act(() => ...)"
                ));
              }), ReactSharedInternals.actQueue = null);
              if (0 < ReactSharedInternals.thrownErrors.length)
                throw callback = aggregateErrors(ReactSharedInternals.thrownErrors), ReactSharedInternals.thrownErrors.length = 0, callback;
              return {
                then: function(resolve, reject) {
                  didAwaitActCall = true;
                  0 === prevActScopeDepth ? (ReactSharedInternals.actQueue = queue, enqueueTask(function() {
                    return recursivelyFlushAsyncActWork(
                      returnValue$jscomp$0,
                      resolve,
                      reject
                    );
                  })) : resolve(returnValue$jscomp$0);
                }
              };
            };
            exports.cache = function(fn) {
              return function() {
                return fn.apply(null, arguments);
              };
            };
            exports.captureOwnerStack = function() {
              var getCurrentStack = ReactSharedInternals.getCurrentStack;
              return null === getCurrentStack ? null : getCurrentStack();
            };
            exports.cloneElement = function(element, config, children) {
              if (null === element || void 0 === element)
                throw Error(
                  "The argument must be a React element, but you passed " + element + "."
                );
              var props = assign({}, element.props), key = element.key, owner = element._owner;
              if (null != config) {
                var JSCompiler_inline_result;
                a: {
                  if (hasOwnProperty.call(config, "ref") && (JSCompiler_inline_result = Object.getOwnPropertyDescriptor(
                    config,
                    "ref"
                  ).get) && JSCompiler_inline_result.isReactWarning) {
                    JSCompiler_inline_result = false;
                    break a;
                  }
                  JSCompiler_inline_result = void 0 !== config.ref;
                }
                JSCompiler_inline_result && (owner = getOwner());
                hasValidKey(config) && (checkKeyStringCoercion(config.key), key = "" + config.key);
                for (propName in config)
                  !hasOwnProperty.call(config, propName) || "key" === propName || "__self" === propName || "__source" === propName || "ref" === propName && void 0 === config.ref || (props[propName] = config[propName]);
              }
              var propName = arguments.length - 2;
              if (1 === propName) props.children = children;
              else if (1 < propName) {
                JSCompiler_inline_result = Array(propName);
                for (var i = 0; i < propName; i++)
                  JSCompiler_inline_result[i] = arguments[i + 2];
                props.children = JSCompiler_inline_result;
              }
              props = ReactElement(
                element.type,
                key,
                void 0,
                void 0,
                owner,
                props,
                element._debugStack,
                element._debugTask
              );
              for (key = 2; key < arguments.length; key++)
                owner = arguments[key], isValidElement(owner) && owner._store && (owner._store.validated = 1);
              return props;
            };
            exports.createContext = function(defaultValue) {
              defaultValue = {
                $$typeof: REACT_CONTEXT_TYPE,
                _currentValue: defaultValue,
                _currentValue2: defaultValue,
                _threadCount: 0,
                Provider: null,
                Consumer: null
              };
              defaultValue.Provider = defaultValue;
              defaultValue.Consumer = {
                $$typeof: REACT_CONSUMER_TYPE,
                _context: defaultValue
              };
              defaultValue._currentRenderer = null;
              defaultValue._currentRenderer2 = null;
              return defaultValue;
            };
            exports.createElement = function(type, config, children) {
              for (var i = 2; i < arguments.length; i++) {
                var node = arguments[i];
                isValidElement(node) && node._store && (node._store.validated = 1);
              }
              i = {};
              node = null;
              if (null != config)
                for (propName in didWarnAboutOldJSXRuntime || !("__self" in config) || "key" in config || (didWarnAboutOldJSXRuntime = true, console.warn(
                  "Your app (or one of its dependencies) is using an outdated JSX transform. Update to the modern JSX transform for faster performance: https://react.dev/link/new-jsx-transform"
                )), hasValidKey(config) && (checkKeyStringCoercion(config.key), node = "" + config.key), config)
                  hasOwnProperty.call(config, propName) && "key" !== propName && "__self" !== propName && "__source" !== propName && (i[propName] = config[propName]);
              var childrenLength = arguments.length - 2;
              if (1 === childrenLength) i.children = children;
              else if (1 < childrenLength) {
                for (var childArray = Array(childrenLength), _i = 0; _i < childrenLength; _i++)
                  childArray[_i] = arguments[_i + 2];
                Object.freeze && Object.freeze(childArray);
                i.children = childArray;
              }
              if (type && type.defaultProps)
                for (propName in childrenLength = type.defaultProps, childrenLength)
                  void 0 === i[propName] && (i[propName] = childrenLength[propName]);
              node && defineKeyPropWarningGetter(
                i,
                "function" === typeof type ? type.displayName || type.name || "Unknown" : type
              );
              var propName = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
              return ReactElement(
                type,
                node,
                void 0,
                void 0,
                getOwner(),
                i,
                propName ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
                propName ? createTask(getTaskName(type)) : unknownOwnerDebugTask
              );
            };
            exports.createRef = function() {
              var refObject = { current: null };
              Object.seal(refObject);
              return refObject;
            };
            exports.forwardRef = function(render) {
              null != render && render.$$typeof === REACT_MEMO_TYPE ? console.error(
                "forwardRef requires a render function but received a \`memo\` component. Instead of forwardRef(memo(...)), use memo(forwardRef(...))."
              ) : "function" !== typeof render ? console.error(
                "forwardRef requires a render function but was given %s.",
                null === render ? "null" : typeof render
              ) : 0 !== render.length && 2 !== render.length && console.error(
                "forwardRef render functions accept exactly two parameters: props and ref. %s",
                1 === render.length ? "Did you forget to use the ref parameter?" : "Any additional parameter will be undefined."
              );
              null != render && null != render.defaultProps && console.error(
                "forwardRef render functions do not support defaultProps. Did you accidentally pass a React component?"
              );
              var elementType = { $$typeof: REACT_FORWARD_REF_TYPE, render }, ownName;
              Object.defineProperty(elementType, "displayName", {
                enumerable: false,
                configurable: true,
                get: function() {
                  return ownName;
                },
                set: function(name) {
                  ownName = name;
                  render.name || render.displayName || (Object.defineProperty(render, "name", { value: name }), render.displayName = name);
                }
              });
              return elementType;
            };
            exports.isValidElement = isValidElement;
            exports.lazy = function(ctor) {
              return {
                $$typeof: REACT_LAZY_TYPE,
                _payload: { _status: -1, _result: ctor },
                _init: lazyInitializer
              };
            };
            exports.memo = function(type, compare) {
              null == type && console.error(
                "memo: The first argument must be a component. Instead received: %s",
                null === type ? "null" : typeof type
              );
              compare = {
                $$typeof: REACT_MEMO_TYPE,
                type,
                compare: void 0 === compare ? null : compare
              };
              var ownName;
              Object.defineProperty(compare, "displayName", {
                enumerable: false,
                configurable: true,
                get: function() {
                  return ownName;
                },
                set: function(name) {
                  ownName = name;
                  type.name || type.displayName || (Object.defineProperty(type, "name", { value: name }), type.displayName = name);
                }
              });
              return compare;
            };
            exports.startTransition = function(scope) {
              var prevTransition = ReactSharedInternals.T, currentTransition = {};
              ReactSharedInternals.T = currentTransition;
              currentTransition._updatedFibers = /* @__PURE__ */ new Set();
              try {
                var returnValue = scope(), onStartTransitionFinish = ReactSharedInternals.S;
                null !== onStartTransitionFinish && onStartTransitionFinish(currentTransition, returnValue);
                "object" === typeof returnValue && null !== returnValue && "function" === typeof returnValue.then && returnValue.then(noop, reportGlobalError);
              } catch (error) {
                reportGlobalError(error);
              } finally {
                null === prevTransition && currentTransition._updatedFibers && (scope = currentTransition._updatedFibers.size, currentTransition._updatedFibers.clear(), 10 < scope && console.warn(
                  "Detected a large number of updates inside startTransition. If this is due to a subscription please re-write it to use React provided hooks. Otherwise concurrent mode guarantees are off the table."
                )), ReactSharedInternals.T = prevTransition;
              }
            };
            exports.unstable_useCacheRefresh = function() {
              return resolveDispatcher().useCacheRefresh();
            };
            exports.use = function(usable) {
              return resolveDispatcher().use(usable);
            };
            exports.useActionState = function(action, initialState, permalink) {
              return resolveDispatcher().useActionState(
                action,
                initialState,
                permalink
              );
            };
            exports.useCallback = function(callback, deps) {
              return resolveDispatcher().useCallback(callback, deps);
            };
            exports.useContext = function(Context) {
              var dispatcher = resolveDispatcher();
              Context.$$typeof === REACT_CONSUMER_TYPE && console.error(
                "Calling useContext(Context.Consumer) is not supported and will cause bugs. Did you mean to call useContext(Context) instead?"
              );
              return dispatcher.useContext(Context);
            };
            exports.useDebugValue = function(value, formatterFn) {
              return resolveDispatcher().useDebugValue(value, formatterFn);
            };
            exports.useDeferredValue = function(value, initialValue) {
              return resolveDispatcher().useDeferredValue(value, initialValue);
            };
            exports.useEffect = function(create, createDeps, update) {
              null == create && console.warn(
                "React Hook useEffect requires an effect callback. Did you forget to pass a callback to the hook?"
              );
              var dispatcher = resolveDispatcher();
              if ("function" === typeof update)
                throw Error(
                  "useEffect CRUD overload is not enabled in this build of React."
                );
              return dispatcher.useEffect(create, createDeps);
            };
            exports.useId = function() {
              return resolveDispatcher().useId();
            };
            exports.useImperativeHandle = function(ref, create, deps) {
              return resolveDispatcher().useImperativeHandle(ref, create, deps);
            };
            exports.useInsertionEffect = function(create, deps) {
              null == create && console.warn(
                "React Hook useInsertionEffect requires an effect callback. Did you forget to pass a callback to the hook?"
              );
              return resolveDispatcher().useInsertionEffect(create, deps);
            };
            exports.useLayoutEffect = function(create, deps) {
              null == create && console.warn(
                "React Hook useLayoutEffect requires an effect callback. Did you forget to pass a callback to the hook?"
              );
              return resolveDispatcher().useLayoutEffect(create, deps);
            };
            exports.useMemo = function(create, deps) {
              return resolveDispatcher().useMemo(create, deps);
            };
            exports.useOptimistic = function(passthrough, reducer) {
              return resolveDispatcher().useOptimistic(passthrough, reducer);
            };
            exports.useReducer = function(reducer, initialArg, init) {
              return resolveDispatcher().useReducer(reducer, initialArg, init);
            };
            exports.useRef = function(initialValue) {
              return resolveDispatcher().useRef(initialValue);
            };
            exports.useState = function(initialState) {
              return resolveDispatcher().useState(initialState);
            };
            exports.useSyncExternalStore = function(subscribe, getSnapshot, getServerSnapshot) {
              return resolveDispatcher().useSyncExternalStore(
                subscribe,
                getSnapshot,
                getServerSnapshot
              );
            };
            exports.useTransition = function() {
              return resolveDispatcher().useTransition();
            };
            exports.version = "19.1.2";
            "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
          })();
        }
      });

      // ../../node_modules/.pnpm/react@19.1.2/node_modules/react/index.js
      var require_react = __commonJS({
        "../../node_modules/.pnpm/react@19.1.2/node_modules/react/index.js"(exports, module) {
          "use strict";
          if (false) {
            module.exports = null;
          } else {
            module.exports = require_react_development();
          }
        }
      });

      // ../../node_modules/.pnpm/react@19.1.2/node_modules/react/cjs/react-jsx-runtime.development.js
      var require_react_jsx_runtime_development = __commonJS({
        "../../node_modules/.pnpm/react@19.1.2/node_modules/react/cjs/react-jsx-runtime.development.js"(exports) {
          "use strict";
          (function() {
            function getComponentNameFromType(type) {
              if (null == type) return null;
              if ("function" === typeof type)
                return type.$$typeof === REACT_CLIENT_REFERENCE ? null : type.displayName || type.name || null;
              if ("string" === typeof type) return type;
              switch (type) {
                case REACT_FRAGMENT_TYPE:
                  return "Fragment";
                case REACT_PROFILER_TYPE:
                  return "Profiler";
                case REACT_STRICT_MODE_TYPE:
                  return "StrictMode";
                case REACT_SUSPENSE_TYPE:
                  return "Suspense";
                case REACT_SUSPENSE_LIST_TYPE:
                  return "SuspenseList";
                case REACT_ACTIVITY_TYPE:
                  return "Activity";
              }
              if ("object" === typeof type)
                switch ("number" === typeof type.tag && console.error(
                  "Received an unexpected object in getComponentNameFromType(). This is likely a bug in React. Please file an issue."
                ), type.$$typeof) {
                  case REACT_PORTAL_TYPE:
                    return "Portal";
                  case REACT_CONTEXT_TYPE:
                    return (type.displayName || "Context") + ".Provider";
                  case REACT_CONSUMER_TYPE:
                    return (type._context.displayName || "Context") + ".Consumer";
                  case REACT_FORWARD_REF_TYPE:
                    var innerType = type.render;
                    type = type.displayName;
                    type || (type = innerType.displayName || innerType.name || "", type = "" !== type ? "ForwardRef(" + type + ")" : "ForwardRef");
                    return type;
                  case REACT_MEMO_TYPE:
                    return innerType = type.displayName || null, null !== innerType ? innerType : getComponentNameFromType(type.type) || "Memo";
                  case REACT_LAZY_TYPE:
                    innerType = type._payload;
                    type = type._init;
                    try {
                      return getComponentNameFromType(type(innerType));
                    } catch (x) {
                    }
                }
              return null;
            }
            function testStringCoercion(value) {
              return "" + value;
            }
            function checkKeyStringCoercion(value) {
              try {
                testStringCoercion(value);
                var JSCompiler_inline_result = false;
              } catch (e) {
                JSCompiler_inline_result = true;
              }
              if (JSCompiler_inline_result) {
                JSCompiler_inline_result = console;
                var JSCompiler_temp_const = JSCompiler_inline_result.error;
                var JSCompiler_inline_result$jscomp$0 = "function" === typeof Symbol && Symbol.toStringTag && value[Symbol.toStringTag] || value.constructor.name || "Object";
                JSCompiler_temp_const.call(
                  JSCompiler_inline_result,
                  "The provided key is an unsupported type %s. This value must be coerced to a string before using it here.",
                  JSCompiler_inline_result$jscomp$0
                );
                return testStringCoercion(value);
              }
            }
            function getTaskName(type) {
              if (type === REACT_FRAGMENT_TYPE) return "<>";
              if ("object" === typeof type && null !== type && type.$$typeof === REACT_LAZY_TYPE)
                return "<...>";
              try {
                var name = getComponentNameFromType(type);
                return name ? "<" + name + ">" : "<...>";
              } catch (x) {
                return "<...>";
              }
            }
            function getOwner() {
              var dispatcher = ReactSharedInternals.A;
              return null === dispatcher ? null : dispatcher.getOwner();
            }
            function UnknownOwner() {
              return Error("react-stack-top-frame");
            }
            function hasValidKey(config) {
              if (hasOwnProperty.call(config, "key")) {
                var getter = Object.getOwnPropertyDescriptor(config, "key").get;
                if (getter && getter.isReactWarning) return false;
              }
              return void 0 !== config.key;
            }
            function defineKeyPropWarningGetter(props, displayName) {
              function warnAboutAccessingKey() {
                specialPropKeyWarningShown || (specialPropKeyWarningShown = true, console.error(
                  "%s: \`key\` is not a prop. Trying to access it will result in \`undefined\` being returned. If you need to access the same value within the child component, you should pass it as a different prop. (https://react.dev/link/special-props)",
                  displayName
                ));
              }
              warnAboutAccessingKey.isReactWarning = true;
              Object.defineProperty(props, "key", {
                get: warnAboutAccessingKey,
                configurable: true
              });
            }
            function elementRefGetterWithDeprecationWarning() {
              var componentName = getComponentNameFromType(this.type);
              didWarnAboutElementRef[componentName] || (didWarnAboutElementRef[componentName] = true, console.error(
                "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release."
              ));
              componentName = this.props.ref;
              return void 0 !== componentName ? componentName : null;
            }
            function ReactElement(type, key, self, source, owner, props, debugStack, debugTask) {
              self = props.ref;
              type = {
                $$typeof: REACT_ELEMENT_TYPE,
                type,
                key,
                props,
                _owner: owner
              };
              null !== (void 0 !== self ? self : null) ? Object.defineProperty(type, "ref", {
                enumerable: false,
                get: elementRefGetterWithDeprecationWarning
              }) : Object.defineProperty(type, "ref", { enumerable: false, value: null });
              type._store = {};
              Object.defineProperty(type._store, "validated", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: 0
              });
              Object.defineProperty(type, "_debugInfo", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: null
              });
              Object.defineProperty(type, "_debugStack", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: debugStack
              });
              Object.defineProperty(type, "_debugTask", {
                configurable: false,
                enumerable: false,
                writable: true,
                value: debugTask
              });
              Object.freeze && (Object.freeze(type.props), Object.freeze(type));
              return type;
            }
            function jsxDEVImpl(type, config, maybeKey, isStaticChildren, source, self, debugStack, debugTask) {
              var children = config.children;
              if (void 0 !== children)
                if (isStaticChildren)
                  if (isArrayImpl(children)) {
                    for (isStaticChildren = 0; isStaticChildren < children.length; isStaticChildren++)
                      validateChildKeys(children[isStaticChildren]);
                    Object.freeze && Object.freeze(children);
                  } else
                    console.error(
                      "React.jsx: Static children should always be an array. You are likely explicitly calling React.jsxs or React.jsxDEV. Use the Babel transform instead."
                    );
                else validateChildKeys(children);
              if (hasOwnProperty.call(config, "key")) {
                children = getComponentNameFromType(type);
                var keys = Object.keys(config).filter(function(k) {
                  return "key" !== k;
                });
                isStaticChildren = 0 < keys.length ? "{key: someKey, " + keys.join(": ..., ") + ": ...}" : "{key: someKey}";
                didWarnAboutKeySpread[children + isStaticChildren] || (keys = 0 < keys.length ? "{" + keys.join(": ..., ") + ": ...}" : "{}", console.error(
                  'A props object containing a "key" prop is being spread into JSX:\\n  let props = %s;\\n  <%s {...props} />\\nReact keys must be passed directly to JSX without using spread:\\n  let props = %s;\\n  <%s key={someKey} {...props} />',
                  isStaticChildren,
                  children,
                  keys,
                  children
                ), didWarnAboutKeySpread[children + isStaticChildren] = true);
              }
              children = null;
              void 0 !== maybeKey && (checkKeyStringCoercion(maybeKey), children = "" + maybeKey);
              hasValidKey(config) && (checkKeyStringCoercion(config.key), children = "" + config.key);
              if ("key" in config) {
                maybeKey = {};
                for (var propName in config)
                  "key" !== propName && (maybeKey[propName] = config[propName]);
              } else maybeKey = config;
              children && defineKeyPropWarningGetter(
                maybeKey,
                "function" === typeof type ? type.displayName || type.name || "Unknown" : type
              );
              return ReactElement(
                type,
                children,
                self,
                source,
                getOwner(),
                maybeKey,
                debugStack,
                debugTask
              );
            }
            function validateChildKeys(node) {
              "object" === typeof node && null !== node && node.$$typeof === REACT_ELEMENT_TYPE && node._store && (node._store.validated = 1);
            }
            var React = require_react(), REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_PORTAL_TYPE = Symbol.for("react.portal"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment"), REACT_STRICT_MODE_TYPE = Symbol.for("react.strict_mode"), REACT_PROFILER_TYPE = Symbol.for("react.profiler");
            Symbol.for("react.provider");
            var REACT_CONSUMER_TYPE = Symbol.for("react.consumer"), REACT_CONTEXT_TYPE = Symbol.for("react.context"), REACT_FORWARD_REF_TYPE = Symbol.for("react.forward_ref"), REACT_SUSPENSE_TYPE = Symbol.for("react.suspense"), REACT_SUSPENSE_LIST_TYPE = Symbol.for("react.suspense_list"), REACT_MEMO_TYPE = Symbol.for("react.memo"), REACT_LAZY_TYPE = Symbol.for("react.lazy"), REACT_ACTIVITY_TYPE = Symbol.for("react.activity"), REACT_CLIENT_REFERENCE = Symbol.for("react.client.reference"), ReactSharedInternals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, hasOwnProperty = Object.prototype.hasOwnProperty, isArrayImpl = Array.isArray, createTask = console.createTask ? console.createTask : function() {
              return null;
            };
            React = {
              react_stack_bottom_frame: function(callStackForError) {
                return callStackForError();
              }
            };
            var specialPropKeyWarningShown;
            var didWarnAboutElementRef = {};
            var unknownOwnerDebugStack = React.react_stack_bottom_frame.bind(
              React,
              UnknownOwner
            )();
            var unknownOwnerDebugTask = createTask(getTaskName(UnknownOwner));
            var didWarnAboutKeySpread = {};
            exports.Fragment = REACT_FRAGMENT_TYPE;
            exports.jsx = function(type, config, maybeKey, source, self) {
              var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
              return jsxDEVImpl(
                type,
                config,
                maybeKey,
                false,
                source,
                self,
                trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
                trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
              );
            };
            exports.jsxs = function(type, config, maybeKey, source, self) {
              var trackActualOwner = 1e4 > ReactSharedInternals.recentlyCreatedOwnerStacks++;
              return jsxDEVImpl(
                type,
                config,
                maybeKey,
                true,
                source,
                self,
                trackActualOwner ? Error("react-stack-top-frame") : unknownOwnerDebugStack,
                trackActualOwner ? createTask(getTaskName(type)) : unknownOwnerDebugTask
              );
            };
          })();
        }
      });

      // ../../node_modules/.pnpm/react@19.1.2/node_modules/react/jsx-runtime.js
      var require_jsx_runtime = __commonJS({
        "../../node_modules/.pnpm/react@19.1.2/node_modules/react/jsx-runtime.js"(exports, module) {
          "use strict";
          if (false) {
            module.exports = null;
          } else {
            module.exports = require_react_jsx_runtime_development();
          }
        }
      });

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/test_dyno.tsx
      var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
      import { useData } from "@getcronit/pylon-pages";
      function Component({ input }) {
        const data = useData({
          prepare: ({ query }) => {
            query?.dyno?.({ input });
          }
        });
        return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: data.dyno({ input }) });
      }
      export {
        Component
      };
      /*! Bundled license information:

      react/cjs/react.development.js:
        (**
         * @license React
         * react.development.js
         *
         * Copyright (c) Meta Platforms, Inc. and affiliates.
         *
         * This source code is licensed under the MIT license found in the
         * LICENSE file in the root directory of this source tree.
         *)

      react/cjs/react-jsx-runtime.development.js:
        (**
         * @license React
         * react-jsx-runtime.development.js
         *
         * Copyright (c) Meta Platforms, Inc. and affiliates.
         *
         * This source code is licensed under the MIT license found in the
         * LICENSE file in the root directory of this source tree.
         *)
      */
      "
    `)
  })
  it('should correctly resolve selectors across multiple files in a real build scenario', async () => {
    // 1. Create a component in another file
    const cardCode = `
      export function UserCard({ user }) {
        return (
          <div>
            <h1>{user.name}</h1>
            <p>{user.bio.short}</p>
          </div>
        );
      }
    `
    fs.writeFileSync(path.join(tempDir, 'UserCard.tsx'), cardCode)
    // 2. Create the main page that imports and uses the component
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { UserCard } from "./UserCard";
      export function Page() {
        const data = useData();
        return <UserCard user={data.user} />;
      }
    `
    const pagePath = path.join(tempDir, 'Page.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 3. Build the page
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/Page.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/UserCard.tsx
      import { jsx, jsxs } from "react/jsx-runtime";
      function UserCard({ user }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h1", { children: user.name }),
          /* @__PURE__ */ jsx("p", { children: user.bio.short })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/Page.tsx
      import { jsx as jsx2 } from "react/jsx-runtime";
      function Page() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.user;
            v1?.name;
            v1?.bio?.short;
          }
        });
        return /* @__PURE__ */ jsx2(UserCard, { user: data.user });
      }
      export {
        Page
      };
      "
    `)
  })
  it('should handle nested cross-file resolution across three levels', async () => {
    // Level 3: GrandChild.tsx
    const grandChildCode = `
      export function GrandChild({ info }) {
        return <span>{info.detail}</span>;
      }
    `
    fs.writeFileSync(path.join(tempDir, 'GrandChild.tsx'), grandChildCode)
    // Level 2: Child.tsx
    const childCode = `
      import { GrandChild } from "./GrandChild";
      export function Child({ user }) {
        return (
          <div>
            <p>{user.name}</p>
            <GrandChild info={user.meta} />
          </div>
        );
      }
    `
    fs.writeFileSync(path.join(tempDir, 'Child.tsx'), childCode)
    // Level 1: Parent.tsx
    const parentCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { Child } from "./Child";
      export default function Parent() {
        const data = useData()
        return <Child user={data.user} />;
      }
    `
    const parentPath = path.join(tempDir, 'Parent.tsx')
    fs.writeFileSync(parentPath, parentCode)
    const result = await esbuild.build({
      entryPoints: [parentPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/Parent.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/GrandChild.tsx
      import { jsx } from "react/jsx-runtime";
      function GrandChild({ info }) {
        return /* @__PURE__ */ jsx("span", { children: info.detail });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/Child.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function Child({ user }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx2("p", { children: user.name }),
          /* @__PURE__ */ jsx2(GrandChild, { info: user.meta })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/Parent.tsx
      import { jsx as jsx3 } from "react/jsx-runtime";
      function Parent() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.user;
            v1?.name;
            v1?.meta?.detail;
          }
        });
        return /* @__PURE__ */ jsx3(Child, { user: data.user });
      }
      export {
        Parent as default
      };
      "
    `)
  })
  it('should handle mixed prop usage and standalone useData in the same component', async () => {
    // Child component that uses both props and its own query
    const childCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function SharedComponent({ user }) {
        const settings = useData();
        return (
          <div>
            <p>{user.email}</p>
            <p>{settings.timezone}</p>
          </div>
        );
      }
    `
    fs.writeFileSync(path.join(tempDir, 'SharedComponent.tsx'), childCode)
    // Parent page
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { SharedComponent } from "./SharedComponent";
      export function Page() {
        const data = useData();
        return <SharedComponent user={data.currentUser} />;
      }
    `
    const pagePath = path.join(tempDir, 'AppPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const outputCode = result.outputFiles[0].text
    // Verify Page's query (should contain currentUser.email)
    // Note: esbuild might rename useData to useData2 etc. to avoid collisions

    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/AppPage.tsx
      import { useData as useData2 } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/SharedComponent.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx, jsxs } from "react/jsx-runtime";
      function SharedComponent({ user }) {
        const settings = useData({
          prepare: ({ query }) => {
            query?.timezone;
          }
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("p", { children: user.email }),
          /* @__PURE__ */ jsx("p", { children: settings.timezone })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/AppPage.tsx
      import { jsx as jsx2 } from "react/jsx-runtime";
      function Page() {
        const data = useData2({
          prepare: ({ query }) => {
            query?.currentUser?.email;
          }
        });
        return /* @__PURE__ */ jsx2(SharedComponent, { user: data.currentUser });
      }
      export {
        Page
      };
      "
    `)
  })
})
// =============================================================================
// REALISTIC NEXT.JS APP — Multiple pages, shared layouts, deep component trees
// =============================================================================
describe('Realistic NextJS App with useData', () => {
  const appDir = path.join(__dirname, 'temp_nextjs_app')
  beforeAll(() => {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir)
    fs.mkdirSync(appDir, {recursive: true})
    fs.mkdirSync(path.join(appDir, 'components'), {recursive: true})
    fs.mkdirSync(path.join(appDir, 'hooks'), {recursive: true})
    fs.mkdirSync(path.join(appDir, 'pages'), {recursive: true})
    // Create a tsconfig.json to help ts-morph with cross-file resolution
    fs.writeFileSync(
      path.join(appDir, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            jsx: 'react-jsx',
            allowJs: true,
            module: 'ESNext',
            target: 'ESNext',
            moduleResolution: 'node',
            baseUrl: './'
          },
          include: ['**/*']
        },
        null,
        2
      )
    )
  })
  afterAll(() => {
    if (fs.existsSync(appDir)) fs.rmSync(appDir, {recursive: true, force: true})
    if (fs.existsSync(tempDir))
      fs.rmSync(tempDir, {recursive: true, force: true})
  })
  // --------------------------------------------------------------------------
  // Shared component files (no useData — only consume props)
  // --------------------------------------------------------------------------
  function writeSharedComponents() {
    // components/Avatar.tsx — leaf component
    fs.writeFileSync(
      path.join(appDir, 'components', 'Avatar.tsx'),
      `
      export function Avatar({ user }) {
        return (
          <img src={user.avatarUrl} alt={user.displayName} />
        );
      }
      `
    )
    // components/Badge.tsx — another leaf
    fs.writeFileSync(
      path.join(appDir, 'components', 'Badge.tsx'),
      `
      export function Badge({ label, color }) {
        return <span style={{ background: color }}>{label}</span>;
      }
      `
    )
    // components/UserCard.tsx — composes Avatar
    fs.writeFileSync(
      path.join(appDir, 'components', 'UserCard.tsx'),
      `
      import { Avatar } from "./Avatar";
      export function UserCard({ user }) {
        return (
          <div>
            <Avatar user={user} />
            <h2>{user.displayName}</h2>
            <p>{user.email}</p>
          </div>
        );
      }
      `
    )
    // components/PostCard.tsx — renders a single post
    fs.writeFileSync(
      path.join(appDir, 'components', 'PostCard.tsx'),
      `
      import { Badge } from "./Badge";
      export function PostCard({ post }) {
        return (
          <article>
            <h3>{post.title}</h3>
            <p>{post.excerpt}</p>
            <span>{post.author.name}</span>
            {post.tags.map(tag => <Badge label={tag.name} color={tag.color} />)}
          </article>
        );
      }
      `
    )
    // components/CommentThread.tsx — recursive-ish nested comments
    fs.writeFileSync(
      path.join(appDir, 'components', 'CommentThread.tsx'),
      `
      export function CommentThread({ comment }) {
        return (
          <div>
            <p>{comment.body}</p>
            <span>{comment.author.username}</span>
            <small>{comment.createdAt}</small>
          </div>
        );
      }
      `
    )
    // components/Sidebar.tsx — navigation sidebar that consumes site config
    fs.writeFileSync(
      path.join(appDir, 'components', 'Sidebar.tsx'),
      `
      export function Sidebar({ config }) {
        return (
          <nav>
            <h1>{config.siteName}</h1>
            <img src={config.logo.url} alt={config.logo.alt} />
          </nav>
        );
      }
      `
    )
    // components/Notification.tsx — notification bell
    fs.writeFileSync(
      path.join(appDir, 'components', 'Notification.tsx'),
      `
      export function Notification({ item }) {
        return (
          <div>
            <strong>{item.title}</strong>
            <p>{item.message}</p>
            <time>{item.timestamp}</time>
          </div>
        );
      }
      `
    )
    // components/StatCard.tsx — dashboard stat widget
    fs.writeFileSync(
      path.join(appDir, 'components', 'StatCard.tsx'),
      `
      export function StatCard({ stat }) {
        return (
          <div>
            <h4>{stat.label}</h4>
            <span>{stat.value}</span>
            <small>{stat.trend.direction}</small>
            <small>{stat.trend.percentage}</small>
          </div>
        );
      }
      `
    )
    // components/Layout.tsx — wraps Sidebar, takes siteConfig prop
    fs.writeFileSync(
      path.join(appDir, 'components', 'Layout.tsx'),
      `
      import { Sidebar } from "./Sidebar";
      export function Layout({ siteConfig, children }) {
        return (
          <div>
            <Sidebar config={siteConfig} />
            <main>{children}</main>
            <footer>{siteConfig.footerText}</footer>
          </div>
        );
      }
      `
    )
  }
  // --------------------------------------------------------------------------
  // Test 1: Dashboard page — multiple useData roots, stats, notifications
  // --------------------------------------------------------------------------
  it('should handle a Dashboard page with stats, notifications, and layout', async () => {
    writeSharedComponents()
    const dashboardCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { Layout } from "../components/Layout";
      import { StatCard } from "../components/StatCard";
      import { Notification } from "../components/Notification";
      import { UserCard } from "../components/UserCard";
      export default function DashboardPage() {
        const data = useData();
        return (
          <Layout siteConfig={data.siteConfig}>
            <UserCard user={data.currentUser} />
            {data.dashboardStats({ period: "weekly" }).map(stat => (
              <StatCard stat={stat} />
            ))}
            {data.notifications({ unread: true }).map(n => (
              <Notification item={n} />
            ))}
          </Layout>
        );
      }
    `
    const dashboardPath = path.join(appDir, 'pages', 'Dashboard.tsx')
    fs.writeFileSync(dashboardPath, dashboardCode)
    const result = await esbuild.build({
      entryPoints: [dashboardPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Dashboard.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Sidebar.tsx
      import { jsx, jsxs } from "react/jsx-runtime";
      function Sidebar({ config }) {
        return /* @__PURE__ */ jsxs("nav", { children: [
          /* @__PURE__ */ jsx("h1", { children: config.siteName }),
          /* @__PURE__ */ jsx("img", { src: config.logo.url, alt: config.logo.alt })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Layout.tsx
      import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
      function Layout({ siteConfig, children }) {
        return /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx2(Sidebar, { config: siteConfig }),
          /* @__PURE__ */ jsx2("main", { children }),
          /* @__PURE__ */ jsx2("footer", { children: siteConfig.footerText })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/StatCard.tsx
      import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
      function StatCard({ stat }) {
        return /* @__PURE__ */ jsxs3("div", { children: [
          /* @__PURE__ */ jsx3("h4", { children: stat.label }),
          /* @__PURE__ */ jsx3("span", { children: stat.value }),
          /* @__PURE__ */ jsx3("small", { children: stat.trend.direction }),
          /* @__PURE__ */ jsx3("small", { children: stat.trend.percentage })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Notification.tsx
      import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
      function Notification({ item }) {
        return /* @__PURE__ */ jsxs4("div", { children: [
          /* @__PURE__ */ jsx4("strong", { children: item.title }),
          /* @__PURE__ */ jsx4("p", { children: item.message }),
          /* @__PURE__ */ jsx4("time", { children: item.timestamp })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Avatar.tsx
      import { jsx as jsx5 } from "react/jsx-runtime";
      function Avatar({ user }) {
        return /* @__PURE__ */ jsx5("img", { src: user.avatarUrl, alt: user.displayName });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/UserCard.tsx
      import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
      function UserCard({ user }) {
        return /* @__PURE__ */ jsxs5("div", { children: [
          /* @__PURE__ */ jsx6(Avatar, { user }),
          /* @__PURE__ */ jsx6("h2", { children: user.displayName }),
          /* @__PURE__ */ jsx6("p", { children: user.email })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Dashboard.tsx
      import { jsx as jsx7, jsxs as jsxs6 } from "react/jsx-runtime";
      function DashboardPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.siteConfig;
            v1?.siteName;
            const v2 = v1?.logo;
            v2?.url;
            v2?.alt;
            v1?.footerText;
            const v3 = query?.currentUser;
            v3?.avatarUrl;
            v3?.displayName;
            v3?.email;
            query?.dashboardStats?.({ period: "weekly" })?.map((i1) => {
              i1?.label;
              i1?.value;
              const v4 = i1?.trend;
              v4?.direction;
              v4?.percentage;
            });
            query?.notifications?.({ unread: true })?.map((i1) => {
              i1?.title;
              i1?.message;
              i1?.timestamp;
            });
          }
        });
        return /* @__PURE__ */ jsxs6(Layout, { siteConfig: data.siteConfig, children: [
          /* @__PURE__ */ jsx7(UserCard, { user: data.currentUser }),
          data.dashboardStats({ period: "weekly" }).map((stat) => /* @__PURE__ */ jsx7(StatCard, { stat })),
          data.notifications({ unread: true }).map((n) => /* @__PURE__ */ jsx7(Notification, { item: n }))
        ] });
      }
      export {
        DashboardPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 2: Blog listing page — PostCard with nested tags array
  // --------------------------------------------------------------------------
  it('should handle a Blog listing page with PostCards and nested tag arrays', async () => {
    writeSharedComponents()
    const blogCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { PostCard } from "../components/PostCard";
      export default function BlogPage() {
        const data = useData();
        return (
          <div>
            <h1>{data.blogMeta.title}</h1>
            <p>{data.blogMeta.description}</p>
            {data.posts({ limit: 20, category: "tech" }).map(post => (
              <PostCard post={post} />
            ))}
          </div>
        );
      }
    `
    const blogPath = path.join(appDir, 'pages', 'Blog.tsx')
    fs.writeFileSync(blogPath, blogCode)
    const result = await esbuild.build({
      entryPoints: [blogPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Blog.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Badge.tsx
      import { jsx } from "react/jsx-runtime";
      function Badge({ label, color }) {
        return /* @__PURE__ */ jsx("span", { style: { background: color }, children: label });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/PostCard.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function PostCard({ post }) {
        return /* @__PURE__ */ jsxs("article", { children: [
          /* @__PURE__ */ jsx2("h3", { children: post.title }),
          /* @__PURE__ */ jsx2("p", { children: post.excerpt }),
          /* @__PURE__ */ jsx2("span", { children: post.author.name }),
          post.tags.map((tag) => /* @__PURE__ */ jsx2(Badge, { label: tag.name, color: tag.color }))
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Blog.tsx
      import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
      function BlogPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.blogMeta;
            v1?.title;
            v1?.description;
            query?.posts?.({ limit: 20, category: "tech" })?.map((i1) => {
              i1?.title;
              i1?.excerpt;
              i1?.author?.name;
              i1?.tags?.map((i2) => {
                i2?.name;
                i2?.color;
              });
            });
          }
        });
        return /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx3("h1", { children: data.blogMeta.title }),
          /* @__PURE__ */ jsx3("p", { children: data.blogMeta.description }),
          data.posts({ limit: 20, category: "tech" }).map((post) => /* @__PURE__ */ jsx3(PostCard, { post }))
        ] });
      }
      export {
        BlogPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 3: Profile page — user detail + their posts + comments on each post
  // --------------------------------------------------------------------------
  it('should handle a deeply nested Profile page with user, posts, and comments', async () => {
    writeSharedComponents()
    // A dedicated ProfileHeader component
    fs.writeFileSync(
      path.join(appDir, 'components', 'ProfileHeader.tsx'),
      `
      import { Avatar } from "./Avatar";
      export function ProfileHeader({ user }) {
        return (
          <header>
            <Avatar user={user} />
            <h1>{user.displayName}</h1>
            <p>{user.bio}</p>
            <span>{user.location.city}</span>
            <span>{user.location.country}</span>
          </header>
        );
      }
      `
    )
    const profileCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { ProfileHeader } from "../components/ProfileHeader";
      import { PostCard } from "../components/PostCard";
      import { CommentThread } from "../components/CommentThread";
      export default function ProfilePage() {
        const data = useData();
        return (
          <div>
            <ProfileHeader user={data.profile} />
            {data.profile.posts({ sort: "newest" }).map(post => (
              <div>
                <PostCard post={post} />
                {post.comments({ limit: 5 }).map(comment => (
                  <CommentThread comment={comment} />
                ))}
              </div>
            ))}
          </div>
        );
      }
    `
    const profilePath = path.join(appDir, 'pages', 'Profile.tsx')
    fs.writeFileSync(profilePath, profileCode)
    const result = await esbuild.build({
      entryPoints: [profilePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Profile.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Avatar.tsx
      import { jsx } from "react/jsx-runtime";
      function Avatar({ user }) {
        return /* @__PURE__ */ jsx("img", { src: user.avatarUrl, alt: user.displayName });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/ProfileHeader.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function ProfileHeader({ user }) {
        return /* @__PURE__ */ jsxs("header", { children: [
          /* @__PURE__ */ jsx2(Avatar, { user }),
          /* @__PURE__ */ jsx2("h1", { children: user.displayName }),
          /* @__PURE__ */ jsx2("p", { children: user.bio }),
          /* @__PURE__ */ jsx2("span", { children: user.location.city }),
          /* @__PURE__ */ jsx2("span", { children: user.location.country })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Badge.tsx
      import { jsx as jsx3 } from "react/jsx-runtime";
      function Badge({ label, color }) {
        return /* @__PURE__ */ jsx3("span", { style: { background: color }, children: label });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/PostCard.tsx
      import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
      function PostCard({ post }) {
        return /* @__PURE__ */ jsxs2("article", { children: [
          /* @__PURE__ */ jsx4("h3", { children: post.title }),
          /* @__PURE__ */ jsx4("p", { children: post.excerpt }),
          /* @__PURE__ */ jsx4("span", { children: post.author.name }),
          post.tags.map((tag) => /* @__PURE__ */ jsx4(Badge, { label: tag.name, color: tag.color }))
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/CommentThread.tsx
      import { jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
      function CommentThread({ comment }) {
        return /* @__PURE__ */ jsxs3("div", { children: [
          /* @__PURE__ */ jsx5("p", { children: comment.body }),
          /* @__PURE__ */ jsx5("span", { children: comment.author.username }),
          /* @__PURE__ */ jsx5("small", { children: comment.createdAt })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Profile.tsx
      import { jsx as jsx6, jsxs as jsxs4 } from "react/jsx-runtime";
      function ProfilePage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.profile;
            v1?.avatarUrl;
            v1?.displayName;
            v1?.bio;
            const v2 = v1?.location;
            v2?.city;
            v2?.country;
            v1?.posts?.({ sort: "newest" })?.map((i1) => {
              i1?.title;
              i1?.excerpt;
              i1?.author?.name;
              i1?.tags?.map((i2) => {
                i2?.name;
                i2?.color;
              });
              i1?.comments?.({ limit: 5 })?.map((i2) => {
                i2?.body;
                i2?.author?.username;
                i2?.createdAt;
              });
            });
          }
        });
        return /* @__PURE__ */ jsxs4("div", { children: [
          /* @__PURE__ */ jsx6(ProfileHeader, { user: data.profile }),
          data.profile.posts({ sort: "newest" }).map((post) => /* @__PURE__ */ jsxs4("div", { children: [
            /* @__PURE__ */ jsx6(PostCard, { post }),
            post.comments({ limit: 5 }).map((comment) => /* @__PURE__ */ jsx6(CommentThread, { comment }))
          ] }))
        ] });
      }
      export {
        ProfilePage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 4: Settings page — two independent useData calls in the same page
  // --------------------------------------------------------------------------
  it('should handle a Settings page with two independent useData calls', async () => {
    writeSharedComponents()
    // components/ThemePreview.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'ThemePreview.tsx'),
      `
      export function ThemePreview({ theme }) {
        return (
          <div style={{ background: theme.primaryColor }}>
            <p>{theme.fontFamily}</p>
            <p>{theme.borderRadius}</p>
          </div>
        );
      }
      `
    )
    const settingsCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { UserCard } from "../components/UserCard";
      import { ThemePreview } from "../components/ThemePreview";
      export default function SettingsPage() {
        const userData = useData();
        const appConfig = useData();
        return (
          <div>
            <h1>Account Settings</h1>
            <UserCard user={userData.account} />
            <p>{userData.account.createdAt}</p>
            <h2>Theme</h2>
            <ThemePreview theme={appConfig.theme} />
            <p>Language: {appConfig.locale.language}</p>
            <p>Timezone: {appConfig.locale.timezone}</p>
          </div>
        );
      }
    `
    const settingsPath = path.join(appDir, 'pages', 'Settings.tsx')
    fs.writeFileSync(settingsPath, settingsCode)
    const result = await esbuild.build({
      entryPoints: [settingsPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Settings.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Avatar.tsx
      import { jsx } from "react/jsx-runtime";
      function Avatar({ user }) {
        return /* @__PURE__ */ jsx("img", { src: user.avatarUrl, alt: user.displayName });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/UserCard.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function UserCard({ user }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx2(Avatar, { user }),
          /* @__PURE__ */ jsx2("h2", { children: user.displayName }),
          /* @__PURE__ */ jsx2("p", { children: user.email })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/ThemePreview.tsx
      import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
      function ThemePreview({ theme }) {
        return /* @__PURE__ */ jsxs2("div", { style: { background: theme.primaryColor }, children: [
          /* @__PURE__ */ jsx3("p", { children: theme.fontFamily }),
          /* @__PURE__ */ jsx3("p", { children: theme.borderRadius })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Settings.tsx
      import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
      function SettingsPage() {
        const userData = useData({
          prepare: ({ query }) => {
            const v1 = query?.account;
            v1?.avatarUrl;
            v1?.displayName;
            v1?.email;
            v1?.createdAt;
          }
        });
        const appConfig = useData({
          prepare: ({ query }) => {
            const v1 = query?.theme;
            v1?.primaryColor;
            v1?.fontFamily;
            v1?.borderRadius;
            const v2 = query?.locale;
            v2?.language;
            v2?.timezone;
          }
        });
        return /* @__PURE__ */ jsxs3("div", { children: [
          /* @__PURE__ */ jsx4("h1", { children: "Account Settings" }),
          /* @__PURE__ */ jsx4(UserCard, { user: userData.account }),
          /* @__PURE__ */ jsx4("p", { children: userData.account.createdAt }),
          /* @__PURE__ */ jsx4("h2", { children: "Theme" }),
          /* @__PURE__ */ jsx4(ThemePreview, { theme: appConfig.theme }),
          /* @__PURE__ */ jsxs3("p", { children: [
            "Language: ",
            appConfig.locale.language
          ] }),
          /* @__PURE__ */ jsxs3("p", { children: [
            "Timezone: ",
            appConfig.locale.timezone
          ] })
        ] });
      }
      export {
        SettingsPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 5: Full app entry — Layout wrapping a page + child with own useData
  // --------------------------------------------------------------------------
  it('should handle a full app with Layout + child component that has its own useData', async () => {
    writeSharedComponents()
    // components/ActivityFeed.tsx — has its OWN useData
    fs.writeFileSync(
      path.join(appDir, 'components', 'ActivityFeed.tsx'),
      `
      import { useData } from "@getcronit/pylon-pages";
      export function ActivityFeed() {
        const feed = useData();
        return (
          <ul>
            {feed.recentActivity({ limit: 10 }).map(activity => (
              <li>
                <strong>{activity.action}</strong>
                <span>{activity.actor.name}</span>
                <time>{activity.performedAt}</time>
              </li>
            ))}
          </ul>
        );
      }
      `
    )
    const appPageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { Layout } from "../components/Layout";
      import { ActivityFeed } from "../components/ActivityFeed";
      import { UserCard } from "../components/UserCard";
      export default function AppPage() {
        const data = useData();
        return (
          <Layout siteConfig={data.siteConfig}>
            <UserCard user={data.viewer} />
            <ActivityFeed />
          </Layout>
        );
      }
    `
    const appPagePath = path.join(appDir, 'pages', 'AppPage.tsx')
    fs.writeFileSync(appPagePath, appPageCode)
    const result = await esbuild.build({
      entryPoints: [appPagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/AppPage.tsx
      import { useData as useData2 } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Sidebar.tsx
      import { jsx, jsxs } from "react/jsx-runtime";
      function Sidebar({ config }) {
        return /* @__PURE__ */ jsxs("nav", { children: [
          /* @__PURE__ */ jsx("h1", { children: config.siteName }),
          /* @__PURE__ */ jsx("img", { src: config.logo.url, alt: config.logo.alt })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Layout.tsx
      import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
      function Layout({ siteConfig, children }) {
        return /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx2(Sidebar, { config: siteConfig }),
          /* @__PURE__ */ jsx2("main", { children }),
          /* @__PURE__ */ jsx2("footer", { children: siteConfig.footerText })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/ActivityFeed.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
      function ActivityFeed() {
        const feed = useData({
          prepare: ({ query }) => {
            query?.recentActivity?.({ limit: 10 })?.map((i1) => {
              i1?.action;
              i1?.actor?.name;
              i1?.performedAt;
            });
          }
        });
        return /* @__PURE__ */ jsx3("ul", { children: feed.recentActivity({ limit: 10 }).map((activity) => /* @__PURE__ */ jsxs3("li", { children: [
          /* @__PURE__ */ jsx3("strong", { children: activity.action }),
          /* @__PURE__ */ jsx3("span", { children: activity.actor.name }),
          /* @__PURE__ */ jsx3("time", { children: activity.performedAt })
        ] })) });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Avatar.tsx
      import { jsx as jsx4 } from "react/jsx-runtime";
      function Avatar({ user }) {
        return /* @__PURE__ */ jsx4("img", { src: user.avatarUrl, alt: user.displayName });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/UserCard.tsx
      import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
      function UserCard({ user }) {
        return /* @__PURE__ */ jsxs4("div", { children: [
          /* @__PURE__ */ jsx5(Avatar, { user }),
          /* @__PURE__ */ jsx5("h2", { children: user.displayName }),
          /* @__PURE__ */ jsx5("p", { children: user.email })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/AppPage.tsx
      import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
      function AppPage() {
        const data = useData2({
          prepare: ({ query }) => {
            const v1 = query?.siteConfig;
            v1?.siteName;
            const v2 = v1?.logo;
            v2?.url;
            v2?.alt;
            v1?.footerText;
            const v3 = query?.viewer;
            v3?.avatarUrl;
            v3?.displayName;
            v3?.email;
          }
        });
        return /* @__PURE__ */ jsxs5(Layout, { siteConfig: data.siteConfig, children: [
          /* @__PURE__ */ jsx6(UserCard, { user: data.viewer }),
          /* @__PURE__ */ jsx6(ActivityFeed, {})
        ] });
      }
      export {
        AppPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 6: Page with React state variables and conditional data access
  // --------------------------------------------------------------------------
  it('should preserve React state variables and handle conditional field access', async () => {
    const pageCode = `
      import { useState } from "react";
      import { useData } from "@getcronit/pylon-pages";
      export default function SearchPage() {
        const [query, setQuery] = useState("");
        const [page, setPage] = useState(0);
        const data = useData();
        const results = data.search({ term: query, offset: page, limit: 25 });
        return (
          <div>
            <h1>{data.searchMeta.totalCount}</h1>
            {results.map(item => (
              <div>
                <h3>{item.title}</h3>
                <p>{item.snippet}</p>
                <span>{item.relevanceScore}</span>
              </div>
            ))}
          </div>
        );
      }
    `
    const searchPath = path.join(appDir, 'pages', 'Search.tsx')
    fs.writeFileSync(searchPath, pageCode)
    const result = await esbuild.build({
      entryPoints: [searchPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Search.tsx
      import { useState } from "react";
      import { useData } from "@getcronit/pylon-pages";
      import { jsx, jsxs } from "react/jsx-runtime";
      function SearchPage() {
        const [query, setQuery] = useState("");
        const [page, setPage] = useState(0);
        const data = useData({
          prepare: ({ query: query2 }) => {
            query2?.search?.({ term: query2, offset: page, limit: 25 })?.map((i1) => {
              i1?.title;
              i1?.snippet;
              i1?.relevanceScore;
            });
            query2?.searchMeta?.totalCount;
          }
        });
        const results = data.search({ term: query, offset: page, limit: 25 });
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h1", { children: data.searchMeta.totalCount }),
          results.map((item) => /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h3", { children: item.title }),
            /* @__PURE__ */ jsx("p", { children: item.snippet }),
            /* @__PURE__ */ jsx("span", { children: item.relevanceScore })
          ] }))
        ] });
      }
      export {
        SearchPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 7: Four-level deep component tree (Page -> Section -> Card -> Detail)
  // --------------------------------------------------------------------------
  it('should resolve selectors across a four-level deep component tree', async () => {
    // Level 4: components/PriceTag.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'PriceTag.tsx'),
      `
      export function PriceTag({ pricing }) {
        return (
          <div>
            <span>{pricing.amount}</span>
            <span>{pricing.currency}</span>
            <small>{pricing.discount.percentage}</small>
          </div>
        );
      }
      `
    )
    // Level 3: components/ProductCard.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'ProductCard.tsx'),
      `
      import { PriceTag } from "./PriceTag";
      export function ProductCard({ product }) {
        return (
          <div>
            <h3>{product.name}</h3>
            <p>{product.description}</p>
            <img src={product.image.thumbnail} />
            <PriceTag pricing={product.pricing} />
          </div>
        );
      }
      `
    )
    // Level 2: components/ProductSection.tsx
    fs.writeFileSync(
      path.join(appDir, 'components', 'ProductSection.tsx'),
      `
      import { ProductCard } from "./ProductCard";
      export function ProductSection({ products, sectionTitle }) {
        return (
          <section>
            <h2>{sectionTitle}</h2>
            {products.map(p => <ProductCard product={p} />)}
          </section>
        );
      }
      `
    )
    // Level 1: pages/StorePage.tsx
    const storeCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { ProductSection } from "../components/ProductSection";
      export default function StorePage() {
        const data = useData();
        return (
          <div>
            <h1>{data.store.name}</h1>
            <ProductSection
              products={data.store.featuredProducts({ limit: 8 })}
              sectionTitle={data.store.featuredLabel}
            />
          </div>
        );
      }
    `
    const storePath = path.join(appDir, 'pages', 'StorePage.tsx')
    fs.writeFileSync(storePath, storeCode)
    const result = await esbuild.build({
      entryPoints: [storePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/StorePage.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/PriceTag.tsx
      import { jsx, jsxs } from "react/jsx-runtime";
      function PriceTag({ pricing }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { children: pricing.amount }),
          /* @__PURE__ */ jsx("span", { children: pricing.currency }),
          /* @__PURE__ */ jsx("small", { children: pricing.discount.percentage })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/ProductCard.tsx
      import { jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
      function ProductCard({ product }) {
        return /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx2("h3", { children: product.name }),
          /* @__PURE__ */ jsx2("p", { children: product.description }),
          /* @__PURE__ */ jsx2("img", { src: product.image.thumbnail }),
          /* @__PURE__ */ jsx2(PriceTag, { pricing: product.pricing })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/ProductSection.tsx
      import { jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
      function ProductSection({ products, sectionTitle }) {
        return /* @__PURE__ */ jsxs3("section", { children: [
          /* @__PURE__ */ jsx3("h2", { children: sectionTitle }),
          products.map((p) => /* @__PURE__ */ jsx3(ProductCard, { product: p }))
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/StorePage.tsx
      import { jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
      function StorePage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.store;
            v1?.name;
            v1?.featuredProducts?.({ limit: 8 })?.map((i1) => {
              i1?.name;
              i1?.description;
              i1?.image?.thumbnail;
              const v2 = i1?.pricing;
              v2?.amount;
              v2?.currency;
              v2?.discount?.percentage;
            });
            v1?.featuredLabel;
          }
        });
        return /* @__PURE__ */ jsxs4("div", { children: [
          /* @__PURE__ */ jsx4("h1", { children: data.store.name }),
          /* @__PURE__ */ jsx4(
            ProductSection,
            {
              products: data.store.featuredProducts({ limit: 8 }),
              sectionTitle: data.store.featuredLabel
            }
          )
        ] });
      }
      export {
        StorePage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 8: Page with useData options object and data destructuring
  // --------------------------------------------------------------------------
  it('should inject selectors alongside existing useData config', async () => {
    writeSharedComponents()
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function ConfiguredPage() {
        const data = useData({ pollInterval: 5000, retry: 3 });
        return (
          <div>
            <h1>{data.dashboard.title}</h1>
            <p>{data.dashboard.lastUpdated}</p>
            {data.dashboard.widgets.map(w => (
              <div>
                <span>{w.type}</span>
                <span>{w.content.value}</span>
              </div>
            ))}
          </div>
        );
      }
    `
    const configuredPath = path.join(appDir, 'pages', 'ConfiguredPage.tsx')
    fs.writeFileSync(configuredPath, pageCode)
    const result = await esbuild.build({
      entryPoints: [configuredPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/ConfiguredPage.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx, jsxs } from "react/jsx-runtime";
      function ConfiguredPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.dashboard;
            v1?.title;
            v1?.lastUpdated;
            v1?.widgets?.map((i1) => {
              i1?.type;
              i1?.content?.value;
            });
          },
          pollInterval: 5e3,
          retry: 3
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h1", { children: data.dashboard.title }),
          /* @__PURE__ */ jsx("p", { children: data.dashboard.lastUpdated }),
          data.dashboard.widgets.map((w) => /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("span", { children: w.type }),
            /* @__PURE__ */ jsx("span", { children: w.content.value })
          ] }))
        ] });
      }
      export {
        ConfiguredPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 9: Multiple pages built as separate entry points — isolation
  // --------------------------------------------------------------------------
  it('should correctly isolate selectors when building multiple pages', async () => {
    // Page A: only accesses user data
    const pageACode = `
      import { useData } from "@getcronit/pylon-pages";
      export function PageA() {
        const data = useData();
        return <div>{data.user.firstName} {data.user.lastName}</div>;
      }
    `
    const pageAPath = path.join(appDir, 'pages', 'PageA.tsx')
    fs.writeFileSync(pageAPath, pageACode)
    // Page B: only accesses product data
    const pageBCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function PageB() {
        const data = useData();
        return <div>{data.product.sku} - {data.product.price}</div>;
      }
    `
    const pageBPath = path.join(appDir, 'pages', 'PageB.tsx')
    fs.writeFileSync(pageBPath, pageBCode)
    // Build them independently
    const [resultA, resultB] = await Promise.all([
      esbuild.build({
        entryPoints: [pageAPath],
        plugins: [useDataStaticAnalyzer()],
        write: false,
        bundle: true,
        format: 'esm',
        external: ['@getcronit/pylon-pages', 'react']
      }),
      esbuild.build({
        entryPoints: [pageBPath],
        plugins: [useDataStaticAnalyzer()],
        write: false,
        bundle: true,
        format: 'esm',
        external: ['@getcronit/pylon-pages', 'react']
      })
    ])
    const outA = resultA.outputFiles[0].text
    const outB = resultB.outputFiles[0].text
    expect(outA).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/PageA.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsxs } from "react/jsx-runtime";
      function PageA() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.user;
            v1?.firstName;
            v1?.lastName;
          }
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          data.user.firstName,
          " ",
          data.user.lastName
        ] });
      }
      export {
        PageA
      };
      "
    `)
    expect(outB).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/PageB.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsxs } from "react/jsx-runtime";
      function PageB() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.product;
            v1?.sku;
            v1?.price;
          }
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          data.product.sku,
          " - ",
          data.product.price
        ] });
      }
      export {
        PageB
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 10: Complex page with double-nested array mappings + arguments at each level
  // --------------------------------------------------------------------------
  it('should handle double-nested array mappings with arguments at each nesting level', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function OrgPage() {
        const data = useData();
        return (
          <div>
            <h1>{data.organization.name}</h1>
            {data.organization.teams({ active: true }).map(team => (
              <div>
                <h2>{team.name}</h2>
                <p>{team.lead.email}</p>
                {team.members({ role: "engineer" }).map(member => (
                  <div>
                    <span>{member.fullName}</span>
                    <span>{member.title}</span>
                    {member.contributions({ year: 2024 }).map(contrib => (
                      <p>{contrib.project} - {contrib.hours}</p>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      }
    `
    const orgPath = path.join(appDir, 'pages', 'OrgPage.tsx')
    fs.writeFileSync(orgPath, pageCode)
    const result = await esbuild.build({
      entryPoints: [orgPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/OrgPage.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx, jsxs } from "react/jsx-runtime";
      function OrgPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.organization;
            v1?.name;
            v1?.teams?.({ active: true })?.map((i1) => {
              i1?.name;
              i1?.lead?.email;
              i1?.members?.({ role: "engineer" })?.map((i2) => {
                i2?.fullName;
                i2?.title;
                i2?.contributions?.({ year: 2024 })?.map((i3) => {
                  i3?.project;
                  i3?.hours;
                });
              });
            });
          }
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h1", { children: data.organization.name }),
          data.organization.teams({ active: true }).map((team) => /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsx("h2", { children: team.name }),
            /* @__PURE__ */ jsx("p", { children: team.lead.email }),
            team.members({ role: "engineer" }).map((member) => /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("span", { children: member.fullName }),
              /* @__PURE__ */ jsx("span", { children: member.title }),
              member.contributions({ year: 2024 }).map((contrib) => /* @__PURE__ */ jsxs("p", { children: [
                contrib.project,
                " - ",
                contrib.hours
              ] }))
            ] }))
          ] }))
        ] });
      }
      export {
        OrgPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 11: Custom hook wrapping useData
  // --------------------------------------------------------------------------
  it('should handle a custom hook wrapping useData', async () => {
    // 1. Create a page that has a local custom hook that calls useData
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { UserCard } from "../components/UserCard";
      export function useUser() {
        const data = useData();
        return data.currentUser;
      }
      export default function ProfilePage() {
        const user = useUser();
        return (
          <div>
            <h1>Profile</h1>
            <UserCard user={user} />
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'ProfileWithLocalHook.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/ProfileWithLocalHook.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Avatar.tsx
      import { jsx } from "react/jsx-runtime";
      function Avatar({ user }) {
        return /* @__PURE__ */ jsx("img", { src: user.avatarUrl, alt: user.displayName });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/UserCard.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function UserCard({ user }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx2(Avatar, { user }),
          /* @__PURE__ */ jsx2("h2", { children: user.displayName }),
          /* @__PURE__ */ jsx2("p", { children: user.email })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/ProfileWithLocalHook.tsx
      import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
      function useUser() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.currentUser;
            v1?.avatarUrl;
            v1?.displayName;
            v1?.email;
          }
        });
        return data.currentUser;
      }
      function ProfilePage() {
        const user = useUser();
        return /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx3("h1", { children: "Profile" }),
          /* @__PURE__ */ jsx3(UserCard, { user })
        ] });
      }
      export {
        ProfilePage as default,
        useUser
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 12: Multiple data paths to the same component
  // --------------------------------------------------------------------------
  it('should handle multiple data paths passed to the same component', async () => {
    writeSharedComponents()
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { UserCard } from "../components/UserCard";
      export default function MultiUserPage() {
        const data = useData();
        return (
          <div>
            <UserCard user={data.sender} />
            <UserCard user={data.receiver} />
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'MultiUser.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    // Both sender and receiver paths should be collected
    expect(out).toMatchInlineSnapshot(
      `
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/MultiUser.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Avatar.tsx
      import { jsx } from "react/jsx-runtime";
      function Avatar({ user }) {
        return /* @__PURE__ */ jsx("img", { src: user.avatarUrl, alt: user.displayName });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/UserCard.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function UserCard({ user }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx2(Avatar, { user }),
          /* @__PURE__ */ jsx2("h2", { children: user.displayName }),
          /* @__PURE__ */ jsx2("p", { children: user.email })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/MultiUser.tsx
      import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
      function MultiUserPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.sender;
            v1?.avatarUrl;
            v1?.displayName;
            v1?.email;
            const v2 = query?.receiver;
            v2?.avatarUrl;
            v2?.displayName;
            v2?.email;
          }
        });
        return /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx3(UserCard, { user: data.sender }),
          /* @__PURE__ */ jsx3(UserCard, { user: data.receiver })
        ] });
      }
      export {
        MultiUserPage as default
      };
      "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 13: Conditional/Ternary JSX rendering
  // --------------------------------------------------------------------------
  it('should handle conditional and ternary JSX rendering', async () => {
    writeSharedComponents()
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { UserCard } from "../components/UserCard";
      import { PostCard } from "../components/PostCard";
      export default function ConditionalPage({ showUser }) {
        const data = useData();
        return (
          <div>
            {showUser ? (
              <UserCard user={data.profile} />
            ) : (
              <PostCard post={data.featuredPost} />
            )}
            {data.hasNotifications && (
              <div>You have mail: {data.notifications[0].title}</div>
            )}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Conditional.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text

    expect(out).toMatchInlineSnapshot(
      `
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Conditional.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Avatar.tsx
      import { jsx } from "react/jsx-runtime";
      function Avatar({ user }) {
        return /* @__PURE__ */ jsx("img", { src: user.avatarUrl, alt: user.displayName });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/UserCard.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function UserCard({ user }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx2(Avatar, { user }),
          /* @__PURE__ */ jsx2("h2", { children: user.displayName }),
          /* @__PURE__ */ jsx2("p", { children: user.email })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Badge.tsx
      import { jsx as jsx3 } from "react/jsx-runtime";
      function Badge({ label, color }) {
        return /* @__PURE__ */ jsx3("span", { style: { background: color }, children: label });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/PostCard.tsx
      import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
      function PostCard({ post }) {
        return /* @__PURE__ */ jsxs2("article", { children: [
          /* @__PURE__ */ jsx4("h3", { children: post.title }),
          /* @__PURE__ */ jsx4("p", { children: post.excerpt }),
          /* @__PURE__ */ jsx4("span", { children: post.author.name }),
          post.tags.map((tag) => /* @__PURE__ */ jsx4(Badge, { label: tag.name, color: tag.color }))
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Conditional.tsx
      import { jsx as jsx5, jsxs as jsxs3 } from "react/jsx-runtime";
      function ConditionalPage({ showUser }) {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.profile;
            v1?.avatarUrl;
            v1?.displayName;
            v1?.email;
            const v2 = query?.featuredPost;
            v2?.title;
            v2?.excerpt;
            v2?.author?.name;
            v2?.tags?.map((i1) => {
              i1?.name;
              i1?.color;
            });
            query?.hasNotifications;
            query?.notifications?.map((i1) => {
              i1?.title;
            });
          }
        });
        return /* @__PURE__ */ jsxs3("div", { children: [
          showUser ? /* @__PURE__ */ jsx5(UserCard, { user: data.profile }) : /* @__PURE__ */ jsx5(PostCard, { post: data.featuredPost }),
          data.hasNotifications && /* @__PURE__ */ jsxs3("div", { children: [
            "You have mail: ",
            data.notifications[0].title
          ] })
        ] });
      }
      export {
        ConditionalPage as default
      };
      "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 14: Barrel file re-exports
  // --------------------------------------------------------------------------
  it('should handle barrel file re-exports', async () => {
    // 1. Create multiple components
    fs.writeFileSync(
      path.join(appDir, 'components', 'A.tsx'),
      `export function ComponentA({ data }) { return <div>{data.fieldA}</div>; }`
    )
    fs.writeFileSync(
      path.join(appDir, 'components', 'B.tsx'),
      `export function ComponentB({ data }) { return <div>{data.fieldB}</div>; }`
    )
    // 2. Create barrel file (index.ts)
    fs.writeFileSync(
      path.join(appDir, 'components', 'index.ts'),
      `
      export * from "./A";
      export * from "./B";
      `
    )
    // 3. Create page importing from barrel
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { ComponentA, ComponentB } from "../components";
      export default function BarrelPage() {
        const data = useData();
        return (
          <div>
            <ComponentA data={data.partA} />
            <ComponentB data={data.partB} />
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Barrel.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    // Verify partA.fieldA and partB.fieldB are collected
    expect(out).toMatchInlineSnapshot(
      `
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Barrel.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/A.tsx
      import { jsx } from "react/jsx-runtime";
      function ComponentA({ data }) {
        return /* @__PURE__ */ jsx("div", { children: data.fieldA });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/B.tsx
      import { jsx as jsx2 } from "react/jsx-runtime";
      function ComponentB({ data }) {
        return /* @__PURE__ */ jsx2("div", { children: data.fieldB });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Barrel.tsx
      import { jsx as jsx3, jsxs } from "react/jsx-runtime";
      function BarrelPage() {
        const data = useData({
          prepare: ({ query }) => {
            query?.partA?.fieldA;
            query?.partB?.fieldB;
          }
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx3(ComponentA, { data: data.partA }),
          /* @__PURE__ */ jsx3(ComponentB, { data: data.partB })
        ] });
      }
      export {
        BarrelPage as default
      };
      "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 15: Minified build verification
  // --------------------------------------------------------------------------
  it('should work correctly with esbuild minification enabled', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function MinifiedPage() {
        const data = useData();
        return <div>{data.user.name}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Minified.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      minify: true, // Enable minification
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text

    expect(out).toMatchInlineSnapshot(`
      "import{useData as r}from"@getcronit/pylon-pages";import{jsx as n}from"react/jsx-runtime";function i(){let e=r({prepare:({query:a})=>{a?.user?.name}});return n("div",{children:e.user.name})}export{i as default};
      "
    `)
  })
  it('should handle GraphQL interfaces and unions via $on syntax', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Profile() {
        const { me } = useData();
        return (
          <>
            <h1>Hello {me.name}, you have these pets:</h1>
            <ol>
              {me.pets.map((pet) => (
                <li key={pet.id ?? "0"}>
                  {pet.name} is a {pet.__typename}
                  {pet.$on.Cat.meows && " and it meows!"}
                  {pet.$on.Dog.barks && " and it barks!"}
                </li>
              ))}
            </ol>
          </>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'ProfileWithInterfaces.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    // Verify injected selectors include $on paths
    expect(out).toMatchInlineSnapshot(
      `
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/ProfileWithInterfaces.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { Fragment, jsx, jsxs } from "react/jsx-runtime";
      function Profile() {
        const { me } = useData({
          prepare: ({ query }) => {
            const v1 = query?.me;
            v1?.name;
            v1?.pets?.map((i1) => {
              i1?.id;
              i1?.name;
              i1?.__typename;
              const v2 = i1?.$on;
              v2?.Cat?.meows;
              v2?.Dog?.barks;
            });
          }
        });
        return /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("h1", { children: [
            "Hello ",
            me.name,
            ", you have these pets:"
          ] }),
          /* @__PURE__ */ jsx("ol", { children: me.pets.map((pet) => /* @__PURE__ */ jsxs("li", { children: [
            pet.name,
            " is a ",
            pet.__typename,
            pet.$on.Cat.meows && " and it meows!",
            pet.$on.Dog.barks && " and it barks!"
          ] }, pet.id ?? "0")) })
        ] });
      }
      export {
        Profile
      };
      "
    `
    )
  })
  it('should handle polymorphic rendering with $on and sub-components', async () => {
    fs.writeFileSync(
      path.join(appDir, 'components', 'PetComponents.tsx'),
      `
      export function CatComponent({ cat }) {
        return <div>{cat.meows ? "Meow" : "Quiet"}</div>;
      }
      export function DogComponent({ dog }) {
        return <div>{dog.barks ? "Woof" : "Quiet"}</div>;
      }
      `
    )
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { CatComponent, DogComponent } from "../components/PetComponents";
      export default function Profile() {
        const { me } = useData();
        return (
          <div>
            {me.pets.map((pet) => (
              <div key={pet.id}>
                {pet.$on.Cat && <CatComponent cat={pet.$on.Cat} />}
                {pet.$on.Dog && <DogComponent dog={pet.$on.Dog} />}
              </div>
            ))}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'ProfilePolymorphic.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react']
    })
    const out = result.outputFiles[0].text
    // Verify injected selectors follow into sub-components through $on
    expect(out).toMatchInlineSnapshot(
      `
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/ProfilePolymorphic.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/PetComponents.tsx
      import { jsx } from "react/jsx-runtime";
      function CatComponent({ cat }) {
        return /* @__PURE__ */ jsx("div", { children: cat.meows ? "Meow" : "Quiet" });
      }
      function DogComponent({ dog }) {
        return /* @__PURE__ */ jsx("div", { children: dog.barks ? "Woof" : "Quiet" });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/ProfilePolymorphic.tsx
      import { jsx as jsx2, jsxs } from "react/jsx-runtime";
      function Profile() {
        const { me } = useData({
          prepare: ({ query }) => {
            query?.me?.pets?.map((i1) => {
              i1?.id;
              const v1 = i1?.$on;
              v1?.Cat?.meows;
              v1?.Dog?.barks;
            });
          }
        });
        return /* @__PURE__ */ jsx2("div", { children: me.pets.map((pet) => /* @__PURE__ */ jsxs("div", { children: [
          pet.$on.Cat && /* @__PURE__ */ jsx2(CatComponent, { cat: pet.$on.Cat }),
          pet.$on.Dog && /* @__PURE__ */ jsx2(DogComponent, { dog: pet.$on.Dog })
        ] }, pet.id)) });
      }
      export {
        Profile as default
      };
      "
    `
    )
  })
  // --------------------------------------------------------------------------
  // Test 18: Custom Hook in Separate File (Non-Bundled)
  // --------------------------------------------------------------------------
  it('should handle a custom hook in a separate file with cross-file aggregation (non-bundled)', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'userHook.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function useUser() {
        return useData().user;
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useUser } from "../hooks/userHook";
      export default function ProfilePage() {
        const user = useUser();
        return <div>{user.name} and {user.email}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'CrossFileProfile.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath, hooksPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: false,
      format: 'esm',
      outdir: 'dist'
    })
    // Check transformation of the hook file
    const hookOutputFile = result.outputFiles.find(f =>
      f.path.endsWith('userHook.js')
    )
    expect(hookOutputFile).toBeDefined()
    const hookOut = hookOutputFile!.text
    expect(hookOut).toMatchInlineSnapshot(`
      "import { useData } from "@getcronit/pylon-pages";
      function useUser() {
        return useData({
          prepare: ({ query }) => {
            const v1 = query?.user;
            v1?.name;
            v1?.email;
          }
        }).user;
      }
      export {
        useUser
      };
      "
    `)
    // Check transformation of the page file (should be valid JS)
    const pageOutputFile = result.outputFiles.find(f =>
      f.path.endsWith('CrossFileProfile.js')
    )
    expect(pageOutputFile).toBeDefined()
    // It might use React.createElement or the newer jsx/jsxs runtime depending on esbuild defaults
    expect(
      pageOutputFile!.text.includes('React.createElement') ||
        pageOutputFile!.text.includes('jsx') ||
        pageOutputFile!.text.includes('jsxs')
    ).toBe(true)
  })
  // --------------------------------------------------------------------------
  // Test 19: Multilevel Custom Hook Chain (Non-Bundled)
  // --------------------------------------------------------------------------
  it('should handle a deep chain of custom hooks across multiple files (non-bundled)', async () => {
    const apiPath = path.join(appDir, 'hooks', 'api.ts')
    const apiCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function useBase() {
        return useData();
      }
    `
    fs.writeFileSync(apiPath, apiCode)
    const hooksPath = path.join(appDir, 'hooks', 'hooks-chain.ts')
    const hooksCode = `
      import { useBase } from "./api";
      export function useProfile() {
        const data = useBase();
        return data.me;
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useProfile } from "../hooks/hooks-chain";
      export default function DeepChainPage() {
        const me = useProfile();
        return <h1>{me.displayName}</h1>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'DeepChain.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath, hooksPath, apiPath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: false,
      format: 'esm',
      outdir: 'dist'
    })
    // The injection should happen in api.ts
    const apiOutputFile = result.outputFiles.find(f =>
      f.path.endsWith('api.js')
    )
    expect(apiOutputFile).toBeDefined()
    expect(apiOutputFile!.text).toMatchInlineSnapshot(`
      "import { useData } from "@getcronit/pylon-pages";
      function useBase() {
        return useData({
          prepare: ({ query }) => {
            query?.me?.displayName;
          }
        });
      }
      export {
        useBase
      };
      "
    `)
    // hooks-chain.ts should also be processed
    const hooksOutputFile = result.outputFiles.find(f =>
      f.path.endsWith('hooks-chain.js')
    )
    expect(hooksOutputFile).toBeDefined()
  })
  // --------------------------------------------------------------------------
  // Test 20: Common JS Methods and Constructors
  // --------------------------------------------------------------------------
  it('should NOT treat common JS methods or constructors as GraphQL selectors', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function Profile() {
        const { me } = useData();
        return (
          <>
            <h1>Hello {me.name}!</h1>
            <p>Last updated at {new Date(me.updatedAt).toLocaleString()}</p>
            <div>Type: {me.type.toString()}</div>
          </>
        );
      }
    `
    const filePath = path.join(appDir, 'pages', 'JSInternals.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    // Check that name and updatedAt and type are tracked in the prepare block
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/JSInternals.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { Fragment, jsxs } from "react/jsx-runtime";
      function Profile() {
        const { me } = useData({
          prepare: ({ query }) => {
            const v1 = query?.me;
            v1?.name;
            v1?.updatedAt;
            v1?.type;
          }
        });
        return /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("h1", { children: [
            "Hello ",
            me.name,
            "!"
          ] }),
          /* @__PURE__ */ jsxs("p", { children: [
            "Last updated at ",
            new Date(me.updatedAt).toLocaleString()
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            "Type: ",
            me.type.toString()
          ] })
        ] });
      }
      export {
        Profile
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 21: Helper function returning derived value
  // --------------------------------------------------------------------------
  it('should handle query data passed to a helper function that returns a derived value', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      function formatUser(user) {
        return user.firstName + " " + user.lastName + " (" + user.email + ")";
      }
      export default function Profile() {
        const data = useData();
        return (
          <div>
            <h1>{formatUser(data.currentUser)}</h1>
            <span>Account: {data.currentUser.account.id}</span>
          </div>
        );
      }
    `
    const filePath = path.join(appDir, 'pages', 'HelperFunction.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    // Check that fields are tracked
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/HelperFunction.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx, jsxs } from "react/jsx-runtime";
      function formatUser(user) {
        return user.firstName + " " + user.lastName + " (" + user.email + ")";
      }
      function Profile() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.currentUser;
            v1?.firstName;
            v1?.lastName;
            v1?.email;
            v1?.account?.id;
          }
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h1", { children: formatUser(data.currentUser) }),
          /* @__PURE__ */ jsxs("span", { children: [
            "Account: ",
            data.currentUser.account.id
          ] })
        ] });
      }
      export {
        Profile as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 22: Aliased Imports
  // --------------------------------------------------------------------------
  it('should handle aliased useData imports', async () => {
    const inputCode = `
      import { useData as uq } from "@getcronit/pylon-pages";
      export default function App() {
        const { user } = uq();
        return <div>{user.id}</div>;
      }
    `
    const filePath = path.join(appDir, 'pages', 'AliasedImport.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/AliasedImport.tsx
      import { useData as uq } from "@getcronit/pylon-pages";
      import { jsx } from "react/jsx-runtime";
      function App() {
        const { user } = uq({
          prepare: ({ query }) => {
            query?.user?.id;
          }
        });
        return /* @__PURE__ */ jsx("div", { children: user.id });
      }
      export {
        App as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 23: Circular Hook Dependencies
  // --------------------------------------------------------------------------
  it('should handle circular hook dependencies safely', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'circular.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { useB } from "./circularB";
      export function useA() {
        const data = useData();
        const b = useB();
        return { user: data.user, b };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const hooksBPath = path.join(appDir, 'hooks', 'circularB.ts')
    const hooksBCode = `
      import { useA } from "./circular";
      export function useB() {
        // Technically this would be an infinite hook loop in React, 
        // but the static analyzer should handle it safely.
        return { name: "B" };
      }
    `
    fs.writeFileSync(hooksBPath, hooksBCode)
    const pageCode = `
      import { useA } from "../hooks/circular";
      export default function Page() {
        const a = useA();
        return <div>{a.user.username}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Circular.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/circular.ts
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/circularB.ts
      function useB() {
        return { name: "B" };
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/circular.ts
      function useA() {
        const data = useData({
          prepare: ({ query }) => {
            query?.user?.username;
          }
        });
        const b = useB();
        return { user: data.user, b };
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Circular.tsx
      import { jsx } from "react/jsx-runtime";
      function Page() {
        const a = useA();
        return /* @__PURE__ */ jsx("div", { children: a.user.username });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 24: Destructuring with Aliasing
  // --------------------------------------------------------------------------
  it('should handle destructuring with aliasing', async () => {
    const inputCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function App() {
        const { currentUser: person } = useData();
        return <div>{person.firstName}</div>;
      }
    `
    const filePath = path.join(appDir, 'pages', 'AliasDestructure.tsx')
    fs.writeFileSync(filePath, inputCode)
    const result = await esbuild.build({
      entryPoints: [filePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/AliasDestructure.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx } from "react/jsx-runtime";
      function App() {
        const { currentUser: person } = useData({
          prepare: ({ query }) => {
            query?.currentUser?.firstName;
          }
        });
        return /* @__PURE__ */ jsx("div", { children: person.firstName });
      }
      export {
        App as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 25: Object spread operator support
  // --------------------------------------------------------------------------
  it('should handle object spread operator in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'spread.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function useEnhancedUser() {
        const { user } = useData();
        return { ...user, source: "pylon" };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useEnhancedUser } from "../hooks/spread";
      export default function Page() {
        const user = useEnhancedUser();
        return <div>{user.displayName} ({user.source})</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Spread.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/spread.ts
      import { useData } from "@getcronit/pylon-pages";
      function useEnhancedUser() {
        const { user } = useData({
          prepare: ({ query }) => {
            query?.user?.displayName;
          }
        });
        return { ...user, source: "pylon" };
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Spread.tsx
      import { jsxs } from "react/jsx-runtime";
      function Page() {
        const user = useEnhancedUser();
        return /* @__PURE__ */ jsxs("div", { children: [
          user.displayName,
          " (",
          user.source,
          ")"
        ] });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 26: Complex object transformation (Shadowing + Re-mapping)
  // --------------------------------------------------------------------------
  it('should handle shadowing + re-mapping in object returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'complex.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function useEnhancedUser() {
        const { user } = useData();
        return { ...user, name: undefined, source: user.name };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useEnhancedUser } from "../hooks/complex";
      export default function Page() {
        const user = useEnhancedUser();
        return <div>{user.source} (original name)</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Complex.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/complex.ts
      import { useData } from "@getcronit/pylon-pages";
      function useEnhancedUser() {
        const { user } = useData({
          prepare: ({ query }) => {
            query?.user?.name;
          }
        });
        return { ...user, name: void 0, source: user.name };
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Complex.tsx
      import { jsxs } from "react/jsx-runtime";
      function Page() {
        const user = useEnhancedUser();
        return /* @__PURE__ */ jsxs("div", { children: [
          user.source,
          " (original name)"
        ] });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 27: Object destructuring with rest operator
  // --------------------------------------------------------------------------
  it('should handle object rest operator in destructuring', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function Page() {
        const { user, ...rest } = useData();
        return <div>{rest.meta.version}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'RestObject.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/RestObject.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx } from "react/jsx-runtime";
      function Page() {
        const { user, ...rest } = useData({
          prepare: ({ query }) => {
            query?.user;
            query?.meta?.version;
          }
        });
        return /* @__PURE__ */ jsx("div", { children: rest.meta.version });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 28: Array destructuring with rest operator
  // --------------------------------------------------------------------------
  it('should handle array rest operator in destructuring', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function Page() {
        const { posts } = useData();
        const [first, ...others] = posts;
        return (
          <ul>
            <li>{first.title}</li>
            {others.map(p => <li key={p.id}>{p.title}</li>)}
          </ul>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'RestArray.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/RestArray.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx, jsxs } from "react/jsx-runtime";
      function Page() {
        const { posts } = useData({
          prepare: ({ query }) => {
            query?.posts?.map((i1) => {
              i1?.title;
              i1?.id;
            });
          }
        });
        const [first, ...others] = posts;
        return /* @__PURE__ */ jsxs("ul", { children: [
          /* @__PURE__ */ jsx("li", { children: first.title }),
          others.map((p) => /* @__PURE__ */ jsx("li", { children: p.title }, p.id))
        ] });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 29: Default values in destructuring
  // --------------------------------------------------------------------------
  it('should handle default values in destructuring', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function Page() {
        const { user = { displayName: "Guest" } } = useData();
        return <div>Hello {user.displayName}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'DefaultValue.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/DefaultValue.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsxs } from "react/jsx-runtime";
      function Page() {
        const { user = { displayName: "Guest" } } = useData({
          prepare: ({ query }) => {
            query?.user?.displayName;
          }
        });
        return /* @__PURE__ */ jsxs("div", { children: [
          "Hello ",
          user.displayName
        ] });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 30: Nested scope cross-referencing
  // --------------------------------------------------------------------------
  it('should handle nested scope cross-referencing', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function Page() {
        const { posts } = useData();
        return (
          <div>
            {posts.map(post => (
              <div key={post.id}>
                <h2>{post.title}</h2>
                {post.comments.map(comment => (
                  <p key={comment.id}>{comment.text} - Replying to {post.title}</p>
                ))}
              </div>
            ))}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'NestedScope.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/NestedScope.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx, jsxs } from "react/jsx-runtime";
      function Page() {
        const { posts } = useData({
          prepare: ({ query }) => {
            query?.posts?.map((i1) => {
              i1?.id;
              i1?.title;
              i1?.comments?.map((i2) => {
                i2?.id;
                i2?.text;
              });
            });
          }
        });
        return /* @__PURE__ */ jsx("div", { children: posts.map((post) => /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h2", { children: post.title }),
          post.comments.map((comment) => /* @__PURE__ */ jsxs("p", { children: [
            comment.text,
            " - Replying to ",
            post.title
          ] }, comment.id))
        ] }, post.id)) });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 31: Computed property names in hook returns
  // --------------------------------------------------------------------------
  it('should handle computed property names in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'computed.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function useDynamicUser() {
        const { user } = useData();
        return { ["profile"]: user };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useDynamicUser } from "../hooks/computed";
      export default function Page() {
        const data = useDynamicUser();
        return <div>{data.profile.displayName}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Computed.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/computed.ts
      import { useData } from "@getcronit/pylon-pages";
      function useDynamicUser() {
        const { user } = useData({
          prepare: ({ query }) => {
            query?.user?.displayName;
          }
        });
        return { ["profile"]: user };
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Computed.tsx
      import { jsx } from "react/jsx-runtime";
      function Page() {
        const data = useDynamicUser();
        return /* @__PURE__ */ jsx("div", { children: data.profile.displayName });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 32: Object methods in hook returns
  // --------------------------------------------------------------------------
  it('should handle object methods in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'methods.ts')
    const hooksCode = `
      import { useData } from "@getcronit/pylon-pages";
      export function useUserActions() {
        const { user } = useData();
        return {
          getFullName: () => user.firstName + " " + user.lastName
        };
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { useUserActions } from "../hooks/methods";
      export default function Page() {
        const actions = useUserActions();
        return <div>{actions.getFullName()}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Methods.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/methods.ts
      import { useData } from "@getcronit/pylon-pages";
      function useUserActions() {
        const { user } = useData({
          prepare: ({ query }) => {
            const v1 = query?.user;
            v1?.firstName;
            v1?.lastName;
          }
        });
        return {
          getFullName: () => user.firstName + " " + user.lastName
        };
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Methods.tsx
      import { jsx } from "react/jsx-runtime";
      function Page() {
        const actions = useUserActions();
        return /* @__PURE__ */ jsx("div", { children: actions.getFullName() });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 33: Array reduce transformations
  // --------------------------------------------------------------------------
  it('should handle array.reduce in hook returns', async () => {
    const hooksPath = path.join(appDir, 'hooks', 'reduce.ts')

    const useDataCode = `
      export const useData = () => ({ posts: [{id: 1, title: 'hello'}] })
    `

    fs.writeFileSync(path.join(appDir, 'hooks', 'useData.ts'), useDataCode)

    const hooksCode = `
      import { useData } from "./useData";
      export function usePostsMap() {
        const { posts } = useData()
        return posts.reduce((acc, post) => {
          acc[post.id] = post
          return acc
        }, {})
      }
    `
    fs.writeFileSync(hooksPath, hooksCode)
    const pageCode = `
      import { usePostsMap } from "../hooks/reduce";
      export default function Page() {
        const postsById = usePostsMap();
        return <div>{postsById["123"].title}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'Reduce.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [
        useDataStaticAnalyzer({
          pylonPackage: './useData'
        })
      ],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/useData.ts
      var useData = () => ({ posts: [{ id: 1, title: "hello" }] });

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/reduce.ts
      function usePostsMap() {
        const { posts } = useData({
          prepare: ({ query }) => {
            query?.posts?.map((i1) => {
              i1?.id;
              i1?.title;
            });
          }
        });
        return posts.reduce((acc, post) => {
          acc[post.id] = post;
          return acc;
        }, {});
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/Reduce.tsx
      import { jsx } from "react/jsx-runtime";
      function Page() {
        const postsById = usePostsMap();
        return /* @__PURE__ */ jsx("div", { children: postsById["123"].title });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 34: useData with empty options object
  // --------------------------------------------------------------------------
  it('should handle useData with an empty options object', async () => {
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      export default function Page() {
        const data = useData({});
        return <div>{data.user.name}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'EmptyOptions.tsx')
    fs.writeFileSync(pagePath, pageCode)
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/EmptyOptions.tsx
      import { useData } from "@getcronit/pylon-pages";
      import { jsx } from "react/jsx-runtime";
      function Page() {
        const data = useData({
          prepare: ({ query }) => {
            query?.user?.name;
          }
        });
        return /* @__PURE__ */ jsx("div", { children: data.user.name });
      }
      export {
        Page as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 35: Multiple file example with nodes array and sub-component
  // --------------------------------------------------------------------------
  it('should handle multiple files where nodes are passed to a task component', async () => {
    // 1. Create a Task component in another file
    fs.writeFileSync(
      path.join(appDir, 'components', 'Task.tsx'),
      `
      export function Task({ node }) {
        return (
          <div>
            <span>{node.id}</span>
            <h1>{node.title}</h1>
          </div>
        );
      }
      `
    )
    // 2. Create the main page
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { Task } from "../components/Task";
      enum TaskStatus {
        TODO = "TODO",
        DONE = "DONE"
      }
      export default function TasksPage() {
        const data = useData();
        const tasks = data.tasks({
          filters: {
            status: TaskStatus.TODO,
          },
          first: 5,
        }).nodes;
        return (
          <div>
            {tasks.map(task => <Task node={task} />)}
          </div>
        );
      }
    `
    const pagePath = path.join(appDir, 'pages', 'TasksPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 3. Build the page
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/TasksPage.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Task.tsx
      import { jsx, jsxs } from "react/jsx-runtime";
      function Task({ node }) {
        return /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("span", { children: node.id }),
          /* @__PURE__ */ jsx("h1", { children: node.title })
        ] });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/TasksPage.tsx
      import { jsx as jsx2 } from "react/jsx-runtime";
      function TasksPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.tasks?.({ filters: { status: "TODO" /* TODO */ }, first: 5 });
            v1?.nodes?.map((i1) => {
              i1?.id;
              i1?.title;
            });
          }
        });
        const tasks = data.tasks({
          filters: {
            status: "TODO" /* TODO */
          },
          first: 5
        }).nodes;
        return /* @__PURE__ */ jsx2("div", { children: tasks.map((task) => /* @__PURE__ */ jsx2(Task, { node: task })) });
      }
      export {
        TasksPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 36: Multiple file example with nodes array passed as a whole
  // --------------------------------------------------------------------------
  it('should handle multiple files where the whole nodes array is passed to a component', async () => {
    // 1. Create a Tasks component in another file
    fs.writeFileSync(
      path.join(appDir, 'components', 'Tasks.tsx'),
      `
      export function Tasks({ nodes }) {
        return (
          <ul>
            {nodes.map(node => (
              <li key={node.id}>{node.title}</li>
            ))}
          </ul>
        );
      }
      `
    )
    // 2. Create the main page
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { Tasks } from "../components/Tasks";
      export default function AllTasksPage() {
        const data = useData();
        const nodes = data.tasks({ first: 10 }).nodes;
        return <Tasks nodes={nodes} />;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'AllTasksPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 3. Build the page
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/AllTasksPage.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/components/Tasks.tsx
      import { jsx } from "react/jsx-runtime";
      function Tasks({ nodes }) {
        return /* @__PURE__ */ jsx("ul", { children: nodes.map((node) => /* @__PURE__ */ jsx("li", { children: node.title }, node.id)) });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/AllTasksPage.tsx
      import { jsx as jsx2 } from "react/jsx-runtime";
      function AllTasksPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.tasks?.({ first: 10 });
            v1?.nodes?.map((i1) => {
              i1?.id;
              i1?.title;
            });
          }
        });
        const nodes = data.tasks({ first: 10 }).nodes;
        return /* @__PURE__ */ jsx2(Tasks, { nodes });
      }
      export {
        AllTasksPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 37: Alias resolution via tsconfig.json
  // --------------------------------------------------------------------------
  it('should handle alias imports by loading tsconfig from esbuild options', async () => {
    // 1. Setup directories
    const aliasAppDir = path.join(tempDir, 'alias-app')
    if (fs.existsSync(aliasAppDir))
      fs.rmSync(aliasAppDir, {recursive: true, force: true})
    fs.mkdirSync(path.join(aliasAppDir, 'components'), {recursive: true})
    fs.mkdirSync(path.join(aliasAppDir, 'pages'), {recursive: true})
    // 2. Create component
    fs.writeFileSync(
      path.join(aliasAppDir, 'components', 'UserBadge.tsx'),
      `export function UserBadge({ user }) { return <span>{user.nickname}</span>; }`
    )
    // 3. Create page with alias import
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { UserBadge } from "@/components/UserBadge";
      export default function AliasPage() {
        const data = useData();
        return <UserBadge user={data.me} />;
      }
    `
    const pagePath = path.join(aliasAppDir, 'pages', 'AliasPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 4. Create tsconfig.json
    const tsconfig = {
      compilerOptions: {
        jsx: 'react-jsx',
        baseUrl: '.',
        paths: {
          '@/*': ['./*']
        }
      }
    }
    const tsconfigPath = path.join(aliasAppDir, 'tsconfig.json')
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig))
    // 5. Build with esbuild and provide tsconfig path
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      tsconfig: tsconfigPath, // Pass the tsconfig path to esbuild
      external: ['@getcronit/pylon-pages', 'react', 'react/jsx-runtime']
    })
    const out = result.outputFiles[0].text
    expect(out).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/alias-app/pages/AliasPage.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/alias-app/components/UserBadge.tsx
      import { jsx } from "react/jsx-runtime";
      function UserBadge({ user }) {
        return /* @__PURE__ */ jsx("span", { children: user.nickname });
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_tests/alias-app/pages/AliasPage.tsx
      import { jsx as jsx2 } from "react/jsx-runtime";
      function AliasPage() {
        const data = useData({
          prepare: ({ query }) => {
            query?.me?.nickname;
          }
        });
        return /* @__PURE__ */ jsx2(UserBadge, { user: data.me });
      }
      export {
        AliasPage as default
      };
      "
    `)
  })
  // --------------------------------------------------------------------------
  // Test 38: Custom hook in separate file with cross-file aggregation
  // --------------------------------------------------------------------------
  it('should handle a custom hook in a separate file with alias and index re-export', async () => {
    // 1. Create the hook in another file
    const hookCode = `
      export function useTicketInfo({pageInfo}: {pageInfo: {totalCount: number}}) {
        pageInfo.totalCount;
        return null
      }
    `
    fs.writeFileSync(path.join(appDir, 'hooks', 'useTicketInfo.ts'), hookCode)
    // 2. Create the index file in the hooks folder
    fs.writeFileSync(
      path.join(appDir, 'hooks', 'index.ts'),
      `export * from "./useTicketInfo";`
    )
    // 3. Update tsconfig.json to include the alias
    const tsconfigPath = path.join(appDir, 'tsconfig.json')
    fs.writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            jsx: 'react-jsx',
            baseUrl: '.',
            paths: {
              '@/*': ['./*']
            }
          }
        },
        null,
        2
      )
    )
    // 4. Create the main page that imports and uses the hook via alias
    const pageCode = `
      import { useData } from "@getcronit/pylon-pages";
      import { useTicketInfo } from "@/hooks";
      export default function TicketsPage() {
        const data = useData();
        const {pageInfo} = data.tickets({})
        const total = useTicketInfo({pageInfo});
        return <div>Total tickets: {total}</div>;
      }
    `
    const pagePath = path.join(appDir, 'pages', 'TicketsPage.tsx')
    fs.writeFileSync(pagePath, pageCode)
    // 5. Build the page
    const result = await esbuild.build({
      entryPoints: [pagePath],
      plugins: [useDataStaticAnalyzer()],
      write: false,
      bundle: true,
      format: 'esm',
      tsconfig: tsconfigPath,
      external: ['@getcronit/pylon-pages', 'react']
    })
    const outputCode = result.outputFiles[0].text
    expect(outputCode).toMatchInlineSnapshot(`
      "// src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/TicketsPage.tsx
      import { useData } from "@getcronit/pylon-pages";

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/hooks/useTicketInfo.ts
      function useTicketInfo({ pageInfo }) {
        pageInfo.totalCount;
        return null;
      }

      // src/plugins/use-pages/build/plugins/use-data-static-analyzer/temp_nextjs_app/pages/TicketsPage.tsx
      import { jsxs } from "react/jsx-runtime";
      function TicketsPage() {
        const data = useData({
          prepare: ({ query }) => {
            const v1 = query?.tickets?.({});
            v1?.pageInfo?.totalCount;
          }
        });
        const { pageInfo } = data.tickets({});
        const total = useTicketInfo({ pageInfo });
        return /* @__PURE__ */ jsxs("div", { children: [
          "Total tickets: ",
          total
        ] });
      }
      export {
        TicketsPage as default
      };
      "
    `)
  })
})
