import {
  __toESM,
  require_react
} from "./chunk-B5GXU7YJ.js";

// ../../node_modules/react-ssr-prepass/dist/react-ssr-prepass.es.js
var import_react = __toESM(require_react());
function _extends() {
  _extends = Object.assign || function(e2) {
    for (var r2 = 1; r2 < arguments.length; r2++) {
      var t2 = arguments[r2];
      for (var n2 in t2) {
        if (Object.prototype.hasOwnProperty.call(t2, n2)) {
          e2[n2] = t2[n2];
        }
      }
    }
    return e2;
  };
  return _extends.apply(this, arguments);
}
var n = 60103;
var u = 60106;
var o = 60107;
var a = 60108;
var i = 60114;
var c = 60109;
var l = 60110;
var f = 60111;
var s = 60112;
var v = 60113;
var p = 60115;
var d = 60116;
if ("function" == typeof Symbol && Symbol.for) {
  m = Symbol.for;
  n = m("react.element");
  u = m("react.portal");
  o = m("react.fragment");
  a = m("react.strict_mode");
  i = m("react.profiler");
  c = m("react.provider");
  l = m("react.context");
  f = Symbol.for("react.concurrent_mode");
  s = m("react.forward_ref");
  v = m("react.suspense");
  p = m("react.memo");
  d = m("react.lazy");
}
var m;
var h = n;
var y = u;
var _ = o;
var S = a;
var x = i;
var b = c;
var M = l;
var g = f;
var k = s;
var w = v;
var E = p;
var F = d;
var I = import_react.Children.toArray;
var isAbstractElement = function(e2) {
  return null !== e2 && "object" == typeof e2;
};
var getChildrenArray = function(e2) {
  return I(e2).filter(isAbstractElement);
};
var computeProps = function(e2, r2) {
  return "object" == typeof r2 ? _extends({}, r2, e2) : e2;
};
var q = /* @__PURE__ */ new Map();
var C = {};
var D = void 0;
var R = void 0;
var getCurrentContextMap = function() {
  return _extends({}, C);
};
var getCurrentContextStore = function() {
  return new Map(q);
};
var flushPrevContextMap = function() {
  var e2 = D;
  D = void 0;
  return e2;
};
var flushPrevContextStore = function() {
  var e2 = R;
  R = void 0;
  return e2;
};
var restoreContextMap = function(e2) {
  if (void 0 !== e2) {
    _extends(C, e2);
  }
};
var restoreContextStore = function(e2) {
  if (void 0 !== e2) {
    q.set(e2[0], e2[1]);
  }
};
var setCurrentContextMap = function(e2) {
  D = void 0;
  C = e2;
};
var setCurrentContextStore = function(e2) {
  R = void 0;
  q = e2;
};
var readContextValue = function(e2) {
  var r2 = q.get(e2);
  if (void 0 !== r2) {
    return r2;
  }
  return e2._currentValue;
};
var O = {};
var maskContext = function(e2) {
  var r2 = e2.contextType;
  var t2 = e2.contextTypes;
  if (r2) {
    return readContextValue(r2);
  } else if (!t2) {
    return O;
  }
  var n2 = {};
  for (var u2 in t2) {
    n2[u2] = C[u2];
  }
  return n2;
};
var P = null;
var getCurrentErrorFrame = function() {
  return P;
};
var setCurrentErrorFrame = function(e2) {
  P = e2 || null;
};
var z = {
  current: {
    uniqueID: 0
  }
};
var W = "function" == typeof Object.is ? Object.is : function is(e2, r2) {
  return e2 === r2 && (0 !== e2 || 1 / e2 == 1 / r2) || e2 != e2 && r2 != r2;
};
var N = null;
var setCurrentIdentity = function(e2) {
  N = e2;
};
var getCurrentIdentity = function() {
  if (null === N) {
    throw new Error("[react-ssr-prepass] Hooks can only be called inside the body of a function component. (https://fb.me/react-invalid-hook-call)");
  }
  return N;
};
var T = null;
var j = null;
var A = false;
var U = null;
var H = 0;
var setFirstHook = function(e2) {
  T = e2;
};
function createWorkInProgressHook() {
  if (null === j) {
    if (null === T) {
      return T = j = {
        memoizedState: null,
        queue: null,
        next: null
      };
    } else {
      return j = T;
    }
  } else if (null === j.next) {
    return j = j.next = {
      memoizedState: null,
      queue: null,
      next: null
    };
  } else {
    return j = j.next;
  }
}
function basicStateReducer(e2, r2) {
  return "function" == typeof r2 ? r2(e2) : r2;
}
function useReducer(e2, r2, t2) {
  var n2 = getCurrentIdentity();
  if (null === (j = createWorkInProgressHook()).queue) {
    var u2;
    if (e2 === basicStateReducer) {
      u2 = "function" == typeof r2 ? r2() : r2;
    } else {
      u2 = void 0 !== t2 ? t2(r2) : r2;
    }
    j.memoizedState = u2;
  }
  var o2 = j.queue || (j.queue = {
    last: null,
    dispatch: null
  });
  var a2 = o2.dispatch || (o2.dispatch = dispatchAction.bind(null, n2, o2));
  if (null !== U) {
    var i2 = U.get(o2);
    if (void 0 !== i2) {
      U.delete(o2);
      var c2 = j.memoizedState;
      var l2 = i2;
      do {
        c2 = e2(c2, l2.action);
        l2 = l2.next;
      } while (null !== l2);
      j.memoizedState = c2;
    }
  }
  return [j.memoizedState, a2];
}
function useMemo(e2, r2) {
  getCurrentIdentity();
  var t2 = void 0 === r2 ? null : r2;
  var n2 = (j = createWorkInProgressHook()).memoizedState;
  if (null !== n2 && null !== t2) {
    if (function areHookInputsEqual(e3, r3) {
      if (null === r3) {
        return false;
      }
      for (var t3 = 0; t3 < r3.length && t3 < e3.length; t3++) {
        if (!W(e3[t3], r3[t3])) {
          return false;
        }
      }
      return true;
    }(t2, n2[1])) {
      return n2[0];
    }
  }
  var u2 = e2();
  j.memoizedState = [u2, t2];
  return u2;
}
function useOpaqueIdentifier() {
  getCurrentIdentity();
  if (!(j = createWorkInProgressHook()).memoizedState) {
    j.memoizedState = "R:" + (z.current.uniqueID++).toString(36);
  }
  return j.memoizedState;
}
function dispatchAction(e2, r2, t2) {
  if (e2 === N) {
    A = true;
    var n2 = {
      action: t2,
      next: null
    };
    if (null === U) {
      U = /* @__PURE__ */ new Map();
    }
    var u2 = U.get(r2);
    if (void 0 === u2) {
      U.set(r2, n2);
    } else {
      var o2 = u2;
      while (null !== o2.next) {
        o2 = o2.next;
      }
      o2.next = n2;
    }
  }
}
function noop() {
}
function _ref$2(e2) {
  e2();
}
var $ = {
  readContext: function readContext(e2, r2) {
    return readContextValue(e2);
  },
  useSyncExternalStore: function useSyncExternalStore(e2, r2, t2) {
    return r2();
  },
  useContext: function useContext(e2, r2) {
    getCurrentIdentity();
    return readContextValue(e2);
  },
  useMemo,
  useReducer,
  useRef: function useRef(e2) {
    getCurrentIdentity();
    var r2 = (j = createWorkInProgressHook()).memoizedState;
    if (null === r2) {
      var t2 = {
        current: e2
      };
      j.memoizedState = t2;
      return t2;
    } else {
      return r2;
    }
  },
  useState: function useState(e2) {
    return useReducer(basicStateReducer, e2);
  },
  useCallback: function useCallback(e2, r2) {
    return useMemo(function() {
      return e2;
    }, r2);
  },
  useMutableSource: function useMutableSource(e2, r2, t2) {
    getCurrentIdentity();
    return r2(e2._source);
  },
  useTransition: function useTransition() {
    return [_ref$2, false];
  },
  useDeferredValue: function useDeferredValue(e2) {
    return e2;
  },
  useOpaqueIdentifier,
  useId: useOpaqueIdentifier,
  unstable_useId: useOpaqueIdentifier,
  unstable_useOpaqueIdentifier: useOpaqueIdentifier,
  useLayoutEffect: noop,
  useImperativeHandle: noop,
  useEffect: noop,
  useDebugValue: noop
};
var resolve = function(e2) {
  var r2 = e2._payload || e2;
  if (0 === r2._status) {
    return r2._result;
  } else if (1 === r2._status) {
    return Promise.resolve(r2._result);
  } else if (2 === r2._status) {
    return Promise.reject(r2._result);
  }
  r2._status = 0;
  return r2._result = (r2._ctor || r2._result)().then(function(e3) {
    r2._result = e3;
    if ("function" == typeof e3) {
      r2._status = 1;
    } else if (null !== e3 && "object" == typeof e3 && "function" == typeof e3.default) {
      r2._result = e3.default;
      r2._status = 1;
    } else {
      r2._status = 2;
    }
  }).catch(function(e3) {
    r2._status = 2;
    r2._result = e3;
    return Promise.reject(e3);
  });
};
var render$3 = function(e2, r2, n2) {
  var u2 = e2._payload || e2;
  if (1 === u2._status) {
    return (0, import_react.createElement)(u2._result, r2);
  }
  return null;
};
var makeFrame$1 = function(e2, r2, t2) {
  return {
    contextMap: getCurrentContextMap(),
    contextStore: getCurrentContextStore(),
    id: getCurrentIdentity(),
    hook: T,
    kind: "frame.hooks",
    errorFrame: getCurrentErrorFrame(),
    thenable: t2,
    props: r2,
    type: e2
  };
};
var render$2 = function(e2, r2, t2) {
  try {
    return function renderWithHooks(e3, r3, t3) {
      j = null;
      var n2 = e3(r3, t3);
      while (H < 25 && A) {
        A = false;
        H += 1;
        j = null;
        n2 = e3(r3, t3);
      }
      H = 0;
      U = null;
      j = null;
      return n2;
    }(e2, computeProps(r2, e2.defaultProps), maskContext(e2));
  } catch (n2) {
    if ("function" != typeof n2.then) {
      throw n2;
    }
    t2.push(makeFrame$1(e2, r2, n2));
    return null;
  }
};
function _ref$1() {
  return false;
}
function _ref2() {
  return null;
}
var createInstance = function(e2, r2) {
  var t2 = {
    _thrown: 0,
    queue: n2 = [],
    isMounted: _ref$1,
    enqueueForceUpdate: _ref2,
    enqueueReplaceState: function(e3, r3) {
      if (e3._isMounted) {
        n2.length = 0;
        n2.push(r3);
      }
    },
    enqueueSetState: function(e3, r3) {
      if (e3._isMounted) {
        n2.push(r3);
      }
    }
  };
  var n2;
  var u2 = computeProps(r2, e2.defaultProps);
  var o2 = maskContext(e2);
  var a2 = new e2(u2, o2, t2);
  a2.props = u2;
  a2.context = o2;
  a2.updater = t2;
  a2._isMounted = true;
  if (void 0 === a2.state) {
    a2.state = null;
  }
  if ("function" == typeof a2.componentDidCatch || "function" == typeof e2.getDerivedStateFromError) {
    var i2 = makeFrame(e2, a2, null);
    i2.errorFrame = i2;
    setCurrentErrorFrame(i2);
  }
  if ("function" == typeof e2.getDerivedStateFromProps) {
    var c2 = (0, e2.getDerivedStateFromProps)(a2.props, a2.state);
    if (null != c2) {
      a2.state = _extends({}, a2.state, c2);
    }
  } else if ("function" == typeof a2.componentWillMount) {
    a2.componentWillMount();
  } else if ("function" == typeof a2.UNSAFE_componentWillMount) {
    a2.UNSAFE_componentWillMount();
  }
  return a2;
};
var makeFrame = function(e2, r2, t2) {
  return {
    contextMap: getCurrentContextMap(),
    contextStore: getCurrentContextStore(),
    errorFrame: getCurrentErrorFrame(),
    thenable: t2,
    kind: "frame.class",
    error: null,
    instance: r2,
    type: e2
  };
};
var render$1 = function(e2, r2, t2) {
  !function(e3) {
    var r3 = e3.updater.queue;
    if (r3.length > 0) {
      var t3 = _extends({}, e3.state);
      for (var n3 = 0, u3 = r3.length; n3 < u3; n3++) {
        var o2 = r3[n3];
        var a2 = "function" == typeof o2 ? o2.call(e3, t3, e3.props, e3.context) : o2;
        if (null !== a2) {
          _extends(t3, a2);
        }
      }
      e3.state = t3;
      r3.length = 0;
    }
  }(r2);
  var n2 = null;
  try {
    n2 = r2.render();
  } catch (n3) {
    if ("function" != typeof n3.then) {
      throw n3;
    }
    t2.push(makeFrame(e2, r2, n3));
    return null;
  }
  if (void 0 !== e2.childContextTypes && "function" == typeof r2.getChildContext) {
    var u2 = r2.getChildContext();
    if (null !== u2 && "object" == typeof u2) {
      !function(e3) {
        D = {};
        for (var r3 in e3) {
          D[r3] = C[r3];
          C[r3] = e3[r3];
        }
      }(u2);
    }
  }
  if ("function" != typeof r2.getDerivedStateFromProps && ("function" == typeof r2.componentWillMount || "function" == typeof r2.UNSAFE_componentWillMount) && "function" == typeof r2.componentWillUnmount) {
    try {
      r2.componentWillUnmount();
    } catch (e3) {
    }
  }
  r2._isMounted = false;
  return n2;
};
var L = (import_react.default.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED || import_react.default.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE).ReactCurrentDispatcher;
var V = "function" == typeof setImmediate;
var render = function(e2, r2, t2, n2, u2) {
  return (o2 = e2).prototype && o2.prototype.isReactComponent ? function(e3, r3, t3, n3, u3) {
    setCurrentIdentity(null);
    var o3 = createInstance(e3, r3);
    var a2 = n3(u3, o3);
    if (a2) {
      t3.push(makeFrame(e3, o3, a2));
      return null;
    }
    return render$1(e3, o3, t3);
  }(e2, r2, t2, n2, u2) : function(e3, r3, t3, n3, u3) {
    setFirstHook(null);
    setCurrentIdentity({});
    var o3 = n3(u3);
    if (o3) {
      t3.push(makeFrame$1(e3, r3, o3));
      return null;
    }
    return render$2(e3, r3, t3);
  }(e2, r2, t2, n2, u2);
  var o2;
};
var visitElement = function(e2, r2, n2) {
  switch (function(e3) {
    switch (e3.$$typeof) {
      case y:
        return y;
      case h:
        switch (e3.type) {
          case g:
            return g;
          case _:
            return _;
          case x:
            return x;
          case S:
            return S;
          case w:
            return w;
          default:
            switch (e3.type && e3.type.$$typeof) {
              case F:
                return F;
              case E:
                return E;
              case M:
                return M;
              case b:
                return b;
              case k:
                return k;
              default:
                return h;
            }
        }
      default:
        return;
    }
  }(e2)) {
    case w:
    case S:
    case g:
    case x:
    case _:
      return getChildrenArray(e2.props.children);
    case b:
      var u2 = e2.props;
      var o2 = u2.children;
      !function(e3, r3) {
        R = [e3, q.get(e3)];
        q.set(e3, r3);
      }(e2.type._context, u2.value);
      return getChildrenArray(o2);
    case M:
      var a2 = e2.props.children;
      if ("function" == typeof a2) {
        var i2 = e2.type;
        var c2 = readContextValue("object" == typeof i2._context ? i2._context : i2);
        return getChildrenArray(a2(c2));
      } else {
        return [];
      }
    case F:
      var l2 = function(e3, r3, t2) {
        if ((e3._payload || e3)._status <= 0) {
          t2.push({
            kind: "frame.lazy",
            contextMap: getCurrentContextMap(),
            contextStore: getCurrentContextStore(),
            errorFrame: getCurrentErrorFrame(),
            thenable: resolve(e3),
            props: r3,
            type: e3
          });
          return null;
        }
        return render$3(e3, r3);
      }(e2.type, e2.props, r2);
      return getChildrenArray(l2);
    case E:
      var f2 = (0, import_react.createElement)(e2.type.type, e2.props);
      return getChildrenArray(f2);
    case k:
      var s2 = e2.type;
      var v2 = s2.render;
      var p2 = computeProps(e2.props, s2.defaultProps);
      var d2 = (0, import_react.createElement)(v2, p2);
      return getChildrenArray(d2);
    case h:
      if ("string" == typeof e2.type) {
        return getChildrenArray(e2.props.children);
      } else {
        var m = render(e2.type, e2.props, r2, n2, e2);
        return getChildrenArray(m);
      }
    default:
      return [];
  }
};
var visitLoop = function(e2, r2, t2, n2, u2, o2) {
  var a2 = L.current;
  var i2 = Date.now();
  try {
    L.current = $;
    while (e2.length > 0) {
      var c2 = e2[e2.length - 1].shift();
      if (void 0 !== c2) {
        var l2 = visitElement(c2, u2, o2);
        e2.push(l2);
        r2.push(flushPrevContextMap());
        t2.push(flushPrevContextStore());
        n2.push(getCurrentErrorFrame());
      } else {
        e2.pop();
        restoreContextMap(r2.pop());
        restoreContextStore(t2.pop());
        setCurrentErrorFrame(n2.pop());
      }
      if (V && Date.now() - i2 > 5) {
        return true;
      }
    }
    return false;
  } catch (e3) {
    var f2 = getCurrentErrorFrame();
    if (!f2) {
      throw e3;
    }
    f2.error = e3;
    u2.unshift(f2);
    return false;
  } finally {
    L.current = a2;
  }
};
var makeYieldFrame = function(e2, r2, t2, n2) {
  return {
    contextMap: getCurrentContextMap(),
    contextStore: getCurrentContextStore(),
    errorFrame: getCurrentErrorFrame(),
    thenable: null,
    kind: "frame.yield",
    traversalChildren: e2,
    traversalMap: r2,
    traversalStore: t2,
    traversalErrorFrame: n2
  };
};
var visit = function(e2, r2, t2) {
  var n2 = [e2];
  var u2 = [flushPrevContextMap()];
  var o2 = [flushPrevContextStore()];
  var a2 = [getCurrentErrorFrame()];
  if (visitLoop(n2, u2, o2, a2, r2, t2)) {
    r2.unshift(makeYieldFrame(n2, u2, o2, a2));
  }
};
var update = function(e2, r2, t2) {
  if ("frame.yield" === e2.kind) {
    setCurrentIdentity(null);
    setCurrentContextMap(e2.contextMap);
    setCurrentContextStore(e2.contextStore);
    setCurrentErrorFrame(e2.errorFrame);
    if (visitLoop(e2.traversalChildren, e2.traversalMap, e2.traversalStore, e2.traversalErrorFrame, r2, t2)) {
      r2.unshift(makeYieldFrame(e2.traversalChildren, e2.traversalMap, e2.traversalStore, e2.traversalErrorFrame));
    }
  } else {
    var n2 = L.current;
    var u2 = null;
    L.current = $;
    try {
      if ("frame.class" === e2.kind) {
        u2 = function(e3, r3) {
          setCurrentIdentity(null);
          setCurrentContextMap(r3.contextMap);
          setCurrentContextStore(r3.contextStore);
          setCurrentErrorFrame(r3.errorFrame);
          if (r3.error) {
            if (++r3.instance.updater._thrown >= 25) {
              return null;
            }
            r3.instance._isMounted = true;
            if ("function" == typeof r3.instance.componentDidCatch) {
              r3.instance.componentDidCatch(r3.error);
            }
            if ("function" == typeof r3.type.getDerivedStateFromError) {
              r3.instance.updater.enqueueSetState(r3.instance, r3.type.getDerivedStateFromError(r3.error));
            }
          }
          return render$1(r3.type, r3.instance, e3);
        }(r2, e2);
      } else if ("frame.hooks" === e2.kind) {
        u2 = function(e3, r3) {
          setFirstHook(r3.hook);
          setCurrentIdentity(r3.id);
          setCurrentContextMap(r3.contextMap);
          setCurrentContextStore(r3.contextStore);
          setCurrentErrorFrame(r3.errorFrame);
          return render$2(r3.type, r3.props, e3);
        }(r2, e2);
      } else if ("frame.lazy" === e2.kind) {
        u2 = function(e3, r3) {
          setCurrentIdentity(null);
          setCurrentContextMap(r3.contextMap);
          setCurrentContextStore(r3.contextStore);
          setCurrentErrorFrame(r3.errorFrame);
          return render$3(r3.type, r3.props);
        }(0, e2);
      }
    } catch (e3) {
      var o2 = getCurrentErrorFrame();
      if (!o2) {
        throw e3;
      }
      o2.error = e3;
      r2.unshift(o2);
      u2 = null;
    } finally {
      L.current = n2;
    }
    visit(getChildrenArray(u2), r2, t2);
  }
};
function _ref(e2, r2) {
  setImmediate(e2);
}
var flushFrames = function(e2, r2, t2) {
  var n2 = e2.shift();
  if (!n2) {
    return Promise.resolve();
  }
  if (V && "frame.yield" === n2.kind) {
    n2.thenable = new Promise(_ref);
  }
  return Promise.resolve(n2.thenable).then(function() {
    !function(e3) {
      z.current = e3;
    }(t2);
    update(n2, e2, r2);
    return flushFrames(e2, r2, t2);
  }, function(t3) {
    if (!n2.errorFrame) {
      throw t3;
    }
    n2.errorFrame.error = t3;
    update(n2.errorFrame, e2, r2);
  });
};
var defaultVisitor = function() {
  return;
};
var renderPrepass = function(e2, r2) {
  if (!r2) {
    r2 = defaultVisitor;
  }
  var t2 = [];
  var n2 = z.current = {
    uniqueID: 0
  };
  setCurrentContextMap({});
  setCurrentContextStore(/* @__PURE__ */ new Map());
  setCurrentErrorFrame(null);
  try {
    visit(getChildrenArray(e2), t2, r2);
  } catch (e3) {
    return Promise.reject(e3);
  }
  return flushFrames(t2, r2, n2);
};
export {
  renderPrepass as default
};
