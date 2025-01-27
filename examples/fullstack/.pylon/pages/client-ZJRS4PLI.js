import {
  require_server_browser
} from "./chunk-ORROUJIO.js";
import "./chunk-VN5JDORZ.js";
import {
  __commonJS,
  __export,
  __require,
  __toESM,
  require_react
} from "./chunk-B5GXU7YJ.js";

// ../../node_modules/object-hash/dist/object_hash.js
var require_object_hash = __commonJS({
  "../../node_modules/object-hash/dist/object_hash.js"(exports, module) {
    !function(e) {
      var t;
      "object" == typeof exports ? module.exports = e() : "function" == typeof define && define.amd ? define(e) : ("undefined" != typeof window ? t = window : "undefined" != typeof global ? t = global : "undefined" != typeof self && (t = self), t.objectHash = e());
    }(function() {
      return function r(o, i, u) {
        function s(n, e2) {
          if (!i[n]) {
            if (!o[n]) {
              var t = "function" == typeof __require && __require;
              if (!e2 && t) return t(n, true);
              if (a) return a(n, true);
              throw new Error("Cannot find module '" + n + "'");
            }
            e2 = i[n] = { exports: {} };
            o[n][0].call(e2.exports, function(e3) {
              var t2 = o[n][1][e3];
              return s(t2 || e3);
            }, e2, e2.exports, r, o, i, u);
          }
          return i[n].exports;
        }
        for (var a = "function" == typeof __require && __require, e = 0; e < u.length; e++) s(u[e]);
        return s;
      }({ 1: [function(w, b, m) {
        !function(e, n, s, c, d, h, p, g, y) {
          "use strict";
          var r = w("crypto");
          function t(e2, t2) {
            t2 = u(e2, t2);
            var n2;
            return void 0 === (n2 = "passthrough" !== t2.algorithm ? r.createHash(t2.algorithm) : new l()).write && (n2.write = n2.update, n2.end = n2.update), f(t2, n2).dispatch(e2), n2.update || n2.end(""), n2.digest ? n2.digest("buffer" === t2.encoding ? void 0 : t2.encoding) : (e2 = n2.read(), "buffer" !== t2.encoding ? e2.toString(t2.encoding) : e2);
          }
          (m = b.exports = t).sha1 = function(e2) {
            return t(e2);
          }, m.keys = function(e2) {
            return t(e2, { excludeValues: true, algorithm: "sha1", encoding: "hex" });
          }, m.MD5 = function(e2) {
            return t(e2, { algorithm: "md5", encoding: "hex" });
          }, m.keysMD5 = function(e2) {
            return t(e2, { algorithm: "md5", encoding: "hex", excludeValues: true });
          };
          var o = r.getHashes ? r.getHashes().slice() : ["sha1", "md5"], i = (o.push("passthrough"), ["buffer", "hex", "binary", "base64"]);
          function u(e2, t2) {
            var n2 = {};
            if (n2.algorithm = (t2 = t2 || {}).algorithm || "sha1", n2.encoding = t2.encoding || "hex", n2.excludeValues = !!t2.excludeValues, n2.algorithm = n2.algorithm.toLowerCase(), n2.encoding = n2.encoding.toLowerCase(), n2.ignoreUnknown = true === t2.ignoreUnknown, n2.respectType = false !== t2.respectType, n2.respectFunctionNames = false !== t2.respectFunctionNames, n2.respectFunctionProperties = false !== t2.respectFunctionProperties, n2.unorderedArrays = true === t2.unorderedArrays, n2.unorderedSets = false !== t2.unorderedSets, n2.unorderedObjects = false !== t2.unorderedObjects, n2.replacer = t2.replacer || void 0, n2.excludeKeys = t2.excludeKeys || void 0, void 0 === e2) throw new Error("Object argument required.");
            for (var r2 = 0; r2 < o.length; ++r2) o[r2].toLowerCase() === n2.algorithm.toLowerCase() && (n2.algorithm = o[r2]);
            if (-1 === o.indexOf(n2.algorithm)) throw new Error('Algorithm "' + n2.algorithm + '"  not supported. supported values: ' + o.join(", "));
            if (-1 === i.indexOf(n2.encoding) && "passthrough" !== n2.algorithm) throw new Error('Encoding "' + n2.encoding + '"  not supported. supported values: ' + i.join(", "));
            return n2;
          }
          function a(e2) {
            if ("function" == typeof e2) return null != /^function\s+\w*\s*\(\s*\)\s*{\s+\[native code\]\s+}$/i.exec(Function.prototype.toString.call(e2));
          }
          function f(o2, t2, i2) {
            i2 = i2 || [];
            function u2(e2) {
              return t2.update ? t2.update(e2, "utf8") : t2.write(e2, "utf8");
            }
            return { dispatch: function(e2) {
              return this["_" + (null === (e2 = o2.replacer ? o2.replacer(e2) : e2) ? "null" : typeof e2)](e2);
            }, _object: function(t3) {
              var n2, e2 = Object.prototype.toString.call(t3), r2 = /\[object (.*)\]/i.exec(e2);
              r2 = (r2 = r2 ? r2[1] : "unknown:[" + e2 + "]").toLowerCase();
              if (0 <= (e2 = i2.indexOf(t3))) return this.dispatch("[CIRCULAR:" + e2 + "]");
              if (i2.push(t3), void 0 !== s && s.isBuffer && s.isBuffer(t3)) return u2("buffer:"), u2(t3);
              if ("object" === r2 || "function" === r2 || "asyncfunction" === r2) return e2 = Object.keys(t3), o2.unorderedObjects && (e2 = e2.sort()), false === o2.respectType || a(t3) || e2.splice(0, 0, "prototype", "__proto__", "constructor"), o2.excludeKeys && (e2 = e2.filter(function(e3) {
                return !o2.excludeKeys(e3);
              })), u2("object:" + e2.length + ":"), n2 = this, e2.forEach(function(e3) {
                n2.dispatch(e3), u2(":"), o2.excludeValues || n2.dispatch(t3[e3]), u2(",");
              });
              if (!this["_" + r2]) {
                if (o2.ignoreUnknown) return u2("[" + r2 + "]");
                throw new Error('Unknown object type "' + r2 + '"');
              }
              this["_" + r2](t3);
            }, _array: function(e2, t3) {
              t3 = void 0 !== t3 ? t3 : false !== o2.unorderedArrays;
              var n2 = this;
              if (u2("array:" + e2.length + ":"), !t3 || e2.length <= 1) return e2.forEach(function(e3) {
                return n2.dispatch(e3);
              });
              var r2 = [], t3 = e2.map(function(e3) {
                var t4 = new l(), n3 = i2.slice();
                return f(o2, t4, n3).dispatch(e3), r2 = r2.concat(n3.slice(i2.length)), t4.read().toString();
              });
              return i2 = i2.concat(r2), t3.sort(), this._array(t3, false);
            }, _date: function(e2) {
              return u2("date:" + e2.toJSON());
            }, _symbol: function(e2) {
              return u2("symbol:" + e2.toString());
            }, _error: function(e2) {
              return u2("error:" + e2.toString());
            }, _boolean: function(e2) {
              return u2("bool:" + e2.toString());
            }, _string: function(e2) {
              u2("string:" + e2.length + ":"), u2(e2.toString());
            }, _function: function(e2) {
              u2("fn:"), a(e2) ? this.dispatch("[native]") : this.dispatch(e2.toString()), false !== o2.respectFunctionNames && this.dispatch("function-name:" + String(e2.name)), o2.respectFunctionProperties && this._object(e2);
            }, _number: function(e2) {
              return u2("number:" + e2.toString());
            }, _xml: function(e2) {
              return u2("xml:" + e2.toString());
            }, _null: function() {
              return u2("Null");
            }, _undefined: function() {
              return u2("Undefined");
            }, _regexp: function(e2) {
              return u2("regex:" + e2.toString());
            }, _uint8array: function(e2) {
              return u2("uint8array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _uint8clampedarray: function(e2) {
              return u2("uint8clampedarray:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _int8array: function(e2) {
              return u2("int8array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _uint16array: function(e2) {
              return u2("uint16array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _int16array: function(e2) {
              return u2("int16array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _uint32array: function(e2) {
              return u2("uint32array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _int32array: function(e2) {
              return u2("int32array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _float32array: function(e2) {
              return u2("float32array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _float64array: function(e2) {
              return u2("float64array:"), this.dispatch(Array.prototype.slice.call(e2));
            }, _arraybuffer: function(e2) {
              return u2("arraybuffer:"), this.dispatch(new Uint8Array(e2));
            }, _url: function(e2) {
              return u2("url:" + e2.toString());
            }, _map: function(e2) {
              u2("map:");
              e2 = Array.from(e2);
              return this._array(e2, false !== o2.unorderedSets);
            }, _set: function(e2) {
              u2("set:");
              e2 = Array.from(e2);
              return this._array(e2, false !== o2.unorderedSets);
            }, _file: function(e2) {
              return u2("file:"), this.dispatch([e2.name, e2.size, e2.type, e2.lastModfied]);
            }, _blob: function() {
              if (o2.ignoreUnknown) return u2("[blob]");
              throw Error('Hashing Blob objects is currently not supported\n(see https://github.com/puleos/object-hash/issues/26)\nUse "options.replacer" or "options.ignoreUnknown"\n');
            }, _domwindow: function() {
              return u2("domwindow");
            }, _bigint: function(e2) {
              return u2("bigint:" + e2.toString());
            }, _process: function() {
              return u2("process");
            }, _timer: function() {
              return u2("timer");
            }, _pipe: function() {
              return u2("pipe");
            }, _tcp: function() {
              return u2("tcp");
            }, _udp: function() {
              return u2("udp");
            }, _tty: function() {
              return u2("tty");
            }, _statwatcher: function() {
              return u2("statwatcher");
            }, _securecontext: function() {
              return u2("securecontext");
            }, _connection: function() {
              return u2("connection");
            }, _zlib: function() {
              return u2("zlib");
            }, _context: function() {
              return u2("context");
            }, _nodescript: function() {
              return u2("nodescript");
            }, _httpparser: function() {
              return u2("httpparser");
            }, _dataview: function() {
              return u2("dataview");
            }, _signal: function() {
              return u2("signal");
            }, _fsevent: function() {
              return u2("fsevent");
            }, _tlswrap: function() {
              return u2("tlswrap");
            } };
          }
          function l() {
            return { buf: "", write: function(e2) {
              this.buf += e2;
            }, end: function(e2) {
              this.buf += e2;
            }, read: function() {
              return this.buf;
            } };
          }
          m.writeToStream = function(e2, t2, n2) {
            return void 0 === n2 && (n2 = t2, t2 = {}), f(t2 = u(e2, t2), n2).dispatch(e2);
          };
        }.call(this, w("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, w("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/fake_9a5aa49d.js", "/");
      }, { buffer: 3, crypto: 5, lYpoI2: 11 }], 2: [function(e, t, f) {
        !function(e2, t2, n, r, o, i, u, s, a) {
          !function(e3) {
            "use strict";
            var a2 = "undefined" != typeof Uint8Array ? Uint8Array : Array, t3 = "+".charCodeAt(0), n2 = "/".charCodeAt(0), r2 = "0".charCodeAt(0), o2 = "a".charCodeAt(0), i2 = "A".charCodeAt(0), u2 = "-".charCodeAt(0), s2 = "_".charCodeAt(0);
            function f2(e4) {
              e4 = e4.charCodeAt(0);
              return e4 === t3 || e4 === u2 ? 62 : e4 === n2 || e4 === s2 ? 63 : e4 < r2 ? -1 : e4 < r2 + 10 ? e4 - r2 + 26 + 26 : e4 < i2 + 26 ? e4 - i2 : e4 < o2 + 26 ? e4 - o2 + 26 : void 0;
            }
            e3.toByteArray = function(e4) {
              var t4, n3;
              if (0 < e4.length % 4) throw new Error("Invalid string. Length must be a multiple of 4");
              var r3 = e4.length, r3 = "=" === e4.charAt(r3 - 2) ? 2 : "=" === e4.charAt(r3 - 1) ? 1 : 0, o3 = new a2(3 * e4.length / 4 - r3), i3 = 0 < r3 ? e4.length - 4 : e4.length, u3 = 0;
              function s3(e5) {
                o3[u3++] = e5;
              }
              for (t4 = 0; t4 < i3; t4 += 4, 0) s3((16711680 & (n3 = f2(e4.charAt(t4)) << 18 | f2(e4.charAt(t4 + 1)) << 12 | f2(e4.charAt(t4 + 2)) << 6 | f2(e4.charAt(t4 + 3)))) >> 16), s3((65280 & n3) >> 8), s3(255 & n3);
              return 2 == r3 ? s3(255 & (n3 = f2(e4.charAt(t4)) << 2 | f2(e4.charAt(t4 + 1)) >> 4)) : 1 == r3 && (s3((n3 = f2(e4.charAt(t4)) << 10 | f2(e4.charAt(t4 + 1)) << 4 | f2(e4.charAt(t4 + 2)) >> 2) >> 8 & 255), s3(255 & n3)), o3;
            }, e3.fromByteArray = function(e4) {
              var t4, n3, r3, o3, i3 = e4.length % 3, u3 = "";
              function s3(e5) {
                return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charAt(e5);
              }
              for (t4 = 0, r3 = e4.length - i3; t4 < r3; t4 += 3) n3 = (e4[t4] << 16) + (e4[t4 + 1] << 8) + e4[t4 + 2], u3 += s3((o3 = n3) >> 18 & 63) + s3(o3 >> 12 & 63) + s3(o3 >> 6 & 63) + s3(63 & o3);
              switch (i3) {
                case 1:
                  u3 = (u3 += s3((n3 = e4[e4.length - 1]) >> 2)) + s3(n3 << 4 & 63) + "==";
                  break;
                case 2:
                  u3 = (u3 = (u3 += s3((n3 = (e4[e4.length - 2] << 8) + e4[e4.length - 1]) >> 10)) + s3(n3 >> 4 & 63)) + s3(n3 << 2 & 63) + "=";
              }
              return u3;
            };
          }(void 0 === f ? this.base64js = {} : f);
        }.call(this, e("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, e("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/base64-js/lib/b64.js", "/node_modules/gulp-browserify/node_modules/base64-js/lib");
      }, { buffer: 3, lYpoI2: 11 }], 3: [function(O, e, H) {
        !function(e2, n, f, r, h, p, g, y, w) {
          var a = O("base64-js"), i = O("ieee754");
          function f(e3, t2, n2) {
            if (!(this instanceof f)) return new f(e3, t2, n2);
            var r2, o2, i2, u2, s2 = typeof e3;
            if ("base64" === t2 && "string" == s2) for (e3 = (u2 = e3).trim ? u2.trim() : u2.replace(/^\s+|\s+$/g, ""); e3.length % 4 != 0; ) e3 += "=";
            if ("number" == s2) r2 = j(e3);
            else if ("string" == s2) r2 = f.byteLength(e3, t2);
            else {
              if ("object" != s2) throw new Error("First argument needs to be a number, array or string.");
              r2 = j(e3.length);
            }
            if (f._useTypedArrays ? o2 = f._augment(new Uint8Array(r2)) : ((o2 = this).length = r2, o2._isBuffer = true), f._useTypedArrays && "number" == typeof e3.byteLength) o2._set(e3);
            else if (C(u2 = e3) || f.isBuffer(u2) || u2 && "object" == typeof u2 && "number" == typeof u2.length) for (i2 = 0; i2 < r2; i2++) f.isBuffer(e3) ? o2[i2] = e3.readUInt8(i2) : o2[i2] = e3[i2];
            else if ("string" == s2) o2.write(e3, 0, t2);
            else if ("number" == s2 && !f._useTypedArrays && !n2) for (i2 = 0; i2 < r2; i2++) o2[i2] = 0;
            return o2;
          }
          function b(e3, t2, n2, r2) {
            return f._charsWritten = c(function(e4) {
              for (var t3 = [], n3 = 0; n3 < e4.length; n3++) t3.push(255 & e4.charCodeAt(n3));
              return t3;
            }(t2), e3, n2, r2);
          }
          function m(e3, t2, n2, r2) {
            return f._charsWritten = c(function(e4) {
              for (var t3, n3, r3 = [], o2 = 0; o2 < e4.length; o2++) n3 = e4.charCodeAt(o2), t3 = n3 >> 8, n3 = n3 % 256, r3.push(n3), r3.push(t3);
              return r3;
            }(t2), e3, n2, r2);
          }
          function v(e3, t2, n2) {
            var r2 = "";
            n2 = Math.min(e3.length, n2);
            for (var o2 = t2; o2 < n2; o2++) r2 += String.fromCharCode(e3[o2]);
            return r2;
          }
          function o(e3, t2, n2, r2) {
            r2 || (d("boolean" == typeof n2, "missing or invalid endian"), d(null != t2, "missing offset"), d(t2 + 1 < e3.length, "Trying to read beyond buffer length"));
            var o2, r2 = e3.length;
            if (!(r2 <= t2)) return n2 ? (o2 = e3[t2], t2 + 1 < r2 && (o2 |= e3[t2 + 1] << 8)) : (o2 = e3[t2] << 8, t2 + 1 < r2 && (o2 |= e3[t2 + 1])), o2;
          }
          function u(e3, t2, n2, r2) {
            r2 || (d("boolean" == typeof n2, "missing or invalid endian"), d(null != t2, "missing offset"), d(t2 + 3 < e3.length, "Trying to read beyond buffer length"));
            var o2, r2 = e3.length;
            if (!(r2 <= t2)) return n2 ? (t2 + 2 < r2 && (o2 = e3[t2 + 2] << 16), t2 + 1 < r2 && (o2 |= e3[t2 + 1] << 8), o2 |= e3[t2], t2 + 3 < r2 && (o2 += e3[t2 + 3] << 24 >>> 0)) : (t2 + 1 < r2 && (o2 = e3[t2 + 1] << 16), t2 + 2 < r2 && (o2 |= e3[t2 + 2] << 8), t2 + 3 < r2 && (o2 |= e3[t2 + 3]), o2 += e3[t2] << 24 >>> 0), o2;
          }
          function _(e3, t2, n2, r2) {
            if (r2 || (d("boolean" == typeof n2, "missing or invalid endian"), d(null != t2, "missing offset"), d(t2 + 1 < e3.length, "Trying to read beyond buffer length")), !(e3.length <= t2)) return r2 = o(e3, t2, n2, true), 32768 & r2 ? -1 * (65535 - r2 + 1) : r2;
          }
          function E(e3, t2, n2, r2) {
            if (r2 || (d("boolean" == typeof n2, "missing or invalid endian"), d(null != t2, "missing offset"), d(t2 + 3 < e3.length, "Trying to read beyond buffer length")), !(e3.length <= t2)) return r2 = u(e3, t2, n2, true), 2147483648 & r2 ? -1 * (4294967295 - r2 + 1) : r2;
          }
          function I(e3, t2, n2, r2) {
            return r2 || (d("boolean" == typeof n2, "missing or invalid endian"), d(t2 + 3 < e3.length, "Trying to read beyond buffer length")), i.read(e3, t2, n2, 23, 4);
          }
          function A(e3, t2, n2, r2) {
            return r2 || (d("boolean" == typeof n2, "missing or invalid endian"), d(t2 + 7 < e3.length, "Trying to read beyond buffer length")), i.read(e3, t2, n2, 52, 8);
          }
          function s(e3, t2, n2, r2, o2) {
            o2 || (d(null != t2, "missing value"), d("boolean" == typeof r2, "missing or invalid endian"), d(null != n2, "missing offset"), d(n2 + 1 < e3.length, "trying to write beyond buffer length"), Y(t2, 65535));
            o2 = e3.length;
            if (!(o2 <= n2)) for (var i2 = 0, u2 = Math.min(o2 - n2, 2); i2 < u2; i2++) e3[n2 + i2] = (t2 & 255 << 8 * (r2 ? i2 : 1 - i2)) >>> 8 * (r2 ? i2 : 1 - i2);
          }
          function l(e3, t2, n2, r2, o2) {
            o2 || (d(null != t2, "missing value"), d("boolean" == typeof r2, "missing or invalid endian"), d(null != n2, "missing offset"), d(n2 + 3 < e3.length, "trying to write beyond buffer length"), Y(t2, 4294967295));
            o2 = e3.length;
            if (!(o2 <= n2)) for (var i2 = 0, u2 = Math.min(o2 - n2, 4); i2 < u2; i2++) e3[n2 + i2] = t2 >>> 8 * (r2 ? i2 : 3 - i2) & 255;
          }
          function B(e3, t2, n2, r2, o2) {
            o2 || (d(null != t2, "missing value"), d("boolean" == typeof r2, "missing or invalid endian"), d(null != n2, "missing offset"), d(n2 + 1 < e3.length, "Trying to write beyond buffer length"), F(t2, 32767, -32768)), e3.length <= n2 || s(e3, 0 <= t2 ? t2 : 65535 + t2 + 1, n2, r2, o2);
          }
          function L(e3, t2, n2, r2, o2) {
            o2 || (d(null != t2, "missing value"), d("boolean" == typeof r2, "missing or invalid endian"), d(null != n2, "missing offset"), d(n2 + 3 < e3.length, "Trying to write beyond buffer length"), F(t2, 2147483647, -2147483648)), e3.length <= n2 || l(e3, 0 <= t2 ? t2 : 4294967295 + t2 + 1, n2, r2, o2);
          }
          function U(e3, t2, n2, r2, o2) {
            o2 || (d(null != t2, "missing value"), d("boolean" == typeof r2, "missing or invalid endian"), d(null != n2, "missing offset"), d(n2 + 3 < e3.length, "Trying to write beyond buffer length"), D(t2, 34028234663852886e22, -34028234663852886e22)), e3.length <= n2 || i.write(e3, t2, n2, r2, 23, 4);
          }
          function x(e3, t2, n2, r2, o2) {
            o2 || (d(null != t2, "missing value"), d("boolean" == typeof r2, "missing or invalid endian"), d(null != n2, "missing offset"), d(n2 + 7 < e3.length, "Trying to write beyond buffer length"), D(t2, 17976931348623157e292, -17976931348623157e292)), e3.length <= n2 || i.write(e3, t2, n2, r2, 52, 8);
          }
          H.Buffer = f, H.SlowBuffer = f, H.INSPECT_MAX_BYTES = 50, f.poolSize = 8192, f._useTypedArrays = function() {
            try {
              var e3 = new ArrayBuffer(0), t2 = new Uint8Array(e3);
              return t2.foo = function() {
                return 42;
              }, 42 === t2.foo() && "function" == typeof t2.subarray;
            } catch (e4) {
              return false;
            }
          }(), f.isEncoding = function(e3) {
            switch (String(e3).toLowerCase()) {
              case "hex":
              case "utf8":
              case "utf-8":
              case "ascii":
              case "binary":
              case "base64":
              case "raw":
              case "ucs2":
              case "ucs-2":
              case "utf16le":
              case "utf-16le":
                return true;
              default:
                return false;
            }
          }, f.isBuffer = function(e3) {
            return !(null == e3 || !e3._isBuffer);
          }, f.byteLength = function(e3, t2) {
            var n2;
            switch (e3 += "", t2 || "utf8") {
              case "hex":
                n2 = e3.length / 2;
                break;
              case "utf8":
              case "utf-8":
                n2 = T(e3).length;
                break;
              case "ascii":
              case "binary":
              case "raw":
                n2 = e3.length;
                break;
              case "base64":
                n2 = M(e3).length;
                break;
              case "ucs2":
              case "ucs-2":
              case "utf16le":
              case "utf-16le":
                n2 = 2 * e3.length;
                break;
              default:
                throw new Error("Unknown encoding");
            }
            return n2;
          }, f.concat = function(e3, t2) {
            if (d(C(e3), "Usage: Buffer.concat(list, [totalLength])\nlist should be an Array."), 0 === e3.length) return new f(0);
            if (1 === e3.length) return e3[0];
            if ("number" != typeof t2) for (o2 = t2 = 0; o2 < e3.length; o2++) t2 += e3[o2].length;
            for (var n2 = new f(t2), r2 = 0, o2 = 0; o2 < e3.length; o2++) {
              var i2 = e3[o2];
              i2.copy(n2, r2), r2 += i2.length;
            }
            return n2;
          }, f.prototype.write = function(e3, t2, n2, r2) {
            isFinite(t2) ? isFinite(n2) || (r2 = n2, n2 = void 0) : (a2 = r2, r2 = t2, t2 = n2, n2 = a2), t2 = Number(t2) || 0;
            var o2, i2, u2, s2, a2 = this.length - t2;
            switch ((!n2 || a2 < (n2 = Number(n2))) && (n2 = a2), r2 = String(r2 || "utf8").toLowerCase()) {
              case "hex":
                o2 = function(e4, t3, n3, r3) {
                  n3 = Number(n3) || 0;
                  var o3 = e4.length - n3;
                  (!r3 || o3 < (r3 = Number(r3))) && (r3 = o3), d((o3 = t3.length) % 2 == 0, "Invalid hex string"), o3 / 2 < r3 && (r3 = o3 / 2);
                  for (var i3 = 0; i3 < r3; i3++) {
                    var u3 = parseInt(t3.substr(2 * i3, 2), 16);
                    d(!isNaN(u3), "Invalid hex string"), e4[n3 + i3] = u3;
                  }
                  return f._charsWritten = 2 * i3, i3;
                }(this, e3, t2, n2);
                break;
              case "utf8":
              case "utf-8":
                i2 = this, u2 = t2, s2 = n2, o2 = f._charsWritten = c(T(e3), i2, u2, s2);
                break;
              case "ascii":
              case "binary":
                o2 = b(this, e3, t2, n2);
                break;
              case "base64":
                i2 = this, u2 = t2, s2 = n2, o2 = f._charsWritten = c(M(e3), i2, u2, s2);
                break;
              case "ucs2":
              case "ucs-2":
              case "utf16le":
              case "utf-16le":
                o2 = m(this, e3, t2, n2);
                break;
              default:
                throw new Error("Unknown encoding");
            }
            return o2;
          }, f.prototype.toString = function(e3, t2, n2) {
            var r2, o2, i2, u2, s2 = this;
            if (e3 = String(e3 || "utf8").toLowerCase(), t2 = Number(t2) || 0, (n2 = void 0 !== n2 ? Number(n2) : s2.length) === t2) return "";
            switch (e3) {
              case "hex":
                r2 = function(e4, t3, n3) {
                  var r3 = e4.length;
                  (!t3 || t3 < 0) && (t3 = 0);
                  (!n3 || n3 < 0 || r3 < n3) && (n3 = r3);
                  for (var o3 = "", i3 = t3; i3 < n3; i3++) o3 += k(e4[i3]);
                  return o3;
                }(s2, t2, n2);
                break;
              case "utf8":
              case "utf-8":
                r2 = function(e4, t3, n3) {
                  var r3 = "", o3 = "";
                  n3 = Math.min(e4.length, n3);
                  for (var i3 = t3; i3 < n3; i3++) e4[i3] <= 127 ? (r3 += N(o3) + String.fromCharCode(e4[i3]), o3 = "") : o3 += "%" + e4[i3].toString(16);
                  return r3 + N(o3);
                }(s2, t2, n2);
                break;
              case "ascii":
              case "binary":
                r2 = v(s2, t2, n2);
                break;
              case "base64":
                o2 = s2, u2 = n2, r2 = 0 === (i2 = t2) && u2 === o2.length ? a.fromByteArray(o2) : a.fromByteArray(o2.slice(i2, u2));
                break;
              case "ucs2":
              case "ucs-2":
              case "utf16le":
              case "utf-16le":
                r2 = function(e4, t3, n3) {
                  for (var r3 = e4.slice(t3, n3), o3 = "", i3 = 0; i3 < r3.length; i3 += 2) o3 += String.fromCharCode(r3[i3] + 256 * r3[i3 + 1]);
                  return o3;
                }(s2, t2, n2);
                break;
              default:
                throw new Error("Unknown encoding");
            }
            return r2;
          }, f.prototype.toJSON = function() {
            return { type: "Buffer", data: Array.prototype.slice.call(this._arr || this, 0) };
          }, f.prototype.copy = function(e3, t2, n2, r2) {
            if (t2 = t2 || 0, (r2 = r2 || 0 === r2 ? r2 : this.length) !== (n2 = n2 || 0) && 0 !== e3.length && 0 !== this.length) {
              d(n2 <= r2, "sourceEnd < sourceStart"), d(0 <= t2 && t2 < e3.length, "targetStart out of bounds"), d(0 <= n2 && n2 < this.length, "sourceStart out of bounds"), d(0 <= r2 && r2 <= this.length, "sourceEnd out of bounds"), r2 > this.length && (r2 = this.length);
              var o2 = (r2 = e3.length - t2 < r2 - n2 ? e3.length - t2 + n2 : r2) - n2;
              if (o2 < 100 || !f._useTypedArrays) for (var i2 = 0; i2 < o2; i2++) e3[i2 + t2] = this[i2 + n2];
              else e3._set(this.subarray(n2, n2 + o2), t2);
            }
          }, f.prototype.slice = function(e3, t2) {
            var n2 = this.length;
            if (e3 = S(e3, n2, 0), t2 = S(t2, n2, n2), f._useTypedArrays) return f._augment(this.subarray(e3, t2));
            for (var r2 = t2 - e3, o2 = new f(r2, void 0, true), i2 = 0; i2 < r2; i2++) o2[i2] = this[i2 + e3];
            return o2;
          }, f.prototype.get = function(e3) {
            return console.log(".get() is deprecated. Access using array indexes instead."), this.readUInt8(e3);
          }, f.prototype.set = function(e3, t2) {
            return console.log(".set() is deprecated. Access using array indexes instead."), this.writeUInt8(e3, t2);
          }, f.prototype.readUInt8 = function(e3, t2) {
            if (t2 || (d(null != e3, "missing offset"), d(e3 < this.length, "Trying to read beyond buffer length")), !(e3 >= this.length)) return this[e3];
          }, f.prototype.readUInt16LE = function(e3, t2) {
            return o(this, e3, true, t2);
          }, f.prototype.readUInt16BE = function(e3, t2) {
            return o(this, e3, false, t2);
          }, f.prototype.readUInt32LE = function(e3, t2) {
            return u(this, e3, true, t2);
          }, f.prototype.readUInt32BE = function(e3, t2) {
            return u(this, e3, false, t2);
          }, f.prototype.readInt8 = function(e3, t2) {
            if (t2 || (d(null != e3, "missing offset"), d(e3 < this.length, "Trying to read beyond buffer length")), !(e3 >= this.length)) return 128 & this[e3] ? -1 * (255 - this[e3] + 1) : this[e3];
          }, f.prototype.readInt16LE = function(e3, t2) {
            return _(this, e3, true, t2);
          }, f.prototype.readInt16BE = function(e3, t2) {
            return _(this, e3, false, t2);
          }, f.prototype.readInt32LE = function(e3, t2) {
            return E(this, e3, true, t2);
          }, f.prototype.readInt32BE = function(e3, t2) {
            return E(this, e3, false, t2);
          }, f.prototype.readFloatLE = function(e3, t2) {
            return I(this, e3, true, t2);
          }, f.prototype.readFloatBE = function(e3, t2) {
            return I(this, e3, false, t2);
          }, f.prototype.readDoubleLE = function(e3, t2) {
            return A(this, e3, true, t2);
          }, f.prototype.readDoubleBE = function(e3, t2) {
            return A(this, e3, false, t2);
          }, f.prototype.writeUInt8 = function(e3, t2, n2) {
            n2 || (d(null != e3, "missing value"), d(null != t2, "missing offset"), d(t2 < this.length, "trying to write beyond buffer length"), Y(e3, 255)), t2 >= this.length || (this[t2] = e3);
          }, f.prototype.writeUInt16LE = function(e3, t2, n2) {
            s(this, e3, t2, true, n2);
          }, f.prototype.writeUInt16BE = function(e3, t2, n2) {
            s(this, e3, t2, false, n2);
          }, f.prototype.writeUInt32LE = function(e3, t2, n2) {
            l(this, e3, t2, true, n2);
          }, f.prototype.writeUInt32BE = function(e3, t2, n2) {
            l(this, e3, t2, false, n2);
          }, f.prototype.writeInt8 = function(e3, t2, n2) {
            n2 || (d(null != e3, "missing value"), d(null != t2, "missing offset"), d(t2 < this.length, "Trying to write beyond buffer length"), F(e3, 127, -128)), t2 >= this.length || (0 <= e3 ? this.writeUInt8(e3, t2, n2) : this.writeUInt8(255 + e3 + 1, t2, n2));
          }, f.prototype.writeInt16LE = function(e3, t2, n2) {
            B(this, e3, t2, true, n2);
          }, f.prototype.writeInt16BE = function(e3, t2, n2) {
            B(this, e3, t2, false, n2);
          }, f.prototype.writeInt32LE = function(e3, t2, n2) {
            L(this, e3, t2, true, n2);
          }, f.prototype.writeInt32BE = function(e3, t2, n2) {
            L(this, e3, t2, false, n2);
          }, f.prototype.writeFloatLE = function(e3, t2, n2) {
            U(this, e3, t2, true, n2);
          }, f.prototype.writeFloatBE = function(e3, t2, n2) {
            U(this, e3, t2, false, n2);
          }, f.prototype.writeDoubleLE = function(e3, t2, n2) {
            x(this, e3, t2, true, n2);
          }, f.prototype.writeDoubleBE = function(e3, t2, n2) {
            x(this, e3, t2, false, n2);
          }, f.prototype.fill = function(e3, t2, n2) {
            if (t2 = t2 || 0, n2 = n2 || this.length, d("number" == typeof (e3 = "string" == typeof (e3 = e3 || 0) ? e3.charCodeAt(0) : e3) && !isNaN(e3), "value is not a number"), d(t2 <= n2, "end < start"), n2 !== t2 && 0 !== this.length) {
              d(0 <= t2 && t2 < this.length, "start out of bounds"), d(0 <= n2 && n2 <= this.length, "end out of bounds");
              for (var r2 = t2; r2 < n2; r2++) this[r2] = e3;
            }
          }, f.prototype.inspect = function() {
            for (var e3 = [], t2 = this.length, n2 = 0; n2 < t2; n2++) if (e3[n2] = k(this[n2]), n2 === H.INSPECT_MAX_BYTES) {
              e3[n2 + 1] = "...";
              break;
            }
            return "<Buffer " + e3.join(" ") + ">";
          }, f.prototype.toArrayBuffer = function() {
            if ("undefined" == typeof Uint8Array) throw new Error("Buffer.toArrayBuffer not supported in this browser");
            if (f._useTypedArrays) return new f(this).buffer;
            for (var e3 = new Uint8Array(this.length), t2 = 0, n2 = e3.length; t2 < n2; t2 += 1) e3[t2] = this[t2];
            return e3.buffer;
          };
          var t = f.prototype;
          function S(e3, t2, n2) {
            return "number" != typeof e3 ? n2 : t2 <= (e3 = ~~e3) ? t2 : 0 <= e3 || 0 <= (e3 += t2) ? e3 : 0;
          }
          function j(e3) {
            return (e3 = ~~Math.ceil(+e3)) < 0 ? 0 : e3;
          }
          function C(e3) {
            return (Array.isArray || function(e4) {
              return "[object Array]" === Object.prototype.toString.call(e4);
            })(e3);
          }
          function k(e3) {
            return e3 < 16 ? "0" + e3.toString(16) : e3.toString(16);
          }
          function T(e3) {
            for (var t2 = [], n2 = 0; n2 < e3.length; n2++) {
              var r2 = e3.charCodeAt(n2);
              if (r2 <= 127) t2.push(e3.charCodeAt(n2));
              else for (var o2 = n2, i2 = (55296 <= r2 && r2 <= 57343 && n2++, encodeURIComponent(e3.slice(o2, n2 + 1)).substr(1).split("%")), u2 = 0; u2 < i2.length; u2++) t2.push(parseInt(i2[u2], 16));
            }
            return t2;
          }
          function M(e3) {
            return a.toByteArray(e3);
          }
          function c(e3, t2, n2, r2) {
            for (var o2 = 0; o2 < r2 && !(o2 + n2 >= t2.length || o2 >= e3.length); o2++) t2[o2 + n2] = e3[o2];
            return o2;
          }
          function N(e3) {
            try {
              return decodeURIComponent(e3);
            } catch (e4) {
              return String.fromCharCode(65533);
            }
          }
          function Y(e3, t2) {
            d("number" == typeof e3, "cannot write a non-number as a number"), d(0 <= e3, "specified a negative value for writing an unsigned value"), d(e3 <= t2, "value is larger than maximum value for type"), d(Math.floor(e3) === e3, "value has a fractional component");
          }
          function F(e3, t2, n2) {
            d("number" == typeof e3, "cannot write a non-number as a number"), d(e3 <= t2, "value larger than maximum allowed value"), d(n2 <= e3, "value smaller than minimum allowed value"), d(Math.floor(e3) === e3, "value has a fractional component");
          }
          function D(e3, t2, n2) {
            d("number" == typeof e3, "cannot write a non-number as a number"), d(e3 <= t2, "value larger than maximum allowed value"), d(n2 <= e3, "value smaller than minimum allowed value");
          }
          function d(e3, t2) {
            if (!e3) throw new Error(t2 || "Failed assertion");
          }
          f._augment = function(e3) {
            return e3._isBuffer = true, e3._get = e3.get, e3._set = e3.set, e3.get = t.get, e3.set = t.set, e3.write = t.write, e3.toString = t.toString, e3.toLocaleString = t.toString, e3.toJSON = t.toJSON, e3.copy = t.copy, e3.slice = t.slice, e3.readUInt8 = t.readUInt8, e3.readUInt16LE = t.readUInt16LE, e3.readUInt16BE = t.readUInt16BE, e3.readUInt32LE = t.readUInt32LE, e3.readUInt32BE = t.readUInt32BE, e3.readInt8 = t.readInt8, e3.readInt16LE = t.readInt16LE, e3.readInt16BE = t.readInt16BE, e3.readInt32LE = t.readInt32LE, e3.readInt32BE = t.readInt32BE, e3.readFloatLE = t.readFloatLE, e3.readFloatBE = t.readFloatBE, e3.readDoubleLE = t.readDoubleLE, e3.readDoubleBE = t.readDoubleBE, e3.writeUInt8 = t.writeUInt8, e3.writeUInt16LE = t.writeUInt16LE, e3.writeUInt16BE = t.writeUInt16BE, e3.writeUInt32LE = t.writeUInt32LE, e3.writeUInt32BE = t.writeUInt32BE, e3.writeInt8 = t.writeInt8, e3.writeInt16LE = t.writeInt16LE, e3.writeInt16BE = t.writeInt16BE, e3.writeInt32LE = t.writeInt32LE, e3.writeInt32BE = t.writeInt32BE, e3.writeFloatLE = t.writeFloatLE, e3.writeFloatBE = t.writeFloatBE, e3.writeDoubleLE = t.writeDoubleLE, e3.writeDoubleBE = t.writeDoubleBE, e3.fill = t.fill, e3.inspect = t.inspect, e3.toArrayBuffer = t.toArrayBuffer, e3;
          };
        }.call(this, O("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, O("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/buffer/index.js", "/node_modules/gulp-browserify/node_modules/buffer");
      }, { "base64-js": 2, buffer: 3, ieee754: 10, lYpoI2: 11 }], 4: [function(c, d, e) {
        !function(e2, t, a, n, r, o, i, u, s) {
          var a = c("buffer").Buffer, f = 4, l = new a(f);
          l.fill(0);
          d.exports = { hash: function(e3, t2, n2, r2) {
            for (var o2 = t2(function(e4, t3) {
              e4.length % f != 0 && (n3 = e4.length + (f - e4.length % f), e4 = a.concat([e4, l], n3));
              for (var n3, r3 = [], o3 = t3 ? e4.readInt32BE : e4.readInt32LE, i3 = 0; i3 < e4.length; i3 += f) r3.push(o3.call(e4, i3));
              return r3;
            }(e3 = a.isBuffer(e3) ? e3 : new a(e3), r2), 8 * e3.length), t2 = r2, i2 = new a(n2), u2 = t2 ? i2.writeInt32BE : i2.writeInt32LE, s2 = 0; s2 < o2.length; s2++) u2.call(i2, o2[s2], 4 * s2, true);
            return i2;
          } };
        }.call(this, c("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, c("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/crypto-browserify/helpers.js", "/node_modules/gulp-browserify/node_modules/crypto-browserify");
      }, { buffer: 3, lYpoI2: 11 }], 5: [function(v, e, _) {
        !function(l, c, u, d, h, p, g, y, w) {
          var u = v("buffer").Buffer, e2 = v("./sha"), t = v("./sha256"), n = v("./rng"), b = { sha1: e2, sha256: t, md5: v("./md5") }, s = 64, a = new u(s);
          function r(e3, n2) {
            var r2 = b[e3 = e3 || "sha1"], o2 = [];
            return r2 || i("algorithm:", e3, "is not yet supported"), { update: function(e4) {
              return u.isBuffer(e4) || (e4 = new u(e4)), o2.push(e4), e4.length, this;
            }, digest: function(e4) {
              var t2 = u.concat(o2), t2 = n2 ? function(e5, t3, n3) {
                u.isBuffer(t3) || (t3 = new u(t3)), u.isBuffer(n3) || (n3 = new u(n3)), t3.length > s ? t3 = e5(t3) : t3.length < s && (t3 = u.concat([t3, a], s));
                for (var r3 = new u(s), o3 = new u(s), i2 = 0; i2 < s; i2++) r3[i2] = 54 ^ t3[i2], o3[i2] = 92 ^ t3[i2];
                return n3 = e5(u.concat([r3, n3])), e5(u.concat([o3, n3]));
              }(r2, n2, t2) : r2(t2);
              return o2 = null, e4 ? t2.toString(e4) : t2;
            } };
          }
          function i() {
            var e3 = [].slice.call(arguments).join(" ");
            throw new Error([e3, "we accept pull requests", "http://github.com/dominictarr/crypto-browserify"].join("\n"));
          }
          a.fill(0), _.createHash = function(e3) {
            return r(e3);
          }, _.createHmac = r, _.randomBytes = function(e3, t2) {
            if (!t2 || !t2.call) return new u(n(e3));
            try {
              t2.call(this, void 0, new u(n(e3)));
            } catch (e4) {
              t2(e4);
            }
          };
          var o, f = ["createCredentials", "createCipher", "createCipheriv", "createDecipher", "createDecipheriv", "createSign", "createVerify", "createDiffieHellman", "pbkdf2"], m = function(e3) {
            _[e3] = function() {
              i("sorry,", e3, "is not implemented yet");
            };
          };
          for (o in f) m(f[o], o);
        }.call(this, v("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, v("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/crypto-browserify/index.js", "/node_modules/gulp-browserify/node_modules/crypto-browserify");
      }, { "./md5": 6, "./rng": 7, "./sha": 8, "./sha256": 9, buffer: 3, lYpoI2: 11 }], 6: [function(w, b, e) {
        !function(e2, r, o, i, u, a, f, l, y) {
          var t = w("./helpers");
          function n(e3, t2) {
            e3[t2 >> 5] |= 128 << t2 % 32, e3[14 + (t2 + 64 >>> 9 << 4)] = t2;
            for (var n2 = 1732584193, r2 = -271733879, o2 = -1732584194, i2 = 271733878, u2 = 0; u2 < e3.length; u2 += 16) {
              var s2 = n2, a2 = r2, f2 = o2, l2 = i2, n2 = c(n2, r2, o2, i2, e3[u2 + 0], 7, -680876936), i2 = c(i2, n2, r2, o2, e3[u2 + 1], 12, -389564586), o2 = c(o2, i2, n2, r2, e3[u2 + 2], 17, 606105819), r2 = c(r2, o2, i2, n2, e3[u2 + 3], 22, -1044525330);
              n2 = c(n2, r2, o2, i2, e3[u2 + 4], 7, -176418897), i2 = c(i2, n2, r2, o2, e3[u2 + 5], 12, 1200080426), o2 = c(o2, i2, n2, r2, e3[u2 + 6], 17, -1473231341), r2 = c(r2, o2, i2, n2, e3[u2 + 7], 22, -45705983), n2 = c(n2, r2, o2, i2, e3[u2 + 8], 7, 1770035416), i2 = c(i2, n2, r2, o2, e3[u2 + 9], 12, -1958414417), o2 = c(o2, i2, n2, r2, e3[u2 + 10], 17, -42063), r2 = c(r2, o2, i2, n2, e3[u2 + 11], 22, -1990404162), n2 = c(n2, r2, o2, i2, e3[u2 + 12], 7, 1804603682), i2 = c(i2, n2, r2, o2, e3[u2 + 13], 12, -40341101), o2 = c(o2, i2, n2, r2, e3[u2 + 14], 17, -1502002290), n2 = d(n2, r2 = c(r2, o2, i2, n2, e3[u2 + 15], 22, 1236535329), o2, i2, e3[u2 + 1], 5, -165796510), i2 = d(i2, n2, r2, o2, e3[u2 + 6], 9, -1069501632), o2 = d(o2, i2, n2, r2, e3[u2 + 11], 14, 643717713), r2 = d(r2, o2, i2, n2, e3[u2 + 0], 20, -373897302), n2 = d(n2, r2, o2, i2, e3[u2 + 5], 5, -701558691), i2 = d(i2, n2, r2, o2, e3[u2 + 10], 9, 38016083), o2 = d(o2, i2, n2, r2, e3[u2 + 15], 14, -660478335), r2 = d(r2, o2, i2, n2, e3[u2 + 4], 20, -405537848), n2 = d(n2, r2, o2, i2, e3[u2 + 9], 5, 568446438), i2 = d(i2, n2, r2, o2, e3[u2 + 14], 9, -1019803690), o2 = d(o2, i2, n2, r2, e3[u2 + 3], 14, -187363961), r2 = d(r2, o2, i2, n2, e3[u2 + 8], 20, 1163531501), n2 = d(n2, r2, o2, i2, e3[u2 + 13], 5, -1444681467), i2 = d(i2, n2, r2, o2, e3[u2 + 2], 9, -51403784), o2 = d(o2, i2, n2, r2, e3[u2 + 7], 14, 1735328473), n2 = h(n2, r2 = d(r2, o2, i2, n2, e3[u2 + 12], 20, -1926607734), o2, i2, e3[u2 + 5], 4, -378558), i2 = h(i2, n2, r2, o2, e3[u2 + 8], 11, -2022574463), o2 = h(o2, i2, n2, r2, e3[u2 + 11], 16, 1839030562), r2 = h(r2, o2, i2, n2, e3[u2 + 14], 23, -35309556), n2 = h(n2, r2, o2, i2, e3[u2 + 1], 4, -1530992060), i2 = h(i2, n2, r2, o2, e3[u2 + 4], 11, 1272893353), o2 = h(o2, i2, n2, r2, e3[u2 + 7], 16, -155497632), r2 = h(r2, o2, i2, n2, e3[u2 + 10], 23, -1094730640), n2 = h(n2, r2, o2, i2, e3[u2 + 13], 4, 681279174), i2 = h(i2, n2, r2, o2, e3[u2 + 0], 11, -358537222), o2 = h(o2, i2, n2, r2, e3[u2 + 3], 16, -722521979), r2 = h(r2, o2, i2, n2, e3[u2 + 6], 23, 76029189), n2 = h(n2, r2, o2, i2, e3[u2 + 9], 4, -640364487), i2 = h(i2, n2, r2, o2, e3[u2 + 12], 11, -421815835), o2 = h(o2, i2, n2, r2, e3[u2 + 15], 16, 530742520), n2 = p(n2, r2 = h(r2, o2, i2, n2, e3[u2 + 2], 23, -995338651), o2, i2, e3[u2 + 0], 6, -198630844), i2 = p(i2, n2, r2, o2, e3[u2 + 7], 10, 1126891415), o2 = p(o2, i2, n2, r2, e3[u2 + 14], 15, -1416354905), r2 = p(r2, o2, i2, n2, e3[u2 + 5], 21, -57434055), n2 = p(n2, r2, o2, i2, e3[u2 + 12], 6, 1700485571), i2 = p(i2, n2, r2, o2, e3[u2 + 3], 10, -1894986606), o2 = p(o2, i2, n2, r2, e3[u2 + 10], 15, -1051523), r2 = p(r2, o2, i2, n2, e3[u2 + 1], 21, -2054922799), n2 = p(n2, r2, o2, i2, e3[u2 + 8], 6, 1873313359), i2 = p(i2, n2, r2, o2, e3[u2 + 15], 10, -30611744), o2 = p(o2, i2, n2, r2, e3[u2 + 6], 15, -1560198380), r2 = p(r2, o2, i2, n2, e3[u2 + 13], 21, 1309151649), n2 = p(n2, r2, o2, i2, e3[u2 + 4], 6, -145523070), i2 = p(i2, n2, r2, o2, e3[u2 + 11], 10, -1120210379), o2 = p(o2, i2, n2, r2, e3[u2 + 2], 15, 718787259), r2 = p(r2, o2, i2, n2, e3[u2 + 9], 21, -343485551), n2 = g(n2, s2), r2 = g(r2, a2), o2 = g(o2, f2), i2 = g(i2, l2);
            }
            return Array(n2, r2, o2, i2);
          }
          function s(e3, t2, n2, r2, o2, i2) {
            return g((t2 = g(g(t2, e3), g(r2, i2))) << o2 | t2 >>> 32 - o2, n2);
          }
          function c(e3, t2, n2, r2, o2, i2, u2) {
            return s(t2 & n2 | ~t2 & r2, e3, t2, o2, i2, u2);
          }
          function d(e3, t2, n2, r2, o2, i2, u2) {
            return s(t2 & r2 | n2 & ~r2, e3, t2, o2, i2, u2);
          }
          function h(e3, t2, n2, r2, o2, i2, u2) {
            return s(t2 ^ n2 ^ r2, e3, t2, o2, i2, u2);
          }
          function p(e3, t2, n2, r2, o2, i2, u2) {
            return s(n2 ^ (t2 | ~r2), e3, t2, o2, i2, u2);
          }
          function g(e3, t2) {
            var n2 = (65535 & e3) + (65535 & t2);
            return (e3 >> 16) + (t2 >> 16) + (n2 >> 16) << 16 | 65535 & n2;
          }
          b.exports = function(e3) {
            return t.hash(e3, n, 16);
          };
        }.call(this, w("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, w("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/crypto-browserify/md5.js", "/node_modules/gulp-browserify/node_modules/crypto-browserify");
      }, { "./helpers": 4, buffer: 3, lYpoI2: 11 }], 7: [function(e, l, t) {
        !function(e2, t2, n, r, o, i, u, s, f) {
          var a;
          l.exports = a || function(e3) {
            for (var t3, n2 = new Array(e3), r2 = 0; r2 < e3; r2++) 0 == (3 & r2) && (t3 = 4294967296 * Math.random()), n2[r2] = t3 >>> ((3 & r2) << 3) & 255;
            return n2;
          };
        }.call(this, e("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, e("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/crypto-browserify/rng.js", "/node_modules/gulp-browserify/node_modules/crypto-browserify");
      }, { buffer: 3, lYpoI2: 11 }], 8: [function(c, d, e) {
        !function(e2, t, n, r, o, s, a, f, l) {
          var i = c("./helpers");
          function u(l2, c2) {
            l2[c2 >> 5] |= 128 << 24 - c2 % 32, l2[15 + (c2 + 64 >> 9 << 4)] = c2;
            for (var e3, t2, n2, r2 = Array(80), o2 = 1732584193, i2 = -271733879, u2 = -1732584194, s2 = 271733878, d2 = -1009589776, h = 0; h < l2.length; h += 16) {
              for (var p = o2, g = i2, y = u2, w = s2, b = d2, a2 = 0; a2 < 80; a2++) {
                r2[a2] = a2 < 16 ? l2[h + a2] : v(r2[a2 - 3] ^ r2[a2 - 8] ^ r2[a2 - 14] ^ r2[a2 - 16], 1);
                var f2 = m(m(v(o2, 5), (f2 = i2, t2 = u2, n2 = s2, (e3 = a2) < 20 ? f2 & t2 | ~f2 & n2 : !(e3 < 40) && e3 < 60 ? f2 & t2 | f2 & n2 | t2 & n2 : f2 ^ t2 ^ n2)), m(m(d2, r2[a2]), (e3 = a2) < 20 ? 1518500249 : e3 < 40 ? 1859775393 : e3 < 60 ? -1894007588 : -899497514)), d2 = s2, s2 = u2, u2 = v(i2, 30), i2 = o2, o2 = f2;
              }
              o2 = m(o2, p), i2 = m(i2, g), u2 = m(u2, y), s2 = m(s2, w), d2 = m(d2, b);
            }
            return Array(o2, i2, u2, s2, d2);
          }
          function m(e3, t2) {
            var n2 = (65535 & e3) + (65535 & t2);
            return (e3 >> 16) + (t2 >> 16) + (n2 >> 16) << 16 | 65535 & n2;
          }
          function v(e3, t2) {
            return e3 << t2 | e3 >>> 32 - t2;
          }
          d.exports = function(e3) {
            return i.hash(e3, u, 20, true);
          };
        }.call(this, c("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, c("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/crypto-browserify/sha.js", "/node_modules/gulp-browserify/node_modules/crypto-browserify");
      }, { "./helpers": 4, buffer: 3, lYpoI2: 11 }], 9: [function(c, d, e) {
        !function(e2, t, n, r, u, s, a, f, l) {
          function b(e3, t2) {
            var n2 = (65535 & e3) + (65535 & t2);
            return (e3 >> 16) + (t2 >> 16) + (n2 >> 16) << 16 | 65535 & n2;
          }
          function o(e3, l2) {
            var c2, d2 = new Array(1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986, 2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344, 430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479, 3329325298), t2 = new Array(1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225), n2 = new Array(64);
            e3[l2 >> 5] |= 128 << 24 - l2 % 32, e3[15 + (l2 + 64 >> 9 << 4)] = l2;
            for (var r2, o2, h = 0; h < e3.length; h += 16) {
              for (var i2 = t2[0], u2 = t2[1], s2 = t2[2], p = t2[3], a2 = t2[4], g = t2[5], y = t2[6], w = t2[7], f2 = 0; f2 < 64; f2++) n2[f2] = f2 < 16 ? e3[f2 + h] : b(b(b((o2 = n2[f2 - 2], m(o2, 17) ^ m(o2, 19) ^ v(o2, 10)), n2[f2 - 7]), (o2 = n2[f2 - 15], m(o2, 7) ^ m(o2, 18) ^ v(o2, 3))), n2[f2 - 16]), c2 = b(b(b(b(w, m(o2 = a2, 6) ^ m(o2, 11) ^ m(o2, 25)), a2 & g ^ ~a2 & y), d2[f2]), n2[f2]), r2 = b(m(r2 = i2, 2) ^ m(r2, 13) ^ m(r2, 22), i2 & u2 ^ i2 & s2 ^ u2 & s2), w = y, y = g, g = a2, a2 = b(p, c2), p = s2, s2 = u2, u2 = i2, i2 = b(c2, r2);
              t2[0] = b(i2, t2[0]), t2[1] = b(u2, t2[1]), t2[2] = b(s2, t2[2]), t2[3] = b(p, t2[3]), t2[4] = b(a2, t2[4]), t2[5] = b(g, t2[5]), t2[6] = b(y, t2[6]), t2[7] = b(w, t2[7]);
            }
            return t2;
          }
          var i = c("./helpers"), m = function(e3, t2) {
            return e3 >>> t2 | e3 << 32 - t2;
          }, v = function(e3, t2) {
            return e3 >>> t2;
          };
          d.exports = function(e3) {
            return i.hash(e3, o, 32, true);
          };
        }.call(this, c("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, c("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/crypto-browserify/sha256.js", "/node_modules/gulp-browserify/node_modules/crypto-browserify");
      }, { "./helpers": 4, buffer: 3, lYpoI2: 11 }], 10: [function(e, t, f) {
        !function(e2, t2, n, r, o, i, u, s, a) {
          f.read = function(e3, t3, n2, r2, o2) {
            var i2, u2, l = 8 * o2 - r2 - 1, c = (1 << l) - 1, d = c >> 1, s2 = -7, a2 = n2 ? o2 - 1 : 0, f2 = n2 ? -1 : 1, o2 = e3[t3 + a2];
            for (a2 += f2, i2 = o2 & (1 << -s2) - 1, o2 >>= -s2, s2 += l; 0 < s2; i2 = 256 * i2 + e3[t3 + a2], a2 += f2, s2 -= 8) ;
            for (u2 = i2 & (1 << -s2) - 1, i2 >>= -s2, s2 += r2; 0 < s2; u2 = 256 * u2 + e3[t3 + a2], a2 += f2, s2 -= 8) ;
            if (0 === i2) i2 = 1 - d;
            else {
              if (i2 === c) return u2 ? NaN : 1 / 0 * (o2 ? -1 : 1);
              u2 += Math.pow(2, r2), i2 -= d;
            }
            return (o2 ? -1 : 1) * u2 * Math.pow(2, i2 - r2);
          }, f.write = function(e3, t3, l, n2, r2, c) {
            var o2, i2, u2 = 8 * c - r2 - 1, s2 = (1 << u2) - 1, a2 = s2 >> 1, d = 23 === r2 ? Math.pow(2, -24) - Math.pow(2, -77) : 0, f2 = n2 ? 0 : c - 1, h = n2 ? 1 : -1, c = t3 < 0 || 0 === t3 && 1 / t3 < 0 ? 1 : 0;
            for (t3 = Math.abs(t3), isNaN(t3) || t3 === 1 / 0 ? (i2 = isNaN(t3) ? 1 : 0, o2 = s2) : (o2 = Math.floor(Math.log(t3) / Math.LN2), t3 * (n2 = Math.pow(2, -o2)) < 1 && (o2--, n2 *= 2), 2 <= (t3 += 1 <= o2 + a2 ? d / n2 : d * Math.pow(2, 1 - a2)) * n2 && (o2++, n2 /= 2), s2 <= o2 + a2 ? (i2 = 0, o2 = s2) : 1 <= o2 + a2 ? (i2 = (t3 * n2 - 1) * Math.pow(2, r2), o2 += a2) : (i2 = t3 * Math.pow(2, a2 - 1) * Math.pow(2, r2), o2 = 0)); 8 <= r2; e3[l + f2] = 255 & i2, f2 += h, i2 /= 256, r2 -= 8) ;
            for (o2 = o2 << r2 | i2, u2 += r2; 0 < u2; e3[l + f2] = 255 & o2, f2 += h, o2 /= 256, u2 -= 8) ;
            e3[l + f2 - h] |= 128 * c;
          };
        }.call(this, e("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, e("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/ieee754/index.js", "/node_modules/gulp-browserify/node_modules/ieee754");
      }, { buffer: 3, lYpoI2: 11 }], 11: [function(e, h, t) {
        !function(e2, t2, n, r, o, f, l, c, d) {
          var i, u, s;
          function a() {
          }
          (e2 = h.exports = {}).nextTick = (u = "undefined" != typeof window && window.setImmediate, s = "undefined" != typeof window && window.postMessage && window.addEventListener, u ? function(e3) {
            return window.setImmediate(e3);
          } : s ? (i = [], window.addEventListener("message", function(e3) {
            var t3 = e3.source;
            t3 !== window && null !== t3 || "process-tick" !== e3.data || (e3.stopPropagation(), 0 < i.length && i.shift()());
          }, true), function(e3) {
            i.push(e3), window.postMessage("process-tick", "*");
          }) : function(e3) {
            setTimeout(e3, 0);
          }), e2.title = "browser", e2.browser = true, e2.env = {}, e2.argv = [], e2.on = a, e2.addListener = a, e2.once = a, e2.off = a, e2.removeListener = a, e2.removeAllListeners = a, e2.emit = a, e2.binding = function(e3) {
            throw new Error("process.binding is not supported");
          }, e2.cwd = function() {
            return "/";
          }, e2.chdir = function(e3) {
            throw new Error("process.chdir is not supported");
          };
        }.call(this, e("lYpoI2"), "undefined" != typeof self ? self : "undefined" != typeof window ? window : {}, e("buffer").Buffer, arguments[3], arguments[4], arguments[5], arguments[6], "/node_modules/gulp-browserify/node_modules/process/browser.js", "/node_modules/gulp-browserify/node_modules/process");
      }, { buffer: 3, lYpoI2: 11 }] }, {}, [1])(1);
    });
  }
});

// ../../node_modules/p-defer/index.js
var require_p_defer = __commonJS({
  "../../node_modules/p-defer/index.js"(exports, module) {
    "use strict";
    var pDefer = () => {
      const deferred = {};
      deferred.promise = new Promise((resolve3, reject) => {
        deferred.resolve = resolve3;
        deferred.reject = reject;
      });
      return deferred;
    };
    module.exports = pDefer;
  }
});

// ../../node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js
var require_use_sync_external_store_shim_development = __commonJS({
  "../../node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.development.js"(exports) {
    "use strict";
    (function() {
      function is(x, y) {
        return x === y && (0 !== x || 1 / x === 1 / y) || x !== x && y !== y;
      }
      function useSyncExternalStore$2(subscribe2, getSnapshot) {
        didWarnOld18Alpha || void 0 === React8.startTransition || (didWarnOld18Alpha = true, console.error(
          "You are using an outdated, pre-release alpha of React 18 that does not support useSyncExternalStore. The use-sync-external-store shim will not work correctly. Upgrade to a newer pre-release."
        ));
        var value = getSnapshot();
        if (!didWarnUncachedGetSnapshot) {
          var cachedValue = getSnapshot();
          objectIs(value, cachedValue) || (console.error(
            "The result of getSnapshot should be cached to avoid an infinite loop"
          ), didWarnUncachedGetSnapshot = true);
        }
        cachedValue = useState9({
          inst: { value, getSnapshot }
        });
        var inst = cachedValue[0].inst, forceUpdate = cachedValue[1];
        useLayoutEffect2(
          function() {
            inst.value = value;
            inst.getSnapshot = getSnapshot;
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
          },
          [subscribe2, value, getSnapshot]
        );
        useEffect17(
          function() {
            checkIfSnapshotChanged(inst) && forceUpdate({ inst });
            return subscribe2(function() {
              checkIfSnapshotChanged(inst) && forceUpdate({ inst });
            });
          },
          [subscribe2]
        );
        useDebugValue(value);
        return value;
      }
      function checkIfSnapshotChanged(inst) {
        var latestGetSnapshot = inst.getSnapshot;
        inst = inst.value;
        try {
          var nextValue = latestGetSnapshot();
          return !objectIs(inst, nextValue);
        } catch (error) {
          return true;
        }
      }
      function useSyncExternalStore$1(subscribe2, getSnapshot) {
        return getSnapshot();
      }
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStart(Error());
      var React8 = require_react(), objectIs = "function" === typeof Object.is ? Object.is : is, useState9 = React8.useState, useEffect17 = React8.useEffect, useLayoutEffect2 = React8.useLayoutEffect, useDebugValue = React8.useDebugValue, didWarnOld18Alpha = false, didWarnUncachedGetSnapshot = false, shim = "undefined" === typeof window || "undefined" === typeof window.document || "undefined" === typeof window.document.createElement ? useSyncExternalStore$1 : useSyncExternalStore$2;
      exports.useSyncExternalStore = void 0 !== React8.useSyncExternalStore ? React8.useSyncExternalStore : shim;
      "undefined" !== typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ && "function" === typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop && __REACT_DEVTOOLS_GLOBAL_HOOK__.registerInternalModuleStop(Error());
    })();
  }
});

// ../../node_modules/use-sync-external-store/shim/index.js
var require_shim = __commonJS({
  "../../node_modules/use-sync-external-store/shim/index.js"(exports, module) {
    "use strict";
    if (false) {
      module.exports = null;
    } else {
      module.exports = require_use_sync_external_store_shim_development();
    }
  }
});

// ../../node_modules/frail-map/esm/src/StrongRef.js
var __classPrivateFieldSet = function(receiver, state, value, kind, f) {
  if (kind === "m") throw new TypeError("Private method is not writable");
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _StrongRef_data;
var StrongRef = class {
  constructor(data) {
    _StrongRef_data.set(this, void 0);
    __classPrivateFieldSet(this, _StrongRef_data, data, "f");
  }
  deref() {
    return __classPrivateFieldGet(this, _StrongRef_data, "f");
  }
  get [(_StrongRef_data = /* @__PURE__ */ new WeakMap(), Symbol.toStringTag)]() {
    return "StrongRef";
  }
};

// ../../node_modules/frail-map/esm/src/FrailMap.js
if (typeof WeakRef === "undefined") {
  console.warn(`WeakRef is not available at this environment, falling back to simple object references.`);
}
var FrailMap = class extends Map {
  constructor(entries) {
    super();
    if (entries) {
      for (const [k, v] of entries) {
        this.set(k, v);
      }
    }
  }
  /**
   * Returns a specified element from the Map object. If the value that is
   * associated to the provided key is an object, then you will get a reference
   * to that object and any change made to that object will effectively modify
   * it inside the Map.
   *
   * @returns Returns the element associated with the specified key. If no
   * element is associated with the specified key or the value has been garbage
   * collected, undefined is returned.
   */
  get(key) {
    const ref = super.get(key);
    const val = ref?.deref();
    if (val === void 0) {
      this.delete(key);
      return;
    }
    return val.data;
  }
  /**
   * @returns boolean indicating whether an element with the specified key
   * exists or not, updates size if value has been garbage collected.
   */
  has(key) {
    return super.has(key) && this.get(key) !== void 0;
  }
  /**
   * Adds a new element with a specified key and value to the Map. If an element
   * with the same key already exists, the element will be updated.
   *
   * A `strong` option can be provided to use a strong reference to act like a
   * normal map.
   */
  set(key, value, options) {
    return super.set(key, options?.strong || typeof WeakRef === "undefined" ? new StrongRef({ data: value }) : new WeakRef({ data: value }));
  }
  /**
   * Executes a provided function once per each key/value pair in the Map, in
   * insertion order.
   */
  forEach(callbackfn, thisArg) {
    super.forEach((container, k) => {
      const ref = container.deref();
      if (ref !== void 0) {
        callbackfn.call(thisArg, ref.data, k, this);
      } else {
        this.delete(k);
      }
    });
  }
  /**
   * Returns an iterable of key, value pairs for every entry in the map.
   */
  entries() {
    const map = /* @__PURE__ */ new Map();
    this.forEach((v, k) => {
      map.set(k, v);
    });
    return map.entries();
  }
  /**
   * Returns an iterable of keys in the map
   */
  keys() {
    const keys2 = /* @__PURE__ */ new Set();
    this.forEach((_, k) => {
      keys2.add(k);
    });
    return keys2.values();
  }
  /**
   * Returns an iterable of values in the map
   */
  values() {
    const keys2 = /* @__PURE__ */ new Set();
    this.forEach((v) => {
      keys2.add(v);
    });
    return keys2.values();
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  get [Symbol.toStringTag]() {
    return "FrailMap";
  }
  toJSON() {
    const json = {};
    this.forEach((v, k) => {
      json[k] = v;
    });
    return json;
  }
};

// ../../node_modules/just-safe-set/index.mjs
var objectSafeSet = set;
function set(obj, propsArg, value) {
  var props, lastProp;
  if (Array.isArray(propsArg)) {
    props = propsArg.slice(0);
  }
  if (typeof propsArg == "string") {
    props = propsArg.split(".");
  }
  if (typeof propsArg == "symbol") {
    props = [propsArg];
  }
  if (!Array.isArray(props)) {
    throw new Error("props arg must be an array, a string or a symbol");
  }
  lastProp = props.pop();
  if (!lastProp) {
    return false;
  }
  prototypeCheck(lastProp);
  var thisProp;
  while (thisProp = props.shift()) {
    prototypeCheck(thisProp);
    if (typeof obj[thisProp] == "undefined") {
      obj[thisProp] = {};
    }
    obj = obj[thisProp];
    if (!obj || typeof obj != "object") {
      return false;
    }
  }
  obj[lastProp] = value;
  return true;
}
function prototypeCheck(prop) {
  if (prop == "__proto__" || prop == "constructor" || prop == "prototype") {
    throw new Error("setting of prototype values not supported");
  }
}

// ../../node_modules/multidict/esm/src/MultiDict.js
var __classPrivateFieldGet2 = function(receiver, state, kind, f) {
  if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _MultiDict_instances;
var _MultiDict_map;
var _MultiDict_set;
var MultiDict = class {
  constructor() {
    _MultiDict_instances.add(this);
    _MultiDict_map.set(this, /* @__PURE__ */ new Map());
  }
  /** Delete all entries */
  clear() {
    __classPrivateFieldGet2(this, _MultiDict_map, "f").clear();
  }
  delete(key, value) {
    if (value !== void 0) {
      let result2 = __classPrivateFieldGet2(this, _MultiDict_map, "f").get(key)?.delete(value) ?? false;
      result2 &&= __classPrivateFieldGet2(this, _MultiDict_map, "f").get(value)?.delete(key) ?? false;
      return result2;
    }
    const values = __classPrivateFieldGet2(this, _MultiDict_map, "f").get(key);
    let result = __classPrivateFieldGet2(this, _MultiDict_map, "f").delete(key);
    if (values) {
      for (const value2 of values) {
        const revRef = __classPrivateFieldGet2(this, _MultiDict_map, "f").get(value2);
        if (revRef) {
          result &&= revRef.delete(key) ?? false;
          if (revRef.size === 0) {
            __classPrivateFieldGet2(this, _MultiDict_map, "f").delete(value2);
          }
        }
      }
      return result;
    }
    return result;
  }
  /**
   * Returns an iterable of key, value pairs for every entry in the map.
   *
   * Keys and values are interchangeable, expect all existing keys and values
   * being invoked as the "key" once.
   */
  entries() {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f").entries();
  }
  /**
   * Calls a function for each key-value pair in the map.
   *
   * Keys and values are interchangeable, expect all existing keys and values
   * being invoked as the "key" once.
   */
  forEach(callbackfn, thisArg) {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f").forEach(callbackfn, thisArg);
  }
  get(key) {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f").get(key);
  }
  /**
   * Returns a boolean indicating whether an element with the specified key
   */
  has(key) {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f").has(key);
  }
  /**
   * Keys and values are interchangable, this is an iterator for all keys and
   * values.
   */
  keys() {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f").keys();
  }
  set(key, value) {
    var _a;
    return __classPrivateFieldGet2(_a = __classPrivateFieldGet2(this, _MultiDict_instances, "m", _MultiDict_set).call(this, key, value), _MultiDict_instances, "m", _MultiDict_set).call(_a, value, key);
  }
  /**
   * Return the size of the map. Since keys and values are interchangeable, it
   * is the total number of unique keys and values.
   */
  get size() {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f").size;
  }
  /**
   * Returns an iterable of values in the map.
   *
   * Keys and values are interchangeable, therefore values set as keys will be
   * returned as a single-value Set.
   */
  values() {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f").values();
  }
  [(_MultiDict_map = /* @__PURE__ */ new WeakMap(), _MultiDict_instances = /* @__PURE__ */ new WeakSet(), _MultiDict_set = function _MultiDict_set2(key, value) {
    const set3 = __classPrivateFieldGet2(this, _MultiDict_map, "f").get(key) ?? /* @__PURE__ */ new Set();
    set3.add(value);
    __classPrivateFieldGet2(this, _MultiDict_map, "f").set(key, set3);
    return this;
  }, Symbol.iterator)]() {
    return __classPrivateFieldGet2(this, _MultiDict_map, "f")[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return "MultiDict";
  }
};

// ../../node_modules/just-memoize/index.mjs
var functionMemoize = memoize;
function memoize(callback, resolver) {
  if (typeof callback !== "function") {
    throw new Error("`callback` should be a function");
  }
  if (resolver !== void 0 && typeof resolver !== "function") {
    throw new Error("`resolver` should be a function");
  }
  var cache2 = {};
  var memoized = function() {
    var args = Array.prototype.slice.call(arguments);
    var key = resolver ? resolver.apply(this, args) : JSON.stringify(args);
    if (!(key in cache2)) {
      cache2[key] = callback.apply(this, args);
    }
    return cache2[key];
  };
  memoized.cache = cache2;
  return memoized;
}

// ../../node_modules/gqty/Utils/hash.mjs
var import_object_hash = __toESM(require_object_hash(), 1);
var hash = functionMemoize(
  (...args) => (0, import_object_hash.default)(args, { unorderedObjects: false }).replace(/^(\d)/, "a$1")
);

// ../../node_modules/gqty/Utils/object.mjs
var isObject = (v) => v != null && typeof v === "object";
var isPlainObject = (v) => isObject(v) && !Array.isArray(v);
function deepAssign(target, sources, onConflict) {
  for (const source of sources) {
    for (const [sourceKey, sourceValue] of Object.entries(source || {})) {
      if (sourceKey in target) {
        const targetValue = Reflect.get(target, sourceKey);
        if (sourceValue === targetValue) continue;
        if (isObject(sourceValue) && isObject(targetValue)) {
          const onConflictResult = onConflict == null ? void 0 : onConflict(targetValue, sourceValue);
          if (onConflictResult === void 0) {
            Reflect.set(
              target,
              sourceKey,
              deepAssign(targetValue, [sourceValue], onConflict)
            );
          } else {
            Reflect.set(target, sourceKey, onConflictResult);
          }
          continue;
        }
      }
      Reflect.set(target, sourceKey, sourceValue);
    }
  }
  return target;
}

// ../../node_modules/gqty/Accessor/meta.mjs
var metaverse = /* @__PURE__ */ new WeakMap();
var $meta = (accessor) => metaverse.get(accessor);
$meta.set = (accessor, meta) => {
  metaverse.set(accessor, meta);
};

// ../../node_modules/gqty/Accessor/skeleton.mjs
var skeletons = /* @__PURE__ */ new WeakSet();
var isSkeleton = (object2) => {
  var _a;
  if (!isObject(object2)) return false;
  const value = object2;
  if (skeletons.has(value)) return true;
  const data = (_a = $meta(value)) == null ? void 0 : _a.cache.data;
  if (!isObject(data)) return false;
  return skeletons.has(data);
};
var createSkeleton = (fn) => {
  const skeleton = fn();
  skeletons.add(skeleton);
  return skeleton;
};

// ../../node_modules/flatted/esm/index.js
var { parse: $parse, stringify: $stringify } = JSON;
var { keys } = Object;
var Primitive = String;
var primitive = "string";
var ignore = {};
var object = "object";
var noop = (_, value) => value;
var primitives = (value) => value instanceof Primitive ? Primitive(value) : value;
var Primitives = (_, value) => typeof value === primitive ? new Primitive(value) : value;
var revive = (input, parsed, output, $) => {
  const lazy = [];
  for (let ke = keys(output), { length } = ke, y = 0; y < length; y++) {
    const k = ke[y];
    const value = output[k];
    if (value instanceof Primitive) {
      const tmp = input[value];
      if (typeof tmp === object && !parsed.has(tmp)) {
        parsed.add(tmp);
        output[k] = ignore;
        lazy.push({ k, a: [input, parsed, tmp, $] });
      } else
        output[k] = $.call(output, k, tmp);
    } else if (output[k] !== ignore)
      output[k] = $.call(output, k, value);
  }
  for (let { length } = lazy, i = 0; i < length; i++) {
    const { k, a } = lazy[i];
    output[k] = $.call(output, k, revive.apply(null, a));
  }
  return output;
};
var set2 = (known, input, value) => {
  const index = Primitive(input.push(value) - 1);
  known.set(value, index);
  return index;
};
var parse = (text, reviver) => {
  const input = $parse(text, Primitives).map(primitives);
  const value = input[0];
  const $ = reviver || noop;
  const tmp = typeof value === object && value ? revive(input, /* @__PURE__ */ new Set(), value, $) : value;
  return $.call({ "": tmp }, "", tmp);
};
var stringify = (value, replacer, space) => {
  const $ = replacer && typeof replacer === object ? (k, v) => k === "" || -1 < replacer.indexOf(k) ? v : void 0 : replacer || noop;
  const known = /* @__PURE__ */ new Map();
  const input = [];
  const output = [];
  let i = +set2(known, input, $.call({ "": value }, "", value));
  let firstRun = !i;
  while (i < input.length) {
    firstRun = true;
    output[i] = $stringify(input[i++], replace, space);
  }
  return "[" + output.join(",") + "]";
  function replace(key, value2) {
    if (firstRun) {
      firstRun = !firstRun;
      return value2;
    }
    const after = $.call(this, key, value2);
    switch (typeof after) {
      case object:
        if (after === null) return after;
      case primitive:
        return known.get(after) || set2(known, input, after);
    }
    return after;
  }
};
var toJSON = (value) => $parse(stringify(value));
var fromJSON = (value) => parse($stringify(value));

// ../../node_modules/gqty/Helpers/deepCopy.mjs
var deepCopy = (value) => Object.freeze(parse(stringify(value)));

// ../../node_modules/gqty/Helpers/select.mjs
function select(node, path, onNext) {
  const probedNode = onNext ? onNext(node, path) : node;
  if (path.length === 0) {
    return node;
  } else if (probedNode == null || typeof probedNode !== "object") {
    return void 0;
  }
  if (Array.isArray(probedNode)) {
    return probedNode.map((item) => select(item, path, onNext));
  }
  const [key, ...rest] = path;
  return select(probedNode[key], rest, onNext);
}

// ../../node_modules/just-safe-get/index.mjs
var objectSafeGet = get;
function get(obj, propsArg, defaultValue) {
  if (!obj) {
    return defaultValue;
  }
  var props, prop;
  if (Array.isArray(propsArg)) {
    props = propsArg.slice(0);
  }
  if (typeof propsArg == "string") {
    props = propsArg.split(".");
  }
  if (typeof propsArg == "symbol") {
    props = [propsArg];
  }
  if (!Array.isArray(props)) {
    throw new Error("props arg must be an array, a string or a symbol");
  }
  while (props.length) {
    prop = props.shift();
    if (!obj) {
      return defaultValue;
    }
    obj = obj[prop];
    if (obj === void 0) {
      return defaultValue;
    }
  }
  return obj;
}

// ../../node_modules/gqty/Helpers/InfiniteFrailMap.mjs
var InfiniteFrailMap = class _InfiniteFrailMap extends FrailMap {
  get(key) {
    var _a;
    const value = (_a = super.get(key)) != null ? _a : new _InfiniteFrailMap();
    super.set(key, value);
    return value;
  }
};

// ../../node_modules/gqty/Cache/crawl.mjs
var crawl = (data, fn, maxIterations = 1e5) => {
  const seen = new InfiniteFrailMap();
  const stack = /* @__PURE__ */ new Set([[data, 0, []]]);
  for (const [it, key, obj] of stack) {
    if (maxIterations-- < 0) {
      throw new Error("Maximum iterations reached.");
    }
    if (seen.get(it).get(key).has(obj)) continue;
    seen.get(it).get(key).set(obj, true);
    const ret = fn(it, key, obj);
    if (ret !== void 0) {
      stack.add(ret);
    }
    if (it === void 0) {
      delete obj[key];
    } else if (Array.isArray(it)) {
      for (const [k, v] of it.entries()) stack.add([v, k, it]);
    } else if (typeof it === "object" && it !== null) {
      for (const [k, v] of Object.entries(it)) stack.add([v, k, it]);
    }
  }
  return data;
};
var flattenObject = (obj, maxIterations = 1e5) => {
  const result = [];
  const stack = /* @__PURE__ */ new Set([[[], obj]]);
  const seen = /* @__PURE__ */ new Set();
  for (const [key, it] of stack) {
    if (maxIterations-- < 0) {
      throw new Error("Maximum iterations reached.");
    }
    if (it === void 0) continue;
    if (it === null || typeof it === "string" || typeof it === "number" || typeof it === "boolean") {
      result.push([key, it]);
    } else {
      if (seen.has(it)) continue;
      seen.add(it);
      if (Array.isArray(it)) {
        for (const [k, v] of it.entries()) stack.add([[...key, `${k}`], v]);
      } else if (typeof it === "object") {
        for (const [k, v] of Object.entries(it))
          stack.add([[...key, `${k}`], v]);
      }
    }
  }
  return result;
};

// ../../node_modules/gqty/Error/retry.mjs
var defaultMaxRetries = 3;
var defaultRetryDelay = (attemptIndex) => Math.min(1e3 * 2 ** attemptIndex, 3e4);
function doRetry(options, state) {
  var _a, _b;
  if (options === false) {
    throw new Error(`Retries are disabled.`);
  }
  const maxRetries = typeof options === "number" ? options : (_a = typeof options === "object" ? options.maxRetries : void 0) != null ? _a : defaultMaxRetries;
  if (maxRetries < 1) {
    throw new Error(`Maximum retries must be >= 1`);
  }
  const retryDelay = (_b = typeof options === "object" ? options.retryDelay : void 0) != null ? _b : defaultRetryDelay;
  const { attemptIndex = 0, onRetry, onLastTry } = state;
  if (onLastTry && attemptIndex === maxRetries - 1) {
    setTimeout(
      () => {
        onLastTry(attemptIndex).catch(console.error);
      },
      typeof retryDelay === "function" ? retryDelay(attemptIndex) : retryDelay
    );
  } else if (attemptIndex < maxRetries) {
    setTimeout(
      () => {
        onRetry(attemptIndex).catch(() => {
          doRetry(
            options,
            Object.assign({}, state, { attemptIndex: attemptIndex + 1 })
          );
        });
      },
      typeof retryDelay === "function" ? retryDelay(attemptIndex) : retryDelay
    );
  }
}

// ../../node_modules/gqty/Error/index.mjs
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var GQtyError = class _GQtyError extends Error {
  constructor(message, { graphQLErrors, otherError } = {}) {
    super(message);
    __publicField(this, "name", "GQtyError");
    __publicField(this, "graphQLErrors");
    __publicField(this, "otherError");
    if (graphQLErrors) this.graphQLErrors = graphQLErrors;
    if (otherError !== void 0) this.otherError = otherError;
  }
  toJSON() {
    return {
      message: this.message,
      graphQLErrors: this.graphQLErrors,
      otherError: this.otherError
    };
  }
  static create(error) {
    let newError;
    if (error instanceof _GQtyError) {
      newError = error;
    } else if (error instanceof Error) {
      newError = Object.assign(new _GQtyError(error.message), error);
    } else {
      newError = new _GQtyError("Unexpected error type", {
        otherError: error
      });
    }
    return newError;
  }
  static fromGraphQLErrors(errors) {
    return new _GQtyError(
      errors.length === 1 && errors[0].message || (false ? `GraphQL Errors` : "GraphQL Errors, please check .graphQLErrors property"),
      { graphQLErrors: errors }
    );
  }
};

// ../../node_modules/gqty/Cache/utils.mjs
var isCacheObject = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const obj = value;
  if (obj.__typename && typeof obj.__typename !== "string") return false;
  return true;
};

// ../../node_modules/gqty/Cache/normalization.mjs
var refKey = Symbol("__ref");
var isNormalizedObjectShell = (value) => shells.has(value);
var deshell = (input) => isNormalizedObjectShell(input) ? input.toJSON() : input;
var shells = /* @__PURE__ */ new Set();
var normalizeObject = (data, { identity, onConflict = (_, t) => t, store }) => {
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new GQtyError(
      `Only objects can be normalized, received ${typeof data}.`
    );
  }
  const id = identity(data);
  if (!id) return;
  const existing = store.get(id);
  data = deshell(data);
  if (existing) {
    data = deepAssign({}, [existing.toJSON(), data], onConflict);
    existing.$set(data);
    return existing;
  } else {
    const result = new Proxy(
      { [refKey]: data },
      {
        ownKeys(target) {
          return Reflect.ownKeys(target[refKey]);
        },
        getOwnPropertyDescriptor(target, key) {
          return Reflect.getOwnPropertyDescriptor(target[refKey], key);
        },
        set(target, key, value) {
          return Reflect.set(target[refKey], key, value);
        },
        get(target, key) {
          var _a;
          if (key === "$set") {
            return (value) => {
              target[refKey] = value;
            };
          }
          if (key === "toJSON") {
            return () => target[refKey];
          }
          return (_a = Reflect.get(target, key)) != null ? _a : Reflect.get(target[refKey], key);
        }
      }
    );
    shells.add(result);
    store.set(id, result);
    return result;
  }
};
var deepNormalizeObject = (data, options) => {
  return walk(data);
  function walk(input, depth = 0) {
    if (depth < 15 && input && typeof input === "object") {
      for (const [key, value] of Object.entries(input)) {
        input[key] = walk(value, depth + 1);
      }
      if (!Array.isArray(input) && isCacheObject(input)) {
        const id = options.identity(input);
        if (id) {
          const norbj = normalizeObject(input, options);
          if (norbj) {
            return norbj;
          }
        }
      }
    }
    return input;
  }
};
var defaultNormalizationHandler = Object.freeze({
  identity(value) {
    var _a;
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const identityFields = [value.__typename, (_a = value.id) != null ? _a : value._id];
    if (identityFields.some((field) => field === void 0)) return;
    return identityFields.join(":");
  },
  onConflict(existing, incoming) {
    const mergeObjects = (a, b) => {
      const result = { ...a, ...b };
      if (isNormalizedObjectShell(a)) {
        a.$set(result);
        return a;
      } else if (isNormalizedObjectShell(b)) {
        b.$set(result);
        return b;
      }
      return result;
    };
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      if (existing.length === incoming.length) {
        return;
      } else {
        existing.splice(0, existing.length, ...incoming);
      }
      return existing;
    } else if (isCacheObject(existing) && isCacheObject(incoming)) {
      return mergeObjects(existing, incoming);
    }
    return;
  }
});

// ../../node_modules/gqty/Cache/persistence.mjs
var isCacheReference = (value) => isPlainObject(value) && typeof value.__ref === "string";
var importCacheSnapshot = (snapshot, options) => {
  const { query: query2, mutation: mutation2, subscription: subscription2, normalized = {} } = deepCopy(snapshot);
  const seen = /* @__PURE__ */ new Set();
  const data = crawl(
    { query: query2, mutation: mutation2, subscription: subscription2 },
    (it, key, parent) => {
      if (isCacheReference(it)) {
        const norbj = normalized[it.__ref];
        Reflect.set(parent, key, norbj);
        if (!seen.has(norbj)) {
          seen.add(norbj);
          return [norbj, 0, []];
        }
      }
      return;
    }
  );
  if (options) {
    data.normalizedObjects = Object.entries(normalized).reduce(
      (store, [key, value]) => {
        const norbject = normalizeObject(value, {
          ...options,
          store
        });
        if (norbject !== void 0) {
          store.set(key, norbject);
        }
        return store;
      },
      new FrailMap()
    );
  }
  return data;
};
var exportCacheSnapshot = ({ query: query2, mutation: mutation2, subscription: subscription2 }, options) => {
  const snapshot = fromJSON(
    toJSON({ query: query2, mutation: mutation2, subscription: subscription2 })
  );
  if (options) {
    const normalized = {};
    crawl(snapshot, (it, key, parent) => {
      const id = options == null ? void 0 : options.identity(it);
      if (!id) return;
      if (!normalized[id]) {
        normalized[id] = isNormalizedObjectShell(it) ? it.toJSON() : it;
      }
      Reflect.set(parent, key, { __ref: id });
    });
    if (Object.keys(normalized).length > 0) {
      snapshot.normalized = normalized;
    }
  }
  return snapshot;
};
var createPersistors = (cache2) => ({
  persist(version2) {
    const snapshot = cache2.toJSON();
    if (version2 !== void 0) {
      snapshot.version = version2;
    }
    return snapshot;
  },
  restore(data, version2) {
    if (data.version !== version2 || version2 !== void 0 && typeof version2 !== "string") {
      console.warn(`[GQty] Cache version mismatch, ignored.`);
      return false;
    }
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      return false;
    }
    try {
      cache2.restore(data);
    } catch (e) {
      console.warn(e);
    }
    return true;
  },
  async restoreAsync(data, version2) {
    try {
      return this.restore(await data(), version2);
    } catch {
      return false;
    }
  }
});

// ../../node_modules/gqty/Cache/index.mjs
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);
var _maxAge;
var _staleWhileRevalidate;
var _normalizationOptions;
var _data;
var _normalizedObjects;
var _dataRefs;
var _subscriptions;
var _normalizedSubscriptions;
var _Cache_instances;
var subscribeNormalized_fn;
var _notifySubscribers;
var MINIMUM_CACHE_AGE = 100;
var Cache = class {
  constructor(data, {
    maxAge = Infinity,
    staleWhileRevalidate = 5 * 30 * 1e3,
    normalization
  } = {}) {
    __privateAdd(this, _Cache_instances);
    __privateAdd(this, _maxAge, Infinity);
    __privateAdd(this, _staleWhileRevalidate, 0);
    __privateAdd(this, _normalizationOptions);
    __privateAdd(this, _data, new FrailMap());
    __privateAdd(this, _normalizedObjects, new FrailMap());
    __privateAdd(this, _dataRefs, /* @__PURE__ */ new Set());
    __privateAdd(this, _subscriptions, /* @__PURE__ */ new Map());
    __privateAdd(this, _normalizedSubscriptions, new MultiDict());
    __privateAdd(this, _notifySubscribers, (value) => {
      var _a, _b;
      const listeners = /* @__PURE__ */ new Set();
      const subs = __privateGet(this, _subscriptions);
      const nsubs = __privateGet(this, _normalizedSubscriptions);
      const getId = (_a = this.normalizationOptions) == null ? void 0 : _a.identity;
      for (const [paths, notify] of __privateGet(this, _subscriptions)) {
        for (const path of paths) {
          const parts = path.split(".");
          const node = select(value, parts, (node2) => {
            var _a2;
            if ((getId == null ? void 0 : getId(node2)) && isCacheObject(node2)) {
              (_a2 = nsubs.get(node2)) == null ? void 0 : _a2.forEach((notify2) => {
                listeners.add(notify2);
              });
              nsubs.set(node2, notify);
            }
            return node2;
          });
          if (Array.isArray(node) ? node.flat(Infinity).some((item) => item !== void 0) : node !== void 0) {
            listeners.add(notify);
            break;
          }
        }
      }
      if (getId) {
        const norbjs = /* @__PURE__ */ new Set();
        crawl(value, (node) => {
          if (getId(node) && isCacheObject(node)) {
            norbjs.add(node);
          }
        });
        const resubscribingListeners = /* @__PURE__ */ new Set();
        for (const norbj of norbjs) {
          for (const listener of (_b = nsubs.get(norbj)) != null ? _b : []) {
            listeners.add(listener);
            resubscribingListeners.add(listener);
          }
        }
        for (const listener of resubscribingListeners) {
          for (const [paths, _listener] of subs) {
            if (listener === _listener) {
              __privateMethod(this, _Cache_instances, subscribeNormalized_fn).call(this, paths, listener);
            }
          }
        }
      }
      if (listeners.size > 0) {
        const valueSnapshot = deepCopy(value);
        for (const notify of listeners) {
          notify(valueSnapshot);
        }
      }
    });
    __privateSet(this, _maxAge, Math.max(maxAge, MINIMUM_CACHE_AGE));
    __privateSet(this, _staleWhileRevalidate, Math.max(staleWhileRevalidate, 0));
    if (normalization) {
      __privateSet(this, _normalizationOptions, normalization === true ? defaultNormalizationHandler : Object.freeze({ ...normalization }));
    }
    if (data) {
      this.restore(data);
    }
  }
  /**
   * Maximum age of cache data in milliseconds, expired data nodes are subjected
   * to garbage collection.
   */
  get maxAge() {
    return __privateGet(this, _maxAge);
  }
  /**
   * Maximum time in milliseconds to keep stale data in cache, while allowing
   * stale-while-revalidate background fetches.
   */
  get staleWhileRevalidate() {
    return __privateGet(this, _staleWhileRevalidate);
  }
  get normalizationOptions() {
    return __privateGet(this, _normalizationOptions);
  }
  restore(data) {
    var _a;
    const { query: query2, mutation: mutation2, subscription: subscription2, normalizedObjects } = (_a = importCacheSnapshot(data, this.normalizationOptions)) != null ? _a : {};
    __privateSet(this, _normalizedObjects, normalizedObjects != null ? normalizedObjects : new FrailMap());
    __privateSet(this, _data, new FrailMap());
    this.set({ query: query2, mutation: mutation2, subscription: subscription2 }, { skipNotify: true });
  }
  /** Subscribe to cache changes. */
  subscribe(paths, fn) {
    const pathsSnapshot = Object.freeze([...paths]);
    __privateGet(this, _subscriptions).set(pathsSnapshot, fn);
    __privateMethod(this, _Cache_instances, subscribeNormalized_fn).call(this, paths, fn);
    return () => {
      __privateGet(this, _subscriptions).delete(pathsSnapshot);
      __privateGet(this, _normalizedSubscriptions).delete(fn);
    };
  }
  /**
   * Retrieve cache values by first 2 path segments, e.g. `query.todos` or
   * `mutation.createTodo`.
   */
  get(path, options) {
    var _a;
    const [, type, key, subpath] = (_a = path.match(/^([a-z]+(?:\w*))\.(?:__)?([a-z]+(?:\w*))(.*[^.])?$/i)) != null ? _a : [];
    if (!type || !key) {
      throw new ReferenceError(
        "Cache path must starts with `${type}.`: " + path
      );
    }
    const cacheKey = `${type}.${key}`;
    const dataContainer = __privateGet(this, _data).get(cacheKey);
    if (dataContainer === void 0) return;
    const { expiresAt, swrBefore } = dataContainer;
    let { data } = dataContainer;
    if (expiresAt < Date.now() && !(options == null ? void 0 : options.includeExpired)) {
      data = void 0;
    } else if (subpath) {
      data = select(data, subpath.slice(1).split("."));
    }
    return {
      data,
      get expiresAt() {
        return expiresAt;
      },
      get swrBefore() {
        return swrBefore;
      }
    };
  }
  /**
   * Merge objects into the current cache, recursively normalize incoming values
   * if normalization is enabled. Notifies cache listeners afterwards.
   *
   * Example value: `{ query: { foo: "bar" } }`
   */
  set(values, { skipNotify = false } = {}) {
    var _a;
    const age = this.maxAge;
    const swr = this.staleWhileRevalidate;
    const now = Date.now();
    if (this.normalizationOptions) {
      values = deepNormalizeObject(values, {
        ...this.normalizationOptions,
        store: __privateGet(this, _normalizedObjects)
      });
    }
    for (const [type, cacheObjects = {}] of Object.entries(values)) {
      for (const [field, data] of Object.entries(cacheObjects)) {
        const cacheKey = `${type}.${field}`;
        let unrefTimer;
        const unref = () => {
          clearTimeout(unrefTimer);
          __privateGet(this, _dataRefs).delete(dataContainer);
        };
        const dataContainer = (
          // Mutation and subscription results should be returned right away for
          // immediate use. Their responses are only meaningful to a cache with
          // normalization enabled, where it already updates listeners.
          //
          // We force a short expiration here to let it survive the next render.
          type === "mutation" || type === "subscription" ? {
            data,
            expiresAt: now + 100,
            swrBefore: now,
            unref
          } : {
            data,
            expiresAt: age + now,
            swrBefore: age + swr + now,
            unref
          }
        );
        const existing = __privateGet(this, _data).get(cacheKey);
        if (existing) {
          (_a = existing.unref) == null ? void 0 : _a.call(existing);
          Object.assign(existing, dataContainer);
        } else {
          __privateGet(this, _data).set(cacheKey, dataContainer, { strong: !isFinite(age) });
        }
        if (isFinite(age + swr)) {
          unrefTimer = setTimeout(unref, age + swr);
          if (typeof unrefTimer === "object") {
            unrefTimer.unref();
          }
          __privateGet(this, _dataRefs).add(dataContainer);
        }
      }
    }
    if (!skipNotify) {
      __privateGet(this, _notifySubscribers).call(this, values);
    }
  }
  clear() {
    __privateGet(this, _data).clear();
    __privateGet(this, _normalizedObjects).clear();
    __privateGet(this, _dataRefs).clear();
  }
  toJSON() {
    const snapshot = (
      // Remove skeletons
      crawl(
        [...__privateGet(this, _data)].reduce((prev, [key, { data }]) => {
          objectSafeSet(prev, key, data);
          return prev;
        }, {}),
        (it, key, obj) => {
          if (isSkeleton(it)) {
            Reflect.deleteProperty(obj, key);
          }
        }
      )
    );
    if (this.normalizationOptions) {
      return exportCacheSnapshot(snapshot, this.normalizationOptions);
    } else {
      return snapshot;
    }
  }
};
_maxAge = /* @__PURE__ */ new WeakMap();
_staleWhileRevalidate = /* @__PURE__ */ new WeakMap();
_normalizationOptions = /* @__PURE__ */ new WeakMap();
_data = /* @__PURE__ */ new WeakMap();
_normalizedObjects = /* @__PURE__ */ new WeakMap();
_dataRefs = /* @__PURE__ */ new WeakMap();
_subscriptions = /* @__PURE__ */ new WeakMap();
_normalizedSubscriptions = /* @__PURE__ */ new WeakMap();
_Cache_instances = /* @__PURE__ */ new WeakSet();
subscribeNormalized_fn = function(paths, fn) {
  var _a, _b;
  const getId = (_a = this.normalizationOptions) == null ? void 0 : _a.identity;
  if (!getId) return;
  const store = __privateGet(this, _normalizedObjects);
  const nsubs = __privateGet(this, _normalizedSubscriptions);
  nsubs.delete(fn);
  for (const path of paths) {
    const [type, field, ...parts] = path.split(".");
    select(
      (_b = this.get(`${type}.${field}`, { includeExpired: true })) == null ? void 0 : _b.data,
      parts,
      (node) => {
        const id = getId(node);
        if (id && store.has(id) && isCacheObject(node)) {
          nsubs.set(node, fn);
        }
        return node;
      }
    );
  }
};
_notifySubscribers = /* @__PURE__ */ new WeakMap();

// ../../node_modules/gqty/Selection.mjs
var __defProp2 = Object.defineProperty;
var __defNormalProp2 = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField2 = (obj, key, value) => __defNormalProp2(obj, typeof key !== "symbol" ? key + "" : key, value);
var createSymbol = Symbol();
var aliasGenerator = {
  seq: 0,
  map: /* @__PURE__ */ new WeakMap(),
  hash,
  get(key, input) {
    var _a;
    const hash2 = this.hash({ key, ...input });
    if (hash2) return hash2;
    const seq = (_a = this.map.get(input)) != null ? _a : this.seq++;
    if (seq >= Number.MAX_SAFE_INTEGER) {
      throw new GQtyError(`selection alias fallback overflow`);
    }
    this.map.set(input, seq);
    return `alias${seq}`;
  }
};
var Selection = class _Selection {
  constructor(key, options = {}, token) {
    this.key = key;
    this.options = options;
    __publicField2(this, "children", /* @__PURE__ */ new Map());
    if (token !== createSymbol) {
      throw new GQtyError(`Use Selection.createRoot() instead.`);
    }
  }
  get alias() {
    return this.options.alias;
  }
  get aliasLength() {
    var _a, _b, _c;
    return (_c = (_b = this.options.aliasLength) != null ? _b : (_a = this.parent) == null ? void 0 : _a.aliasLength) != null ? _c : 6;
  }
  get input() {
    return this.options.input;
  }
  /** Indicates current selection being a inteface/union key. */
  get isUnion() {
    var _a;
    return (_a = this.options.isUnion) != null ? _a : false;
  }
  get parent() {
    return this.options.parent;
  }
  get root() {
    var _a, _b;
    return (_b = (_a = this.options.parent) == null ? void 0 : _a.root) != null ? _b : this;
  }
  get cacheKeys() {
    var _a, _b, _c, _d;
    const keys2 = (_b = (_a = this.parent) == null ? void 0 : _a.cacheKeys) != null ? _b : [];
    if (typeof this.key === "number" || this.key === "$on" || ((_c = this.parent) == null ? void 0 : _c.key) === "$on") {
      return keys2;
    }
    return keys2.concat((_d = this.alias) != null ? _d : this.key);
  }
  /** The selection path from root the leaf as an array. */
  get ancestry() {
    const ancestry = [];
    let node = this;
    do {
      ancestry.unshift(node);
    } while (node = node.parent);
    return ancestry;
  }
  static createRoot(key, options) {
    return new _Selection(key, options, createSymbol);
  }
  getChild(key, options) {
    var _a, _b, _c;
    const alias = (_b = options == null ? void 0 : options.alias) != null ? _b : (options == null ? void 0 : options.input) ? aliasGenerator.get(key, options.input).slice(0, (_a = options == null ? void 0 : options.aliasLength) != null ? _a : this.aliasLength) : void 0;
    const hashKey = alias != null ? alias : key.toString();
    const selection = (_c = this.children.get(hashKey)) != null ? _c : new _Selection(key, { ...options, alias, parent: this }, createSymbol);
    this.children.set(hashKey, selection);
    return selection;
  }
  getLeafNodes() {
    const result = /* @__PURE__ */ new Set();
    const stack = /* @__PURE__ */ new Set([this]);
    for (const selection of stack) {
      if (selection.children.size === 0) {
        result.add(selection);
      } else {
        for (const [, child] of selection.children) stack.add(child);
      }
    }
    return result;
  }
  toJSON() {
    return this.ancestry.map(({ key, isUnion, input, options }) => {
      if (isUnion) {
        return [key, { isUnion, ...options }];
      } else if (input) {
        return [key, { input }];
      } else {
        return [key];
      }
    });
  }
  fromJSON(json) {
    let node = this;
    for (const [key, options] of json) {
      node = node.getChild(key, options);
    }
    return node;
  }
  get [Symbol.toStringTag]() {
    return "Selection";
  }
  toString() {
    var _a, _b;
    return `Selection(${this.cacheKeys.join(".")}) ${JSON.stringify(
      (_b = (_a = this.input) == null ? void 0 : _a.values) != null ? _b : {}
    )}`;
  }
};

// ../../node_modules/gqty/Schema.mjs
var SchemaUnionsKey = Symbol("unionsKey");
var parseSchemaType = functionMemoize(
  (type, fieldDesc = void 0) => {
    let isArray = false;
    let isNullable = true;
    const hasDefaultValue = !!(fieldDesc && fieldDesc.defaultValue !== null);
    let pureType = type;
    let nullableItems = true;
    if (pureType.endsWith("!")) {
      isNullable = false;
      pureType = pureType.slice(0, pureType.length - 1);
    }
    if (pureType.startsWith("[")) {
      pureType = pureType.slice(1, pureType.length - 1);
      isArray = true;
      if (pureType.endsWith("!")) {
        nullableItems = false;
        pureType = pureType.slice(0, pureType.length - 1);
      }
    }
    return {
      pureType,
      isNullable,
      hasDefaultValue,
      isArray,
      nullableItems
    };
  }
);

// ../../node_modules/gqty/Accessor/resolve.mjs
var verbose = true;
var resolve = (accessor, selection, __type) => {
  var _a, _b;
  const meta = $meta(accessor);
  if (!meta) return;
  const { context } = meta;
  const { alias, key, isUnion, cacheKeys } = selection;
  const isNumericSelection = +key === +key;
  if (cacheKeys.length >= context.depthLimit) {
    if (verbose) {
      throw new GQtyError(
        `Depth limit reached at ${cacheKeys.join(
          "."
        )}, ignoring further selections.`
      );
    }
    return;
  }
  const cache2 = selection.parent === selection.root && key !== "__typename" ? (
    // The way we structure the cache for SWR requires special treatment
    // for 2nd level selections, e.g. query.hello, mutation.update()... etc.
    ensureCache(cacheKeys[0], cacheKeys[1], meta)
  ) : Object.defineProperties(
    { data: void 0, expiresAt: Infinity },
    Object.getOwnPropertyDescriptors(meta.cache)
  );
  let data = cache2.data;
  const { pureType, isArray, isNullable } = parseSchemaType(__type);
  const type = context.schema[pureType];
  if (!isUnion && selection.root !== selection && (selection.root !== selection.parent || key === "__typename") && data !== null) {
    if (Array.isArray(data)) {
      if (verbose && !isNumericSelection) {
        console.warn(`[GQty] Accessing arrays with non-numeric key "${key}".`);
      }
      data = data[+key];
    } else if (typeof data === "object") {
      data = data[alias != null ? alias : key];
    }
  }
  if (data === null) {
    if (!isNullable) {
      throw new GQtyError(`Cached null for non-nullable type ${pureType}.`);
    }
    if (context.scalars[pureType]) {
      context.select(selection, cache2);
    } else {
      context.select(selection);
    }
    return null;
  }
  if (!type) {
    if (context.scalars[pureType]) {
      if (cache2.expiresAt === -Infinity) {
        data = (_a = context.cache.get(
          selection.cacheKeys.join("."),
          context.cacheOptions
        )) == null ? void 0 : _a.data;
      }
      context.select(selection, { ...cache2, data });
      return isArray ? Array.isArray(data) ? data : [void 0] : data;
    }
    const unions = (_b = context.schema[SchemaUnionsKey]) == null ? void 0 : _b[pureType.slice(1)];
    if (unions == null ? void 0 : unions.length) {
      return createUnionAccessor({
        context,
        cache: meta.cache,
        possibleTypes: unions,
        selection
      });
    }
    throw new GQtyError(`GraphQL type not found: ${pureType}`);
  }
  if (data === void 0) {
    data = createSkeleton(() => ({}));
    if (isArray && !isNumericSelection) {
      data = createSkeleton(() => [data]);
    }
    if (cacheKeys.length === 2) {
      const [type2, field] = cacheKeys;
      context.cache.set({ [type2]: { [field]: data } });
    }
  }
  if (cacheKeys.length > 2 && cache2.data && typeof cache2.data === "object" && !Array.isArray(cache2.data) && !isNumericSelection) {
    cache2.data[alias != null ? alias : key] = data;
  }
  cache2.data = data;
  if (isArray && !isNumericSelection) {
    return createArrayAccessor({
      cache: cache2,
      context,
      selection,
      type: { __type: pureType }
    });
  } else {
    return createObjectAccessor({
      cache: cache2,
      context,
      selection,
      type: { __type }
    });
  }
};
var createUnionAccessor = ({
  context,
  cache: cache2,
  possibleTypes,
  selection
}) => {
  return new Proxy(
    Object.fromEntries(possibleTypes.map((__typename) => [__typename, true])),
    {
      get(_, __typename) {
        if (typeof __typename !== "string") return;
        if (!possibleTypes.includes(__typename)) return;
        const data = cache2.data;
        if (!isSkeleton(data) && (!isCacheObject(data) || data.__typename !== __typename))
          return;
        const type = context.schema[__typename];
        if (!type) return;
        return createObjectAccessor({
          context,
          cache: cache2,
          selection: selection.getChild(__typename, { isUnion: true }),
          type: { __type: __typename }
        });
      }
    }
  );
};
var objectProxyHandler = {
  get(currentType, key, proxy) {
    if (typeof key !== "string") return;
    if (key === "toJSON") {
      return () => {
        var _a;
        const data = (_a = $meta(proxy)) == null ? void 0 : _a.cache.data;
        if (typeof data !== "object" || data === null) {
          return data;
        }
        return Object.entries(data).reduce(
          (prev, [key2, value]) => {
            if (!isSkeleton(value)) {
              prev[key2] = value;
            }
            return prev;
          },
          {}
        );
      };
    }
    const meta = $meta(proxy);
    if (!meta) return;
    if (
      // Skip Query, Mutation and Subscription
      meta.selection.parent !== void 0 && // Prevent infinite recursions
      !getIdentityFields(meta).includes(key)
    ) {
      selectIdentityFields(proxy, currentType);
    }
    const targetType = currentType[key];
    if (!targetType || typeof targetType !== "object") return;
    const { __args, __type } = targetType;
    if (__args) {
      return (args) => resolve(
        proxy,
        meta.selection.getChild(
          key,
          args ? { input: { types: __args, values: args } } : {}
        ),
        __type
      );
    }
    return resolve(proxy, meta.selection.getChild(key), __type);
  },
  set(_, key, value, proxy) {
    var _a, _b, _c;
    const meta = $meta(proxy);
    if (typeof key !== "string" || !meta) return false;
    const { cache: cache2, context, selection } = meta;
    value = (_a = deepMetadata(value)) != null ? _a : value;
    if (selection.ancestry.length <= 2) {
      const [type, field] = selection.cacheKeys;
      if (field) {
        const data = (_c = (_b = context.cache.get(`${type}.${field}`, context.cacheOptions)) == null ? void 0 : _b.data) != null ? _c : {};
        if (!isPlainObject(data)) return false;
        data[key] = value;
        context.cache.set({ [type]: { [field]: data } });
      } else {
        context.cache.set({ [type]: { [key]: value } });
      }
    }
    let result = false;
    if (isCacheObject(cache2.data)) {
      result = Reflect.set(cache2.data, key, value);
    }
    for (const [keys2, scalar] of flattenObject(value)) {
      let currentSelection = selection.getChild(key);
      for (const key2 of keys2) {
        currentSelection = currentSelection.getChild(key2);
      }
      context.select(currentSelection, { ...cache2, data: scalar });
    }
    return result;
  }
};
var createObjectAccessor = (meta) => {
  const {
    cache: { data },
    context: { schema: schema2 },
    type: { __type }
  } = meta;
  if (data !== void 0 && !isCacheObject(data)) {
    throw new GQtyError(
      `Invalid type ${data === null ? "null" : typeof data} for object accessors.`
    );
  }
  const createAccessor = () => {
    const type = schema2[parseSchemaType(__type).pureType];
    if (!type) throw new GQtyError(`Invalid schema type ${__type}.`);
    const proxy = new Proxy(
      // `type` here for ownKeys proxy trap
      type,
      data ? Object.assign({}, objectProxyHandler, {
        getOwnPropertyDescriptor: (target, key) => {
          var _a;
          return (_a = Reflect.getOwnPropertyDescriptor(data, key)) != null ? _a : Reflect.getOwnPropertyDescriptor(target, key);
        }
      }) : objectProxyHandler
    );
    $meta.set(proxy, meta);
    return proxy;
  };
  return createAccessor();
};
var deepMetadata = (input) => {
  const data = metadata(input);
  const stack = /* @__PURE__ */ new Set([data]);
  const seen = /* @__PURE__ */ new Set();
  for (const it of stack) {
    if (seen.has(it)) continue;
    seen.add(it);
    if (Array.isArray(it)) {
      for (const [k, v] of it.entries()) {
        if (isObject2(v)) {
          stack.add(it[k] = metadata(v));
        } else {
          stack.add(v);
        }
      }
    } else if (isObject2(it)) {
      for (const [k, v] of Object.entries(it)) {
        if (isObject2(v)) {
          stack.add(it[k] = metadata(v));
        } else {
          stack.add(v);
        }
      }
    }
  }
  return data;
  function metadata(it) {
    var _a, _b;
    return (_b = (_a = $meta(it)) == null ? void 0 : _a.cache.data) != null ? _b : it;
  }
  function isObject2(it) {
    return typeof it === "object" && it !== null;
  }
};
var ensureCache = (type, field, { context: { cache: cache2, cacheOptions } }) => {
  if (!cache2.get(`${type}.${field}`, cacheOptions)) {
    cache2.set({ [type]: { [field]: void 0 } });
  }
  const { data } = cache2.get(`${type}.${field}`, cacheOptions);
  return {
    data,
    get expiresAt() {
      var _a, _b;
      return (_b = (_a = cache2.get(`${type}.${field}`, cacheOptions)) == null ? void 0 : _a.expiresAt) != null ? _b : -Infinity;
    },
    get swrBefore() {
      var _a, _b;
      return (_b = (_a = cache2.get(`${type}.${field}`, cacheOptions)) == null ? void 0 : _a.swrBefore) != null ? _b : -Infinity;
    }
  };
};
var getIdentityFields = ({
  context: { typeKeys },
  type: { __type }
}) => {
  var _a;
  const { pureType } = parseSchemaType(__type);
  return (_a = typeKeys == null ? void 0 : typeKeys[pureType]) != null ? _a : ["__typename", "id", "_id"];
};
var selectIdentityFields = (accessor, type) => {
  var _a;
  if (accessor == null) return;
  const meta = $meta(accessor);
  if (!meta) return;
  const {
    selection: { parent, isUnion }
  } = meta;
  if ((parent == null ? void 0 : parent.key) !== "$on") {
    accessor.__typename;
  }
  const keys2 = getIdentityFields(meta);
  for (const key of keys2) {
    if (!type[key]) continue;
    if (isUnion && ((_a = parent == null ? void 0 : parent.parent) == null ? void 0 : _a.children.has(key))) continue;
    accessor[key];
  }
};
var arrayProxyHandler = {
  get(_, key, proxy) {
    const meta = $meta(proxy);
    if (!meta) return;
    if (key === "toJSON" && !isSkeleton(meta.cache.data)) {
      return () => {
        var _a;
        return (_a = $meta(proxy)) == null ? void 0 : _a.cache.data;
      };
    }
    const {
      cache: { data },
      selection
    } = meta;
    if (!Array.isArray(data)) return;
    if (typeof key === "string") {
      if (!Array.isArray(data)) {
        throw new GQtyError(`Cache data must be an array.`);
      }
      if (key === "length") proxy[0];
      const numKey = +key;
      if (!isNaN(numKey) && numKey < data.length) {
        return resolve(proxy, selection.getChild(numKey), meta.type.__type);
      }
    }
    const value = Reflect.get(data, key);
    if (typeof value === "function") {
      return value.bind(proxy);
    }
    return value;
  },
  set(_, key, value, proxy) {
    var _a, _b;
    if (typeof key === "symbol" || key !== "length" && +key !== +key) {
      throw new GQtyError(`Invalid array assignment.`);
    }
    const meta = $meta(proxy);
    if (!meta) return false;
    const {
      cache: { data }
    } = meta;
    if (!Array.isArray(data)) return false;
    value = (_b = (_a = $meta(value)) == null ? void 0 : _a.cache.data) != null ? _b : value;
    return Reflect.set(data, key, value);
  }
};
var createArrayAccessor = (meta) => {
  const { cache: cache2, context, selection } = meta;
  if (!Array.isArray(cache2.data)) {
    if (verbose) {
      console.warn(
        "Invalid cache for an array accessor, monkey-patch by wrapping it with an array.",
        meta,
        meta.context.cache.toJSON()
      );
    }
    cache2.data = [cache2.data];
  }
  if (cache2.data.length === 0) {
    context.select(selection);
  }
  const proxy = new Proxy(cache2.data, arrayProxyHandler);
  $meta.set(proxy, meta);
  return proxy;
};

// ../../node_modules/gqty/Accessor/index.mjs
function createSchemaAccessor(context) {
  const selectionCache = /* @__PURE__ */ new Map();
  return {
    accessor: new Proxy(
      {
        query: { __typename: "Query" },
        mutation: { __typename: "Mutation" },
        subscription: { __typename: "Subscription" }
      },
      {
        get(target, key) {
          var _a;
          if (key === "toJSON") {
            return () => context.cache.toJSON();
          }
          if (!Reflect.has(target, key) || !Reflect.get(
            target[key],
            "__typename"
          ) || !context.schema[key])
            return;
          const selection = (_a = selectionCache.get(key)) != null ? _a : Selection.createRoot(key, { aliasLength: context.aliasLength });
          selectionCache.set(key, selection);
          return createObjectAccessor({
            context,
            cache: {
              data: target[key],
              expiresAt: Infinity
            },
            selection,
            type: { __type: key }
          });
        }
      }
    ),
    clearCache: () => {
      selectionCache.clear();
    }
  };
}
var setCache = (accessor, data) => {
  var _a, _b;
  const meta = $meta(accessor);
  if (!meta) {
    throw new GQtyError(`Subject must be an accessor.`);
  }
  data = (_b = (_a = $meta(data)) == null ? void 0 : _a.cache.data) != null ? _b : data;
  if (!data || typeof data !== "object") {
    throw new GQtyError(
      `Data must be a subset of the schema object, got type: ${typeof data}.`
    );
  }
  meta.cache.data = data;
  Object.assign(accessor, data);
};
var assignSelections = (source, target) => {
  var _a;
  if (source === null || target === null) return;
  if ($meta(source) === void 0) {
    throw new GQtyError(`Invalid source proxy`);
  }
  if ($meta(target) === void 0) {
    throw new GQtyError(`Invalid target proxy`);
  }
  const sourceSelection = (_a = $meta(source)) == null ? void 0 : _a.selection;
  if (!sourceSelection) return;
  if (sourceSelection.children.size === 0) {
    if (true) {
      console.warn("Source proxy doesn't have any selections made");
    }
  }
  const stack = new Set(sourceSelection.children.values());
  for (const it of stack) {
    if (it.children.size === 0) {
      let currentNode;
      for (const selection of it.ancestry) {
        if (currentNode === void 0) {
          if (selection !== sourceSelection) continue;
          currentNode = target;
        } else {
          const node = currentNode[selection.key];
          if (selection.input) {
            if (typeof node !== "function") {
              throw new GQtyError(
                `Unexpected inputs for selection: ${selection}`
              );
            }
            currentNode = node(selection.input);
          } else {
            currentNode = node;
          }
        }
      }
    } else {
      for (const [, child] of it.children) {
        stack.add(child);
      }
    }
  }
};

// ../../node_modules/gqty/Cache/query.mjs
var nullObjectKey = {};
var deduplicationCache = new WeakMap([[nullObjectKey, /* @__PURE__ */ new Map()]]);
var dedupePromise = (cache2, hash2, fetchOrSubscribe) => {
  var _a, _b;
  const key = cache2 != null ? cache2 : nullObjectKey;
  const queryHashMap = (_a = deduplicationCache.get(key)) != null ? _a : /* @__PURE__ */ new Map();
  if (!deduplicationCache.has(key)) {
    deduplicationCache.set(key, queryHashMap);
  }
  const cachedQueryPromise = (_b = queryHashMap.get(hash2)) != null ? _b : fetchOrSubscribe().finally(() => {
    queryHashMap.delete(hash2);
  });
  if (!queryHashMap.has(hash2)) {
    queryHashMap.set(hash2, cachedQueryPromise);
  }
  return cachedQueryPromise;
};
var getActivePromises = (cache2) => {
  var _a, _b;
  return [
    ...(_b = (_a = deduplicationCache.get(cache2 != null ? cache2 : nullObjectKey)) == null ? void 0 : _a.values()) != null ? _b : []
  ];
};

// ../../node_modules/gqty/Helpers/useMetaStateHack.mjs
var useMetaStateHack_exports = {};
__export(useMetaStateHack_exports, {
  notifyFetch: () => notifyFetch,
  notifyRetry: () => notifyRetry,
  subscribeFetch: () => subscribeFetch,
  subscribeRetry: () => subscribeRetry
});
var retryEventListeners = /* @__PURE__ */ new Set();
var notifyRetry = (promise, selections, isLastTry = false) => {
  for (const listener of retryEventListeners) {
    listener({ promise, selections, isLastTry });
  }
};
var subscribeRetry = (callback) => {
  retryEventListeners.add(callback);
  return () => {
    retryEventListeners.delete(callback);
  };
};
var fetchEventListeners = /* @__PURE__ */ new Set();
var notifyFetch = (promise, selections) => {
  for (const listener of fetchEventListeners) {
    listener({ promise, selections });
  }
};
var subscribeFetch = (callback) => {
  fetchEventListeners.add(callback);
  return () => {
    fetchEventListeners.delete(callback);
  };
};

// ../../node_modules/gqty/QueryBuilder.mjs
var stringifySelectionTree = (tree) => Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)).reduce((prev, [key, value]) => {
  const query2 = typeof value === "object" ? `${key}{${stringifySelectionTree(value)}}` : key;
  if (!prev || prev.endsWith("}") || prev.endsWith("{")) {
    return `${prev}${query2}`;
  } else {
    return `${prev} ${query2}`;
  }
}, "");
var buildQuery = (selections, operationName) => {
  var _a;
  const roots = /* @__PURE__ */ new Map();
  const inputDedupe = /* @__PURE__ */ new Map();
  for (const { ancestry } of selections) {
    const [type, field] = ancestry;
    if (typeof type.key !== "string") continue;
    const rootKey = type.key === "subscription" ? (
      // Subscriptions are fetched separately
      `${type.key}.${(_a = field.alias) != null ? _a : field.key}`
    ) : type.key;
    if (!roots.has(rootKey)) {
      roots.set(rootKey, {
        args: /* @__PURE__ */ new Map(),
        tree: {}
      });
    }
    const root = roots.get(rootKey);
    objectSafeSet(
      root.tree,
      ancestry.reduce((prev, s) => {
        if (typeof s.key === "symbol" || typeof s.key === "number" || s.key === "$on") {
          return prev;
        }
        if (s.isUnion) {
          return [...prev, `...on ${s.key}`];
        }
        const key = s.alias ? `${s.alias}:${s.key}` : s.key;
        const input = s.input;
        if (input && Object.keys(input.values).length > 0) {
          if (!inputDedupe.has(input)) {
            const queryInputs = Object.entries(input.values).map(([key2, value]) => {
              var _a2;
              const variableName = hash(((_a2 = s.alias) != null ? _a2 : s.key) + "_" + key2).slice(
                0,
                s.aliasLength
              );
              root.args.set(`${variableName}`, {
                value,
                type: input.types[key2]
              });
              return `${key2}:$${variableName}`;
            }).filter(Boolean).join(" ");
            inputDedupe.set(input, `${key}(${queryInputs})`);
          }
          return [...prev, inputDedupe.get(input)];
        }
        return [...prev, key];
      }, []),
      true
    );
  }
  return [...roots].map(([key, { args, tree }]) => {
    const rootKey = key.split(".")[0];
    let query2 = stringifySelectionTree(tree);
    if (args.size > 0) {
      query2 = query2.replace(
        rootKey,
        `${rootKey}(${[...args.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, { type }]) => `$${name}:${type}`).join("")})`
      );
    }
    if (operationName) {
      query2 = query2.replace(rootKey, `${rootKey} ${operationName}`);
    }
    return {
      query: query2,
      variables: args.size > 0 ? [...args].reduce(
        (prev, [key2, { value }]) => (prev[key2] = value, prev),
        {}
      ) : void 0,
      operationName,
      extensions: {
        type: rootKey,
        hash: hash({ query: query2, variables: args })
        // For query dedupe and cache keys
      }
    };
  });
};

// ../../node_modules/gqty/Client/subscriber.mjs
var isWsClient = (client2) => client2 !== void 0 && typeof client2.on === "function";
var createSubscriber = (input) => {
  const client2 = input;
  if (client2.onSubscribe !== void 0) {
    return client2;
  }
  const listeners = [];
  client2.on("connected", () => {
    if (!client2.isOnline) {
      client2.isOnline = true;
      listeners.forEach((fn) => fn());
      listeners.length = 0;
    }
  });
  client2.on("closed", () => {
    client2.isOnline = false;
  });
  client2.onSubscribe = (fn) => {
    if (client2.isOnline) {
      fn();
    } else {
      listeners.push(fn);
    }
  };
  return client2;
};

// ../../node_modules/gqty/Client/resolveSelections.mjs
var fetchSelections = (selections, {
  cache: cache2,
  debugger: debug,
  extensions: customExtensions,
  fetchOptions,
  operationName
}) => Promise.all(
  buildQuery(selections, operationName).map(
    async ({
      query: query2,
      variables,
      operationName: operationName2,
      extensions: { type, hash: hash2 } = {}
    }) => {
      if (!type) throw new GQtyError(`Invalid query type: ${type}`);
      if (!hash2) throw new GQtyError(`Expected query hash.`);
      const queryPayload = {
        query: query2,
        variables,
        operationName: operationName2,
        extensions: { ...customExtensions, type, hash: hash2 }
      };
      const promise = dedupePromise(
        cache2,
        hash2,
        type === "subscription" ? () => doSubscribeOnce(queryPayload, fetchOptions) : () => doFetch(queryPayload, { ...fetchOptions, selections })
      ).then(({ data, errors, extensions }) => {
        const result = {
          data,
          extensions: { ...extensions, ...queryPayload.extensions }
        };
        if (errors == null ? void 0 : errors.length) {
          result.error = GQtyError.fromGraphQLErrors(errors);
        }
        return result;
      });
      await (debug == null ? void 0 : debug.dispatch({
        cache: cache2,
        request: queryPayload,
        promise,
        selections
      }));
      return await promise;
    }
  )
);
var subsRef = /* @__PURE__ */ new WeakMap();
var subscribeSelections = (selections, fn, {
  cache: cache2,
  debugger: debug,
  extensions: customExtensions,
  fetchOptions: { subscriber },
  operationName,
  onSubscribe,
  onComplete
}) => {
  const unsubscribers = /* @__PURE__ */ new Set();
  Promise.all(
    buildQuery(selections, operationName).map(
      async ({
        query: query2,
        variables,
        operationName: operationName2,
        extensions: { type, hash: hash2 } = {}
      }) => {
        if (!type) throw new GQtyError(`Invalid query type: ${type}`);
        if (!hash2) throw new GQtyError(`Expected query hash.`);
        if (type === "subscription" && !subscriber) {
          throw new GQtyError(`Missing subscriber for subscriptions.`);
        }
        const queryPayload = {
          query: query2,
          variables,
          operationName: operationName2,
          extensions: { ...customExtensions, type, hash: hash2 }
        };
        let subscriptionId;
        if (isWsClient(subscriber)) {
          if (onSubscribe) {
            subscriber.onSubscribe(onSubscribe);
          }
          if (debug) {
            const unsub = subscriber.on("message", (message) => {
              var _a;
              switch (message.type) {
                case "connection_ack": {
                  break;
                }
                case "subscribe": {
                  if (((_a = message.payload.extensions) == null ? void 0 : _a.hash) !== hash2) return;
                  subscriptionId = message.id;
                  debug.dispatch({
                    cache: cache2,
                    label: `[id=${subscriptionId}] [create]`,
                    request: queryPayload,
                    selections
                  });
                  unsub();
                  break;
                }
              }
            });
          }
        } else {
          subscriptionId = "EventSource";
          onSubscribe == null ? void 0 : onSubscribe();
        }
        const next = ({ data, errors, extensions }) => {
          if (data === void 0) return;
          const result = {
            data,
            extensions: { ...extensions, ...queryPayload.extensions }
          };
          if (errors == null ? void 0 : errors.length) {
            result.error = GQtyError.fromGraphQLErrors(errors);
          }
          debug == null ? void 0 : debug.dispatch({
            cache: cache2,
            label: subscriptionId ? `[id=${subscriptionId}] [data]` : void 0,
            request: queryPayload,
            promise: result.error ? Promise.reject(result) : Promise.resolve(result),
            selections
          });
          fn(result);
        };
        const error = (error2) => {
          if (error2 == null) {
            throw new GQtyError(`Subscription sink closed without an error.`);
          }
          debug == null ? void 0 : debug.dispatch({
            cache: cache2,
            label: subscriptionId ? `[id=${subscriptionId}] [error]` : void 0,
            request: queryPayload,
            selections
          });
          fn({ error: error2, extensions: queryPayload.extensions });
        };
        let dispose;
        const promise = dedupePromise(cache2, hash2, () => {
          return new Promise((complete) => {
            dispose = subscriber == null ? void 0 : subscriber.subscribe(
              queryPayload,
              {
                next,
                error(e) {
                  if (Array.isArray(e)) {
                    error(GQtyError.fromGraphQLErrors(e));
                  } else if (!isCloseEvent(e)) {
                    if (e instanceof Error) {
                      error(GQtyError.create(e));
                    } else {
                      console.error("Unknown subscription error:", e);
                    }
                  }
                  this.complete();
                },
                complete() {
                  debug == null ? void 0 : debug.dispatch({
                    cache: cache2,
                    label: subscriptionId ? `[id=${subscriptionId}] [unsubscribe]` : void 0,
                    request: queryPayload,
                    selections
                  });
                  complete();
                }
              }
            );
          });
        });
        if (dispose) {
          subsRef.set(promise, { dispose, count: 1 });
        } else if (subsRef.get(promise)) {
          subsRef.get(promise).count++;
        }
        unsubscribers.add(() => {
          const ref = subsRef.get(promise);
          if (ref && --ref.count <= 0) {
            setTimeout(() => {
              if (ref.count <= 0) {
                ref.dispose();
              }
            });
          }
        });
        return promise;
      }
    )
  ).finally(() => onComplete == null ? void 0 : onComplete());
  return () => {
    unsubscribers.forEach((fn2) => fn2());
  };
};
var doFetch = async (payload, {
  fetcher,
  retryPolicy,
  selections,
  ...fetchOptions
}) => {
  const doDoFetch = () => fetcher(payload, fetchOptions);
  try {
    const promise = doDoFetch();
    notifyFetch(promise, selections);
    return await promise;
  } catch (error) {
    if (
      // User doesn't want reties
      !retryPolicy || // Let everything unknown through
      !(error instanceof Error) || // GQtyErrors are supposed to be terminating
      error instanceof GQtyError
    ) {
      throw error;
    }
    return new Promise((resolve3, reject) => {
      doRetry(retryPolicy, {
        onLastTry: async () => {
          try {
            const promise = doDoFetch();
            notifyRetry(promise, selections);
            resolve3(await promise);
          } catch (e) {
            reject(e);
          }
        },
        onRetry: async () => {
          const promise = doDoFetch();
          notifyRetry(promise, selections);
          resolve3(await promise);
        }
      });
    });
  }
};
var doSubscribeOnce = async ({ query: query2, variables, operationName }, { subscriber }) => {
  if (!subscriber) {
    throw new GQtyError(`Subscription client is required for subscritions.`);
  }
  return new Promise(
    (resolve3, reject) => {
      let result;
      const unsubscribe = subscriber.subscribe(
        {
          query: query2,
          variables: variables != null ? variables : {},
          operationName: operationName != null ? operationName : void 0
        },
        {
          next(data) {
            result = data;
            unsubscribe();
          },
          error(error) {
            if (isCloseEvent(error)) {
              resolve3(result);
            } else if (Array.isArray(error)) {
              reject(GQtyError.fromGraphQLErrors(error));
            } else {
              reject(error);
            }
          },
          complete() {
            if (!result) {
              throw new GQtyError(`Subscription completed without data`);
            }
            resolve3(result);
          }
        }
      );
    }
  );
};
var isCloseEvent = (input) => {
  var _a, _b;
  const error = input;
  if (!error || typeof error !== "object") return false;
  return error.type === "close" && ((_b = (_a = error.target) == null ? void 0 : _a.constructor) == null ? void 0 : _b.name) === "WebSocket" || typeof error.code === "number" && [
    4004,
    4005,
    4400,
    4401,
    4403,
    4406,
    4408,
    4409,
    4429,
    4499,
    4500,
    4504
  ].includes(error.code);
};

// ../../node_modules/just-extend/index.mjs
var objectExtend = extend;
function extend() {
  var args = [].slice.call(arguments);
  var deep = false;
  if (typeof args[0] == "boolean") {
    deep = args.shift();
  }
  var result = args[0];
  if (isUnextendable(result)) {
    throw new Error("extendee must be an object");
  }
  var extenders = args.slice(1);
  var len = extenders.length;
  for (var i = 0; i < len; i++) {
    var extender = extenders[i];
    for (var key in extender) {
      if (Object.prototype.hasOwnProperty.call(extender, key)) {
        var value = extender[key];
        if (deep && isCloneable(value)) {
          var base = Array.isArray(value) ? [] : {};
          result[key] = extend(
            true,
            Object.prototype.hasOwnProperty.call(result, key) && !isUnextendable(result[key]) ? result[key] : base,
            value
          );
        } else {
          result[key] = value;
        }
      }
    }
  }
  return result;
}
function isCloneable(obj) {
  return Array.isArray(obj) || {}.toString.call(obj) == "[object Object]";
}
function isUnextendable(val) {
  return !val || typeof val != "object" && typeof val != "function";
}

// ../../node_modules/gqty/Client/updateCaches.mjs
var updateCaches = (results, caches, cacheSetOptions) => {
  var _a;
  const errorSet = /* @__PURE__ */ new Set();
  for (const response of results) {
    const { data, error, extensions } = response;
    const type = extensions == null ? void 0 : extensions.type;
    if (!type || typeof type !== "string") {
      if (true) {
        console.warn("[GQty] Missing extensions.type in query result.");
      }
      continue;
    }
    if (data !== void 0) {
      const newValues = {
        [type]: objectExtend(true, {}, data)
      };
      for (const cache2 of caches) {
        cache2.set(newValues, cacheSetOptions);
      }
    }
    if (error) {
      if (!(error instanceof GQtyError) || !((_a = error.graphQLErrors) == null ? void 0 : _a.length)) {
        throw error;
      } else {
        error.graphQLErrors.forEach((error2) => errorSet.add(error2));
      }
    }
  }
  if (errorSet.size) {
    throw GQtyError.fromGraphQLErrors([...errorSet]);
  }
};

// ../../node_modules/gqty/Client/compat/prepareRender.mjs
var isLegacyCacheSnapshot = (json) => {
  if (json != null && !isPlainObject(json)) {
    return false;
  }
  const snapshot = json;
  if (snapshot.cache !== void 0 && !isPlainObject(snapshot.cache)) {
    return false;
  }
  if (snapshot.selections) {
    if (!Array.isArray(snapshot.selections)) {
      return false;
    }
    if (!snapshot.selections.every((selection) => {
      if (!Array.isArray(selection) || !selection.every((it) => {
        if (!Array.isArray(it)) return false;
        if (typeof it[0] !== "string" && typeof it[0] !== "number")
          return false;
        if (it[1] && (!isPlainObject(it[1]) || !isPlainObject(it[1].input) || it[1].isUnion !== void 0 && it[1].isUnion !== true))
          return false;
        return true;
      }))
        return false;
      return true;
    }))
      return false;
  }
  return true;
};
var createLegacyPrepareRender = ({
  cache: cache2,
  debugger: debug,
  fetchOptions,
  subscribeLegacySelections
}) => {
  return async (render) => {
    const ssrCache = new Cache();
    const selections = /* @__PURE__ */ new Set();
    const unsubscribe = subscribeLegacySelections((selection) => {
      selections.add(selection);
    });
    try {
      await render();
    } finally {
      unsubscribe();
    }
    await fetchSelections(
      new Set([...selections].filter((s) => s.root.key !== "subscription")),
      {
        cache: cache2,
        debugger: debug,
        fetchOptions
      }
    ).then(
      (results) => updateCaches(results, [cache2, ssrCache], { skipNotify: true })
    );
    return {
      cacheSnapshot: toJSON(
        Object.keys(cache2.toJSON()).length > 0 ? selections.size > 0 ? { cache: cache2, selections: [...selections] } : { cache: cache2 } : {}
      )
    };
  };
};

// ../../node_modules/gqty/Client/compat/hydrateCache.mjs
var createLegacyHydrateCache = ({
  accessor,
  cache: cache2,
  fetchOptions
}) => ({ cacheSnapshot, shouldRefetch = false }) => {
  const { cache: snapshot, selections: selectionSnapshots } = parseSnapshot(cacheSnapshot);
  if (snapshot) {
    cache2.restore(snapshot);
  }
  if (selectionSnapshots && shouldRefetch) {
    const selections = /* @__PURE__ */ new Set();
    for (const [[root], ...snapshot2] of selectionSnapshots) {
      const { selection } = $meta(
        accessor[root]
      );
      selections.add(selection.fromJSON(snapshot2));
    }
    setTimeout(
      () => {
        fetchSelections(selections, {
          cache: cache2,
          fetchOptions: {
            ...fetchOptions,
            cachePolicy: "no-cache"
            // refetch
          }
        }).then((results) => updateCaches(results, [cache2]));
      },
      shouldRefetch === true ? 0 : shouldRefetch
    );
  }
};
var parseSnapshot = (snapshot) => {
  try {
    const data = fromJSON(snapshot);
    if (!isLegacyCacheSnapshot(data)) {
      throw 1;
    }
    return data;
  } catch {
    throw new GQtyError(`Unrecognized snapshot format.`);
  }
};

// ../../node_modules/gqty/Client/compat/selection.mjs
var __defProp3 = Object.defineProperty;
var __defNormalProp3 = (obj, key, value) => key in obj ? __defProp3(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField3 = (obj, key, value) => __defNormalProp3(obj, typeof key !== "symbol" ? key + "" : key, value);
var LegacySelection = class {
  constructor({
    key,
    prevSelection,
    args,
    argTypes,
    type,
    operationName,
    alias,
    unions,
    id
  }) {
    __publicField3(this, "id");
    __publicField3(this, "key");
    __publicField3(this, "type");
    __publicField3(this, "operationName");
    __publicField3(this, "unions");
    __publicField3(this, "args");
    __publicField3(this, "argTypes");
    __publicField3(this, "alias");
    __publicField3(this, "cachePath", []);
    __publicField3(this, "pathString");
    __publicField3(this, "selectionsList");
    __publicField3(this, "noIndexSelections");
    __publicField3(this, "prevSelection", null);
    __publicField3(this, "currentCofetchSelections", null);
    var _a, _b, _c, _d, _e, _f;
    this.id = id + "";
    this.key = key;
    this.operationName = operationName;
    this.prevSelection = prevSelection != null ? prevSelection : null;
    const pathKey = alias || key;
    const isInterfaceUnionSelection = key === "$on";
    this.cachePath = isInterfaceUnionSelection ? (_a = prevSelection == null ? void 0 : prevSelection.cachePath) != null ? _a : [] : prevSelection ? [...prevSelection.cachePath, pathKey] : [pathKey];
    this.pathString = isInterfaceUnionSelection ? (_b = prevSelection == null ? void 0 : prevSelection.pathString) != null ? _b : "" : `${(_c = prevSelection == null ? void 0 : prevSelection.pathString.concat(".")) != null ? _c : ""}${pathKey}`;
    const prevSelectionsList = (_d = prevSelection == null ? void 0 : prevSelection.selectionsList) != null ? _d : [];
    this.selectionsList = [...prevSelectionsList, this];
    const prevNoSelectionsList = (_e = prevSelection == null ? void 0 : prevSelection.noIndexSelections) != null ? _e : [];
    this.noIndexSelections = typeof key === "string" ? [...prevNoSelectionsList, this] : prevNoSelectionsList;
    if (this.selectionsList.length === this.noIndexSelections.length) {
      this.noIndexSelections = this.selectionsList;
    }
    this.alias = alias;
    this.args = args;
    this.argTypes = argTypes;
    this.unions = unions;
    this.type = (_f = type != null ? type : prevSelection == null ? void 0 : prevSelection.type) != null ? _f : 0;
  }
  addCofetchSelections(selections) {
    const cofetchSet = this.currentCofetchSelections || (this.currentCofetchSelections = /* @__PURE__ */ new Set());
    for (const selection of selections) {
      cofetchSet.add(selection);
    }
  }
  get cofetchSelections() {
    let currentPrevSelection = this.prevSelection;
    while (currentPrevSelection) {
      const currentPrevCofetchSelections = currentPrevSelection.currentCofetchSelections;
      if (currentPrevCofetchSelections) {
        this.addCofetchSelections(currentPrevCofetchSelections);
      }
      currentPrevSelection = currentPrevSelection.prevSelection;
    }
    return this.currentCofetchSelections;
  }
};
var convertSelection = (selection, selectionId = 0, operationName) => {
  var _a, _b;
  return new LegacySelection({
    id: ++selectionId,
    key: selection.key,
    // translate the whole selection chain upwards
    prevSelection: selection.parent ? convertSelection(selection.parent, selectionId, operationName) : void 0,
    args: (_a = selection.input) == null ? void 0 : _a.values,
    argTypes: (_b = selection.input) == null ? void 0 : _b.types,
    type: selection.root.key === "query" ? 0 : selection.root.key === "mutation" ? 1 : 2,
    operationName,
    alias: selection.alias,
    unions: selection.isUnion ? [selection.key.toString()] : void 0
  });
};

// ../../node_modules/gqty/Client/compat/inlineResolved.mjs
var createLegacyInlineResolved = ({
  resolvers: { createResolver },
  subscribeLegacySelections
}) => {
  return (fn, {
    refetch: refetch2 = false,
    onEmptyResolve,
    onSelection,
    onCacheData,
    operationName
  } = {}) => {
    const { context, selections, resolve: resolve3 } = createResolver({
      cachePolicy: refetch2 ? "no-cache" : "default",
      operationName
    });
    const unsubscribe = subscribeLegacySelections((selection, cache2) => {
      context.select(selection, cache2);
      onSelection == null ? void 0 : onSelection(convertSelection(selection));
    });
    context.shouldFetch || (context.shouldFetch = refetch2);
    const data = fn();
    unsubscribe();
    if (selections.size === 0) {
      if (onEmptyResolve) {
        onEmptyResolve();
      } else if (true) {
        console.warn("[gqty] Warning! No data requested.");
      }
      return data;
    }
    if (!context.shouldFetch) {
      return data;
    }
    if (context.hasCacheHit && !refetch2) {
      onCacheData == null ? void 0 : onCacheData(data);
    }
    return resolve3().then(() => fn());
  };
};

// ../../node_modules/gqty/Client/compat/mutate.mjs
var createLegacyMutate = ({
  accessor,
  resolvers: { resolve: resolve3 }
}) => async (fn, { onComplete, onError } = {}) => {
  try {
    const data = await resolve3(({ mutation: mutation2 }) => fn(mutation2), {
      cachePolicy: "no-cache"
    });
    onComplete == null ? void 0 : onComplete(data, {
      query: accessor.query,
      setCache,
      assignSelections
    });
    return data;
  } catch (e) {
    if (e instanceof GQtyError) {
      onError == null ? void 0 : onError(e, {
        query: accessor.query,
        setCache,
        assignSelections
      });
    }
    throw e;
  }
};

// ../../node_modules/gqty/Client/compat/prefetch.mjs
var createLegacyPrefetch = ({
  resolvers: { createResolver },
  subscribeLegacySelections
}) => (fn, { operationName } = {}) => {
  const {
    accessor: { query: query2 },
    context,
    resolve: resolve3
  } = createResolver({ operationName });
  const unsubscribe = subscribeLegacySelections((selection, cache2) => {
    context.select(selection, cache2);
  });
  const data = fn(query2);
  unsubscribe();
  if (!context.shouldFetch) {
    return data;
  }
  return resolve3().then(() => fn(query2));
};

// ../../node_modules/gqty/Client/compat/refetch.mjs
var createRefetch = ({
  cache: cache2,
  fetchOptions,
  inlineResolved,
  selectionHistory
}) => {
  return async (fnOrProxy, operationName) => {
    var _a;
    if (typeof fnOrProxy === "function") {
      return inlineResolved(fnOrProxy, { refetch: true });
    } else {
      const selection = (_a = $meta(fnOrProxy)) == null ? void 0 : _a.selection;
      if (!selection) {
        if (true) {
          console.warn("[gqty] Invalid proxy to refetch!");
        }
        return fnOrProxy;
      }
      const selections = /* @__PURE__ */ new Set();
      for (const leaf of selection.getLeafNodes()) {
        if (selectionHistory.has(leaf)) {
          selections.add(leaf);
        }
      }
      if (selections.size > 0) {
        await fetchSelections(selections, {
          cache: cache2,
          fetchOptions,
          operationName
        }).then((results) => {
          updateCaches(results, [cache2]);
        });
      }
      return fnOrProxy;
    }
  };
};

// ../../node_modules/gqty/Client/compat/resolved.mjs
var createLegacyResolved = ({
  cache: cache2,
  context: globalContext,
  debugger: debug,
  fetchOptions: { fetcher, retryPolicy },
  fetchOptions: clientFetchOptions,
  resolvers: { createResolver },
  subscribeLegacySelections
}) => {
  const resolved2 = async (fn, {
    fetchOptions,
    noCache = false,
    // prevent cache writes after fetch
    //nonSerializableVariables, // Ignored, object-hash can handle files
    onCacheData,
    onEmptyResolve,
    onNoCacheFound,
    onSelection,
    onSubscription,
    operationName,
    refetch: refetch2 = false,
    // prevent cache reads from selections
    retry = retryPolicy
  } = {}) => {
    const { context, selections } = createResolver({
      cachePolicy: noCache ? "no-store" : refetch2 ? "no-cache" : "default",
      operationName
    });
    const unsubscribe = subscribeLegacySelections((selection, cache22) => {
      context.select(selection, cache22);
      onSelection == null ? void 0 : onSelection(convertSelection(selection));
    });
    const resolutionCache = refetch2 ? cache2 : context.cache;
    const targetCaches = noCache ? [context.cache] : refetch2 ? [context.cache, cache2] : [cache2];
    const dataFn = () => {
      globalContext.cache = resolutionCache;
      try {
        return fn();
      } finally {
        globalContext.cache = cache2;
      }
    };
    context.shouldFetch || (context.shouldFetch = noCache || refetch2);
    const data = dataFn();
    unsubscribe();
    if (selections.size === 0) {
      if (onEmptyResolve) {
        onEmptyResolve();
      } else if (true) {
        console.warn("[gqty] Warning! No data requested.");
      }
      return data;
    }
    if (!context.shouldFetch) {
      return data;
    }
    if (context.hasCacheHit) {
      if ((onCacheData == null ? void 0 : onCacheData(data)) === false) {
        return data;
      }
    } else {
      onNoCacheFound == null ? void 0 : onNoCacheFound();
    }
    {
      const unsubscribe2 = subscribeSelections(
        new Set([...selections].filter((s) => s.root.key === "subscription")),
        ({ data: data2, error, extensions }) => {
          var _a, _b, _c;
          if (data2) {
            updateCaches([{ data: data2, extensions }], targetCaches);
          }
          if (error) {
            onSubscription == null ? void 0 : onSubscription({
              type: "with-errors",
              unsubscribe: async () => unsubscribe2(),
              data: (_b = (_a = dataFn()) != null ? _a : data2) != null ? _b : void 0,
              error: GQtyError.create(error)
            });
          } else if (data2) {
            onSubscription == null ? void 0 : onSubscription({
              type: "data",
              unsubscribe: async () => unsubscribe2(),
              data: (_c = dataFn()) != null ? _c : data2
            });
          }
        },
        {
          cache: cache2,
          debugger: debug,
          fetchOptions: clientFetchOptions,
          operationName,
          onSubscribe() {
            onSubscription == null ? void 0 : onSubscription({
              type: "start",
              unsubscribe: async () => unsubscribe2()
            });
          },
          onComplete() {
            onSubscription == null ? void 0 : onSubscription({
              type: "complete",
              unsubscribe: async () => unsubscribe2()
            });
          }
        }
      );
    }
    await fetchSelections(
      new Set([...selections].filter((s) => s.root.key !== "subscription")),
      {
        debugger: debug,
        fetchOptions: { fetcher, retryPolicy: retry, ...fetchOptions },
        operationName
      }
    ).then(
      (results) => updateCaches(results, targetCaches),
      (error) => Promise.reject(GQtyError.create(error))
    );
    return dataFn();
  };
  return resolved2;
};

// ../../node_modules/gqty/Client/compat/track.mjs
var createLegacyTrack = ({
  cache: cache2,
  context: globalContext,
  resolvers: { createResolver },
  subscribeLegacySelections
}) => {
  const track2 = (fn, { onError, operationName, refetch: refetch2 = false } = {}) => {
    const trackedSelections = /* @__PURE__ */ new Set();
    const { context, selections, subscribe: subscribe2 } = createResolver({
      cachePolicy: refetch2 ? "no-cache" : "default",
      operationName
    });
    const resolutionCache = refetch2 ? context.cache : cache2;
    const dataFn = (info) => {
      globalContext.cache = resolutionCache;
      try {
        return fn(info);
      } finally {
        globalContext.cache = cache2;
      }
    };
    const unsubscribe = subscribeLegacySelections((selection, cache22) => {
      context.select(selection, cache22);
    });
    const data = { current: dataFn({ type: "initial" }) };
    for (const selection of selections) {
      trackedSelections.add(selection);
    }
    context.subscribeSelect((selection) => {
      trackedSelections.add(selection);
    });
    unsubscribe();
    const stop = subscribe2({
      onError(error) {
        const theError = GQtyError.create(error);
        if (onError) {
          onError(theError);
        } else {
          throw theError;
        }
      },
      onNext() {
        data.current = dataFn({ type: "cache_change" });
      }
    });
    return { data, selections: trackedSelections, stop };
  };
  return track2;
};

// ../../node_modules/gqty/Client/compat/client.mjs
var createLegacyClient = (options) => {
  const selectionHistory = /* @__PURE__ */ new Set();
  options.context.subscribeSelect((select2) => {
    selectionHistory.add(select2);
  });
  const methodOptions = {
    ...options,
    subscribeLegacySelections(fn) {
      const { context } = options;
      const unsubscribeSelect = context.subscribeSelect(fn);
      const unsubscribeDispose = context.subscribeDispose(unsubscribeSelect);
      return () => {
        unsubscribeDispose();
        unsubscribeSelect();
      };
    }
  };
  const inlineResolved = createLegacyInlineResolved(methodOptions);
  return {
    query: options.accessor.query,
    mutation: options.accessor.mutation,
    subscription: options.accessor.subscription,
    resolved: createLegacyResolved(methodOptions),
    inlineResolved,
    mutate: createLegacyMutate(methodOptions),
    track: createLegacyTrack(methodOptions),
    prefetch: createLegacyPrefetch(methodOptions),
    refetch: createRefetch({
      ...methodOptions,
      selectionHistory,
      inlineResolved
    }),
    prepareRender: createLegacyPrepareRender(methodOptions),
    hydrateCache: createLegacyHydrateCache(methodOptions),
    subscribeLegacySelections: methodOptions.subscribeLegacySelections
  };
};

// ../../node_modules/gqty/Client/compat/queryFetcher.mjs
var createLegacyQueryFetcher = (queryFetcher2) => async ({ query: query2, variables = {} }, fetchOptions) => queryFetcher2(query2, variables, fetchOptions);

// ../../node_modules/gqty/Utils/deferred.mjs
var import_p_defer = __toESM(require_p_defer(), 1);
var asyncItDoneMessage = { done: true };
var createDeferredIterator = () => {
  let deferred = (0, import_p_defer.default)();
  const events = [];
  const next = async () => {
    const value = events.shift();
    if (value !== void 0) {
      return { value, done: false };
    }
    if (!deferred) {
      return asyncItDoneMessage;
    }
    await deferred.promise;
    return next();
  };
  return {
    send: (value) => {
      events.push(value);
      deferred == null ? void 0 : deferred.resolve();
      deferred = (0, import_p_defer.default)();
    },
    complete: () => {
      deferred == null ? void 0 : deferred.resolve();
      deferred = void 0;
    },
    next,
    return: async () => {
      events.splice(0, events.length);
      deferred == null ? void 0 : deferred.resolve();
      deferred = void 0;
      return asyncItDoneMessage;
    },
    throw: async (error) => {
      events.splice(0, events.length);
      deferred == null ? void 0 : deferred.reject(error);
      deferred = void 0;
      return asyncItDoneMessage;
    },
    [Symbol.asyncIterator]() {
      return this;
    },
    async [Symbol.asyncDispose]() {
      await this.return();
    }
  };
};

// ../../node_modules/gqty/Client/compat/subscriptionsClient.mjs
var createLegacySubscriptionsClient = (subscriptionsClient) => {
  const listeners = /* @__PURE__ */ new Map();
  const dispatchEvent = (event, ...args) => {
    const listenersSet = listeners.get(event);
    if (listenersSet) {
      for (const listener of listenersSet) {
        listener(...args);
      }
    }
  };
  const client2 = {
    subscribe: (payload, sink) => {
      var _a;
      const maybePromise = subscriptionsClient.subscribe({
        query: payload.query,
        variables: (_a = payload.variables) != null ? _a : {},
        selections: [],
        events: {
          onStart: () => {
            dispatchEvent("message", {
              type: "connection_ack"
            });
          },
          onComplete: () => {
            sink.complete();
          },
          onData: (data) => {
            sink.next({
              data
            });
          },
          onError({ data, error }) {
            var _a2, _b;
            if (error && !((_a2 = error.graphQLErrors) == null ? void 0 : _a2.length) || !data) {
              sink.error((_b = error.otherError) != null ? _b : error);
            } else {
              sink.next({
                data,
                errors: error.graphQLErrors
              });
            }
          }
        }
      });
      let unsubscribe;
      if (maybePromise instanceof Promise) {
        maybePromise.then(({ operationId, unsubscribe: _unsubscribe }) => {
          unsubscribe = _unsubscribe;
          dispatchEvent("message", {
            id: operationId,
            type: "subscribe",
            payload
          });
        });
      } else {
        const sub = maybePromise;
        unsubscribe = sub.unsubscribe;
        dispatchEvent("message", {
          id: sub.operationId,
          type: "subscribe",
          payload
        });
      }
      return () => {
        if (unsubscribe === void 0) {
          throw new GQtyError(`Subscription has not started yet.`);
        }
        unsubscribe();
        sink.complete();
      };
    },
    iterate(payload) {
      const observable = createDeferredIterator();
      const unsub = this.subscribe(payload, {
        next: observable.send,
        error: observable.throw,
        complete: observable.complete
      });
      return {
        next: observable.next,
        return: () => {
          unsub();
          return observable.return();
        },
        throw: (error) => {
          unsub();
          return observable.throw(error);
        },
        [Symbol.asyncIterator]() {
          return this;
        }
      };
    },
    dispose: () => {
      subscriptionsClient.close();
    },
    terminate: () => {
      subscriptionsClient.close();
    },
    on(event, listener) {
      var _a;
      const untypedListener = listener;
      const listenersSet = (_a = listeners.get(event)) != null ? _a : /* @__PURE__ */ new Set();
      listenersSet.add(untypedListener);
      listeners.set(event, listenersSet);
      return () => {
        listenersSet.delete(untypedListener);
      };
    }
  };
  return client2;
};

// ../../node_modules/gqty/Client/context.mjs
var createContext = ({
  aliasLength,
  cache: cache2,
  cachePolicy,
  depthLimit,
  scalars,
  schema: schema2,
  typeKeys
}) => {
  const disposeSubscriptions = /* @__PURE__ */ new Set();
  const selectSubscriptions = /* @__PURE__ */ new Set();
  return {
    aliasLength,
    cache: cachePolicy === "no-cache" || cachePolicy === "no-store" || cachePolicy === "reload" ? new Cache(void 0, { maxAge: 0 }) : cache2,
    cacheOptions: {
      includeExpired: cachePolicy === "default" || cachePolicy === "force-cache" || cachePolicy === "only-if-cached"
    },
    scalars,
    schema: schema2,
    depthLimit,
    hasCacheHit: false,
    hasCacheMiss: false,
    shouldFetch: false,
    notifyCacheUpdate: cachePolicy !== "default",
    select(selection, cacheNode) {
      const now = Date.now();
      const { data, expiresAt: age = Infinity } = cacheNode != null ? cacheNode : {};
      if (cacheNode) {
        this.shouldFetch || (this.shouldFetch = data === void 0 || // Add 100 ms leeway to avoiding infinite fetch loops for caches with
        // immedidate staleness.
        age < now);
        this.hasCacheHit || (this.hasCacheHit = data !== void 0);
        this.notifyCacheUpdate || (this.notifyCacheUpdate = data === void 0);
      }
      selectSubscriptions.forEach((fn) => fn(selection, cacheNode));
    },
    reset() {
      this.shouldFetch = false;
      this.hasCacheHit = false;
      this.hasCacheMiss = false;
      this.notifyCacheUpdate = cachePolicy !== "default";
    },
    subscribeSelect(callback) {
      selectSubscriptions.add(callback);
      return () => {
        selectSubscriptions.delete(callback);
      };
    },
    dispose() {
      disposeSubscriptions.forEach((fn) => fn());
      disposeSubscriptions.clear();
      selectSubscriptions.clear();
    },
    subscribeDispose(callback) {
      disposeSubscriptions.add(callback);
      return () => {
        disposeSubscriptions.delete(callback);
      };
    },
    typeKeys
  };
};

// ../../node_modules/gqty/Client/debugger.mjs
var createDebugger = () => {
  const subs = /* @__PURE__ */ new Set();
  return {
    dispatch: async (event) => {
      await Promise.all([...subs].map((sub) => sub(event)));
    },
    subscribe: (listener) => {
      subs.add(listener);
      return () => subs.delete(listener);
    }
  };
};

// ../../node_modules/debounce-microtasks/esm/src/DebounceMicrotask.js
var enqueue = typeof queueMicrotask === "function" ? queueMicrotask : (fn) => Promise.resolve().then(fn);
var debounceMicrotask = (fn, options) => {
  let queued = false;
  let { debounceLimit = 1e3 } = options ?? {};
  let currentArgs;
  return (...args) => {
    if (options?.updateArguments) {
      currentArgs = args;
    } else {
      currentArgs ??= args;
    }
    if (queued)
      return;
    if (debounceLimit-- <= 0) {
      switch (options?.limitAction) {
        case "ignore":
          return;
        case "invoke":
          return fn(...currentArgs);
        case "throw":
        default:
          throw new Error(`Maximum debounce limit reached.`);
      }
    }
    queued = true;
    enqueue(dequeue);
    function dequeue() {
      if (queued) {
        queued = false;
        enqueue(dequeue);
      } else {
        debounceLimit = options?.debounceLimit ?? 1e3;
        fn(...currentArgs);
      }
    }
  };
};

// ../../node_modules/debounce-microtasks/esm/src/DebounceMicrotaskPromise.js
var debounceMicrotask2 = (fn, options) => {
  let resolve3;
  let reject;
  let running = false;
  let settled = false;
  let promise = new Promise((res, rej) => {
    resolve3 = res;
    reject = rej;
  });
  const debounceFn = debounceMicrotask((...args) => {
    if (running)
      return;
    running = true;
    try {
      resolve3(fn(...args));
    } catch (e) {
      reject(e);
    } finally {
      running = false;
      settled = true;
    }
  }, options);
  return (...args) => {
    if (settled) {
      promise = new Promise((res, rej) => {
        resolve3 = res;
        reject = rej;
      });
      settled = false;
    } else {
      try {
        debounceFn(...args);
      } catch (e) {
        reject(e);
        settled = true;
      }
    }
    return promise;
  };
};

// ../../node_modules/gqty/Utils/pick.mjs
var pick = (schema2, selections) => {
  const result = {};
  for (const { ancestry } of selections) {
    let srcNode = schema2;
    for (const { key, input } of ancestry) {
      if (srcNode == null) break;
      if (typeof srcNode[key] === "function") {
        srcNode = srcNode[key](input == null ? void 0 : input.values);
      } else {
        srcNode = srcNode[key];
      }
    }
    if (srcNode !== void 0) {
      let dstNode = result;
      for (let i = 0; i < ancestry.length - 1; i++) {
        if (!dstNode) break;
        const { key } = ancestry[i];
        const { key: nextKey } = ancestry[i + 1];
        if (typeof nextKey === "number" && (!dstNode[key] || !Array.isArray(dstNode[key]))) {
          dstNode[key] = [];
        } else if (!dstNode[key]) {
          dstNode[key] = {};
        }
        dstNode = dstNode[key];
      }
      if (dstNode) {
        dstNode[ancestry[ancestry.length - 1].key] = srcNode;
      }
    }
  }
  return result;
};

// ../../node_modules/gqty/Client/batching.mjs
var pendingSelections = /* @__PURE__ */ new Map();
var addSelections = (cache2, key, selections) => {
  if (!pendingSelections.has(cache2)) {
    pendingSelections.set(cache2, /* @__PURE__ */ new Map());
  }
  const selectionsByKey = pendingSelections.get(cache2);
  if (!selectionsByKey.has(key)) {
    selectionsByKey.set(key, /* @__PURE__ */ new Set());
  }
  return selectionsByKey.get(key).add(selections);
};
var getSelectionsSet = (cache2, key) => {
  var _a;
  return (_a = pendingSelections.get(cache2)) == null ? void 0 : _a.get(key);
};
var delSelectionSet = (cache2, key) => {
  var _a, _b;
  return (_b = (_a = pendingSelections.get(cache2)) == null ? void 0 : _a.delete(key)) != null ? _b : false;
};

// ../../node_modules/gqty/Client/resolvers.mjs
var pendingQueries = /* @__PURE__ */ new WeakMap();
var getIntersection = (subject, object2) => {
  if (typeof subject.intersection === "function") {
    return subject.intersection(object2);
  }
  const intersection = /* @__PURE__ */ new Set();
  for (const item of object2) {
    if (subject.has(item)) {
      intersection.add(item);
    }
  }
  return intersection;
};
var createResolvers = ({
  aliasLength,
  batchWindow,
  cache: resolverCache,
  debugger: debug,
  depthLimit,
  fetchOptions,
  fetchOptions: {
    cachePolicy: defaultCachePolicy = "default",
    retryPolicy: defaultRetryPoliy
  },
  scalars,
  schema: schema2,
  parentContext
}) => {
  const correlatedCaches = new MultiDict();
  const subscriber = isWsClient(fetchOptions.subscriber) ? createSubscriber(fetchOptions.subscriber) : fetchOptions.subscriber;
  const createResolver = ({
    cachePolicy = defaultCachePolicy,
    extensions,
    onSelect,
    onSubscribe,
    operationName,
    retryPolicy = defaultRetryPoliy
  } = {}) => {
    const prevSelections = /* @__PURE__ */ new Set();
    const replaceSet = (target, source) => {
      target.clear();
      for (const value of source) {
        target.add(value);
      }
    };
    const selections = /* @__PURE__ */ new Set();
    const context = createContext({
      aliasLength,
      cache: resolverCache,
      cachePolicy,
      depthLimit,
      scalars,
      schema: schema2
    });
    context.subscribeSelect((selection, selectionCache) => {
      const targetSelections = selectionCache === void 0 ? (
        // For empty arrays and null objects, trigger sub-selections made
        // in previous selections.
        getIntersection(selection.getLeafNodes(), prevSelections)
      ) : [selection];
      for (const selection2 of targetSelections) {
        if (!selections.has(selection2)) {
          if (false === (onSelect == null ? void 0 : onSelect(selection2, selectionCache))) {
            continue;
          }
          selections.add(selection2);
          parentContext == null ? void 0 : parentContext.select(selection2, selectionCache);
        }
      }
    });
    const { accessor } = createSchemaAccessor(context);
    let activePromise;
    const resolve3 = async () => {
      if (selections.size === 0) {
        if (true) {
          console.warn(
            "[GQty] No selections found. If you are reading from the global accessors, try using the first argument instead."
          );
        }
        return;
      }
      if (!context.shouldFetch) return;
      if (cachePolicy === "only-if-cached") {
        throw new TypeError("Failed to fetch");
      }
      const selectionsCacheKey = `${operationName != null ? operationName : cachePolicy === "no-store" ? "no-store" : "default"}`;
      const pendingSelections2 = addSelections(
        resolverCache,
        selectionsCacheKey,
        selections
      );
      correlatedCaches.set(pendingSelections2, context.cache);
      if (!pendingQueries.has(pendingSelections2)) {
        pendingQueries.set(
          pendingSelections2,
          // Batching happens at the end of microtask queue
          debounceMicrotask2(
            async () => {
              var _a, _b;
              pendingQueries.delete(pendingSelections2);
              if (batchWindow) {
                await new Promise(
                  (resolve22) => setTimeout(resolve22, batchWindow)
                );
              }
              const uniqueSelections = /* @__PURE__ */ new Set();
              (_a = getSelectionsSet(resolverCache, selectionsCacheKey)) == null ? void 0 : _a.forEach(
                (selections2) => {
                  selections2.forEach((selection) => {
                    uniqueSelections.add(selection);
                  });
                }
              );
              delSelectionSet(resolverCache, selectionsCacheKey);
              const results = await fetchSelections(uniqueSelections, {
                cache: context.cache,
                debugger: debug,
                extensions,
                fetchOptions: { ...fetchOptions, cachePolicy, retryPolicy },
                operationName
              });
              const targetCaches = (_b = correlatedCaches.get(pendingSelections2)) != null ? _b : /* @__PURE__ */ new Set();
              if (cachePolicy !== "no-store") {
                targetCaches.add(resolverCache);
              }
              updateCaches(results, [...targetCaches], {
                skipNotify: promiseDropped() || !context.notifyCacheUpdate
              });
              correlatedCaches.delete(resolverCache);
              return results;
            },
            // When neughty users are adding selections every next microtask, we
            // forcibly start the fetch after a number of delays. This number is
            // picked arbitrarily, it should be a number that is large enough to
            // prevent excessive fetches but small enough to not block the
            // actual fetch indefinitely.
            {
              debounceLimit: 20,
              limitAction: "invoke"
            }
          )
        );
        const currentPromise = pendingQueries.get(pendingSelections2)();
        activePromise = currentPromise;
        const promiseDropped = () => activePromise !== void 0 && currentPromise !== activePromise;
        currentPromise.then(
          () => {
            if (promiseDropped()) return;
            if (selections.size === 0) return;
            replaceSet(prevSelections, selections);
            selections.clear();
          },
          () => {
          }
        ).finally(() => {
          if (promiseDropped()) return;
          context.reset();
          activePromise = void 0;
        });
      }
      return pendingQueries.get(pendingSelections2)();
    };
    const subscribe2 = ({
      onComplete,
      onError,
      onNext
    } = {}) => {
      if (selections.size === 0) {
        if (true) {
          console.warn(
            "[GQty] No selections found! If you are reading from the global accessors, try using the first argument instead."
          );
        }
        return () => {
        };
      }
      const unsubscibers = /* @__PURE__ */ new Set();
      const unsubscribe = () => {
        for (const unsubscribe2 of unsubscibers) {
          unsubscribe2();
        }
      };
      if (onNext) {
        const unsubscribe2 = context.cache.subscribe(
          [...selections].map((s) => s.cacheKeys.join(".")),
          (data) => onNext({ data })
        );
        unsubscibers.add(unsubscribe2);
      }
      const subscriptionSelections = /* @__PURE__ */ new Set();
      const promises = [];
      if (context.shouldFetch) {
        for (const selection of selections) {
          if (selection.root.key === "subscription") {
            selections.delete(selection);
            subscriptionSelections.add(selection);
          }
        }
        if (selections.size > 0) {
          promises.push(resolve3().catch(onError));
        }
      }
      for (const selection of subscriptionSelections) {
        selections.add(selection);
      }
      if (subscriptionSelections.size) {
        let lastSelectionsUpdated = false;
        const promise = new Promise((resolve22, reject) => {
          const unsubscribe2 = subscribeSelections(
            subscriptionSelections,
            ({ data, error, extensions: extensions2 }) => {
              if (error) {
                onError == null ? void 0 : onError(error);
                reject(error);
              } else if (data !== void 0) {
                updateCaches(
                  [{ data, error, extensions: extensions2 }],
                  cachePolicy !== "no-store" && context.cache !== resolverCache ? [context.cache, resolverCache] : [context.cache]
                );
                if (!lastSelectionsUpdated) {
                  lastSelectionsUpdated = true;
                  if (selections.size > 0) {
                    replaceSet(prevSelections, selections);
                  }
                }
              } else ;
            },
            {
              cache: context.cache,
              debugger: debug,
              extensions,
              fetchOptions: {
                ...fetchOptions,
                cachePolicy,
                retryPolicy,
                subscriber
              },
              operationName,
              onSubscribe: () => queueMicrotask(() => onSubscribe == null ? void 0 : onSubscribe(unsubscribe2)),
              onComplete: () => resolve22()
            }
          );
          unsubscibers.add(unsubscribe2);
        });
        promises.push(promise);
      }
      Promise.allSettled(promises).finally(onComplete);
      return unsubscribe;
    };
    return {
      accessor,
      context,
      resolve: resolve3,
      restorePreviousSelections: () => replaceSet(selections, prevSelections),
      selections,
      subscribe: subscribe2
    };
  };
  return {
    createResolver,
    resolve: async (fn, options) => {
      var _a, _b;
      const { accessor, resolve: resolve3, selections } = createResolver(options);
      const dataFn = () => fn(accessor);
      dataFn();
      const fetchPromise = resolve3().then(dataFn);
      if ((_a = options == null ? void 0 : options.awaitsFetch) != null ? _a : true) {
        await fetchPromise;
      }
      (_b = options == null ? void 0 : options.onFetch) == null ? void 0 : _b.call(options, fetchPromise);
      const result = dataFn();
      if (result === void 0) {
        return pick(accessor, selections);
      }
      return result;
    },
    subscribe: (fn, { onSubscribe, ...options } = {}) => {
      const { accessor, selections, subscribe: subscribe2 } = createResolver({
        ...options,
        onSubscribe: (unsubscribe2) => {
          onSubscribe == null ? void 0 : onSubscribe(() => {
            unsubscribe2();
            observable.complete();
          });
        }
      });
      fn(accessor);
      const unsubscribe = subscribe2({
        onError: (error) => {
          if (observable.throw === void 0) {
            throw error;
          }
          observable.throw(error);
        },
        onNext(value) {
          var _a;
          const message = (_a = fn(accessor)) != null ? _a : value;
          observable.send(message);
        }
      });
      const observable = createDeferredIterator();
      if (selections.size === 0) {
        observable.complete();
      }
      return { ...observable, unsubscribe };
    }
  };
};

// ../../node_modules/gqty/Helpers/getFields.mjs
function getFields(accessor, ...keys2) {
  if (!isObject(accessor)) return accessor;
  if (keys2.length) for (const key of keys2) Reflect.get(accessor, key);
  else for (const key in accessor) Reflect.get(accessor, key);
  return accessor;
}
function getArrayFields(accessorArray, ...keys2) {
  if (accessorArray == null) return accessorArray;
  if (Array.isArray(accessorArray)) {
    for (const value of accessorArray) {
      if (isPlainObject(value)) {
        getFields(value, ...keys2);
        break;
      }
    }
  }
  return accessorArray;
}

// ../../node_modules/gqty/Helpers/prepass.mjs
function getFirstNonNullValue(list) {
  for (const value of list) if (value != null) return value;
}
function prepass(v, ...keys2) {
  if (v == null) return v;
  keys2 = keys2[0] instanceof Set ? keys2 = [...keys2[0]].map((selection) => {
    return selection.ancestry.map(
      (s) => s.input ? {
        field: `${s.key}`,
        variables: s.input.values
      } : `${s.key}`
    );
  }) : keys2;
  for (const composedKeys of keys2) {
    const separatedKeys = typeof composedKeys === "string" ? composedKeys.split(".") : composedKeys;
    let obj = v;
    for (const key of separatedKeys) {
      if (obj && key) {
        const field = typeof key === "object" ? key.field : key;
        const variables = typeof key === "object" ? key.variables : void 0;
        if (Array.isArray(obj)) {
          const firstNonNull = getFirstNonNullValue(obj);
          if (firstNonNull) {
            obj = firstNonNull;
          } else break;
        }
        if (isObject(obj)) {
          if (field in obj) {
            const value = obj[field];
            if (typeof value === "function") {
              obj = value(variables);
            } else {
              obj = value;
            }
          } else break;
        } else break;
      } else break;
    }
  }
  return v;
}

// ../../node_modules/gqty/Helpers/selectFields.mjs
function selectFields(accessor, fields = "*", recursionDepth = 1) {
  if (accessor == null) return accessor;
  if (Array.isArray(accessor)) {
    return accessor.map(
      (value) => selectFields(value, fields, recursionDepth)
    );
  } else if (!isObject(accessor)) {
    return accessor;
  } else {
    Reflect.get(accessor, "__typename");
  }
  if (fields.length === 0) {
    return {};
  }
  if (typeof fields === "string") {
    if (recursionDepth > 0) {
      const allAccessorKeys = Object.keys(accessor);
      return allAccessorKeys.reduce((acum, fieldName) => {
        const fieldValue = objectSafeGet(accessor, fieldName);
        if (Array.isArray(fieldValue)) {
          objectSafeSet(
            acum,
            fieldName,
            fieldValue.map((value) => {
              return selectFields(value, "*", recursionDepth - 1);
            })
          );
        } else if (isObject(fieldValue)) {
          objectSafeSet(
            acum,
            fieldName,
            selectFields(fieldValue, "*", recursionDepth - 1)
          );
        } else {
          objectSafeSet(acum, fieldName, fieldValue);
        }
        return acum;
      }, {});
    } else {
      return null;
    }
  }
  return fields.reduce((acum, fieldName) => {
    if (typeof fieldName === "number") {
      fieldName = fieldName.toString();
    }
    const fieldValue = objectSafeGet(accessor, fieldName);
    if (fieldValue === void 0) return acum;
    if (Array.isArray(fieldValue)) {
      objectSafeSet(
        acum,
        fieldName,
        fieldValue.map((value) => {
          return selectFields(value, "*", recursionDepth);
        })
      );
    } else if (isObject(fieldValue)) {
      objectSafeSet(acum, fieldName, selectFields(fieldValue, "*", recursionDepth));
    } else {
      objectSafeSet(acum, fieldName, fieldValue);
    }
    return acum;
  }, {});
}

// ../../node_modules/gqty/Client/index.mjs
var createClient = ({
  aliasLength = 6,
  batchWindow,
  // This default cache on a required option is for legacy clients, which does
  // not provide a `cache` option.
  // [ ] compat: remove in v4
  cache: cache2 = new Cache(void 0, { normalization: true }),
  fetchOptions: {
    fetcher,
    cachePolicy: fetchPolicy = "default",
    retryPolicy: defaultRetryPolicy = {
      maxRetries: 3,
      retryDelay: 1e3
    },
    subscriber,
    ...fetchOptions
  } = {},
  scalars,
  schema: schema2,
  __depthLimit = 15,
  ...legacyOptions
}) => {
  var _a;
  {
    if (legacyOptions.queryFetcher) {
      fetcher != null ? fetcher : fetcher = createLegacyQueryFetcher(legacyOptions.queryFetcher);
    }
    if (legacyOptions.subscriptionsClient) {
      subscriber != null ? subscriber : subscriber = createLegacySubscriptionsClient(
        legacyOptions.subscriptionsClient
      );
    }
    if (legacyOptions.scalarsEnumsHash) {
      scalars != null ? scalars : scalars = legacyOptions.scalarsEnumsHash;
    }
  }
  const debug = createDebugger();
  const clientContext = createContext({
    aliasLength,
    cache: cache2,
    depthLimit: __depthLimit,
    cachePolicy: fetchPolicy,
    scalars,
    schema: schema2,
    typeKeys: (_a = cache2.normalizationOptions) == null ? void 0 : _a.schemaKeys
  });
  const resolvers = createResolvers({
    aliasLength,
    batchWindow,
    scalars,
    schema: schema2,
    cache: cache2,
    debugger: debug,
    fetchOptions: {
      fetcher,
      cachePolicy: fetchPolicy,
      retryPolicy: defaultRetryPolicy,
      subscriber,
      ...fetchOptions
    },
    depthLimit: __depthLimit,
    parentContext: clientContext
  });
  const { accessor } = createSchemaAccessor(clientContext);
  return {
    ...resolvers,
    schema: accessor,
    subscribeDebugEvents: debug.subscribe,
    ...createPersistors(cache2),
    get cache() {
      return cache2;
    },
    ...createLegacyClient({
      accessor,
      cache: cache2,
      context: clientContext,
      debugger: debug,
      fetchOptions: {
        fetcher,
        cachePolicy: fetchPolicy,
        retryPolicy: defaultRetryPolicy,
        subscriber,
        ...fetchOptions
      },
      scalars,
      schema: schema2,
      resolvers,
      __depthLimit
    })
  };
};

// ../../node_modules/gqty/Helpers/casters.mjs
var noop2 = (v) => v;
var castNotSkeletonDeep = noop2;
var castNotSkeleton = noop2;

// ../../node_modules/gqty/Helpers/fetcher.mjs
var defaultResponseHandler = async (response) => {
  const result = await parseResponse(response);
  assertExecutionResult(result);
  handleResponseErrors(result);
  return result;
};
var parseResponse = async (response) => {
  const text = await response.text().then((text2) => text2.trim() || null);
  if (response.status >= 400) {
    throw new GQtyError(
      `Received HTTP ${response.status} from GraphQL endpoint${text ? `, body: ${text.length > 50 ? text.slice(0, 50) + "..." : text}` : ""}.`
    );
  }
  if (!text) {
    throw new GQtyError("Received an empty response from GraphQL endpoint.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new GQtyError(
      `Received malformed JSON response from GraphQL endpoint: ${text.length > 50 ? text.slice(0, 50) + "..." : text}`
    );
  }
};
function assertExecutionResult(input) {
  if (!isExecutionResult(input)) {
    throw new GQtyError(
      `Expected response to be an ExecutionResult, received: ${JSON.stringify(
        input
      )}`
    );
  }
}
var isExecutionResult = (input) => {
  if (typeof input !== "object" || input === null) return false;
  const value = input;
  return "data" in value || Array.isArray(value.errors);
};
var handleResponseErrors = (result) => {
  var _a;
  if ((_a = result.errors) == null ? void 0 : _a.length) {
    throw GQtyError.fromGraphQLErrors(result.errors);
  }
};

// ../../node_modules/@react-hookz/web/esm/useUnmountEffect/index.js
var import_react2 = __toESM(require_react());

// ../../node_modules/@react-hookz/web/esm/useSyncedRef/index.js
var import_react = __toESM(require_react());
function useSyncedRef(value) {
  const ref = (0, import_react.useRef)(value);
  ref.current = value;
  return (0, import_react.useMemo)(() => Object.freeze({
    get current() {
      return ref.current;
    }
  }), []);
}

// ../../node_modules/@react-hookz/web/esm/useUnmountEffect/index.js
function useUnmountEffect(effect) {
  const effectRef = useSyncedRef(effect);
  (0, import_react2.useEffect)(() => () => {
    effectRef.current();
  }, []);
}

// ../../node_modules/@react-hookz/web/esm/util/const.js
var noop3 = () => {
};

// ../../node_modules/@react-hookz/web/esm/useThrottledCallback/index.js
var import_react3 = __toESM(require_react());
function useThrottledCallback(callback, deps, delay, noTrailing = false) {
  const timeout = (0, import_react3.useRef)();
  const lastCall = (0, import_react3.useRef)();
  useUnmountEffect(() => {
    if (timeout.current) {
      clearTimeout(timeout.current);
      timeout.current = void 0;
    }
  });
  return (0, import_react3.useMemo)(() => {
    const execute = (context, args) => {
      lastCall.current = void 0;
      callback.apply(context, args);
      timeout.current = setTimeout(() => {
        timeout.current = void 0;
        if (!noTrailing && lastCall.current) {
          execute(lastCall.current.this, lastCall.current.args);
          lastCall.current = void 0;
        }
      }, delay);
    };
    const wrapped = function(...args) {
      if (timeout.current) {
        lastCall.current = { args, this: this };
        return;
      }
      execute(this, args);
    };
    Object.defineProperties(wrapped, {
      length: { value: callback.length },
      name: { value: `${callback.name || "anonymous"}__throttled__${delay}` }
    });
    return wrapped;
  }, [delay, noTrailing, ...deps]);
}

// ../../node_modules/@react-hookz/web/esm/useFirstMountState/index.js
var import_react4 = __toESM(require_react());
function useFirstMountState() {
  const isFirstMount = (0, import_react4.useRef)(true);
  (0, import_react4.useEffect)(() => {
    isFirstMount.current = false;
  }, []);
  return isFirstMount.current;
}

// ../../node_modules/@react-hookz/web/esm/useRerender/index.js
var import_react5 = __toESM(require_react());
var stateChanger = (state) => (state + 1) % Number.MAX_SAFE_INTEGER;
function useRerender() {
  const [, setState] = (0, import_react5.useState)(0);
  return (0, import_react5.useCallback)(() => {
    setState(stateChanger);
  }, []);
}

// ../../node_modules/@react-hookz/web/esm/useUpdateEffect/index.js
var import_react6 = __toESM(require_react());
function useUpdateEffect(effect, deps) {
  const isFirstMount = useFirstMountState();
  (0, import_react6.useEffect)(isFirstMount ? noop3 : effect, deps);
}

// ../../node_modules/@react-hookz/web/esm/useIntervalEffect/index.js
var import_react7 = __toESM(require_react());
function useIntervalEffect(callback, ms) {
  const cbRef = useSyncedRef(callback);
  (0, import_react7.useEffect)(() => {
    if (!ms && ms !== 0) {
      return;
    }
    const id = setInterval(() => {
      cbRef.current();
    }, ms);
    return () => {
      clearInterval(id);
    };
  }, [ms]);
}

// ../../node_modules/@react-hookz/web/esm/usePrevious/index.js
var import_react8 = __toESM(require_react());
function usePrevious(value) {
  const prev = (0, import_react8.useRef)();
  (0, import_react8.useEffect)(() => {
    prev.current = value;
  });
  return prev.current;
}

// ../../node_modules/@gqty/react/meta/useMetaState.mjs
var React2 = __toESM(require_react(), 1);

// ../../node_modules/@gqty/react/common.mjs
var React = __toESM(require_react(), 1);
var legacyFetchPolicyMap = {
  "cache-first": "force-cache",
  "network-only": "no-cache",
  "cache-and-network": "default",
  "no-cache": "no-store"
};
var translateFetchPolicy = (fetchPolicy) => {
  var _a;
  return (_a = legacyFetchPolicyMap[fetchPolicy]) != null ? _a : "default";
};
var useExtractedSelections = (input) => {
  const [selections] = React.useState(() => /* @__PURE__ */ new Set());
  React.useEffect(() => {
    var _a, _b;
    selections.clear();
    if (input === void 0) return;
    for (const it of input) {
      (_b = it instanceof Selection ? it : (_a = $meta(it)) == null ? void 0 : _a.selection) == null ? void 0 : _b.getLeafNodes().forEach((selection) => selections.add(selection));
    }
  }, [input, input == null ? void 0 : input.length]);
  return selections;
};
var coreHelpers = {
  prepass,
  getFields,
  getArrayFields,
  selectFields,
  castNotSkeleton,
  castNotSkeletonDeep
};
function uniqBy(list, cb) {
  const uniqList = /* @__PURE__ */ new Map();
  for (const value of list) {
    const key = cb ? cb(value) : value;
    if (uniqList.has(key)) continue;
    uniqList.set(key, value);
  }
  return Array.from(uniqList.values());
}
var compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function sortBy(list, cb, order = "asc") {
  const orderedList = Array.from(list);
  orderedList.sort((a, b) => compare(cb(a), cb(b)));
  if (order === "desc") orderedList.reverse();
  return orderedList;
}

// ../../node_modules/@gqty/react/meta/useMetaState.mjs
function createUseMetaState() {
  const useMetaState2 = ({
    onStartFetching,
    onDoneFetching,
    onError,
    onRetry,
    filterSelections
  } = {}) => {
    const targetSelections = useExtractedSelections(filterSelections);
    const [promises] = React2.useState(() => /* @__PURE__ */ new Set());
    const [errors] = React2.useState(() => /* @__PURE__ */ new Set());
    const render = useRerender();
    React2.useEffect(() => {
      return useMetaStateHack_exports.subscribeFetch(({ promise, selections }) => {
        if (targetSelections.size > 0) {
          for (const selection of targetSelections) {
            if (selections.has(selection)) return;
          }
        }
        promises.add(promise);
        if (promises.size === 0) {
          errors.clear();
          onStartFetching == null ? void 0 : onStartFetching();
          render();
        }
        promise.catch((error) => {
          const newError = GQtyError.create(error);
          errors.add(newError);
          onError == null ? void 0 : onError({
            newError,
            selections: [...selections],
            isLastTry: true
          });
        }).finally(() => {
          promises.delete(promise);
          if (promises.size === 0) {
            onDoneFetching == null ? void 0 : onDoneFetching();
            render();
          }
        });
      });
    }, []);
    React2.useEffect(() => {
      return useMetaStateHack_exports.subscribeRetry(({ promise, selections }) => {
        if (targetSelections.size > 0) {
          for (const selection of targetSelections) {
            if (selections.has(selection)) return;
          }
        }
        onRetry == null ? void 0 : onRetry({
          retryPromise: promise,
          selections
        });
      });
    }, []);
    return Object.freeze({
      isFetching: promises.size > 0,
      errors: [...errors]
    });
  };
  return useMetaState2;
}

// ../../node_modules/@gqty/react/mutation/useMutation.mjs
var React3 = __toESM(require_react(), 1);
var createUseMutation = ({ resolve: resolve3, refetch: refetch2 }, {
  defaults: { mutationSuspense: defaultSuspense, retry: defaultRetry }
}) => {
  const useMutation2 = (mutationFn, {
    onCompleted,
    onComplete = onCompleted,
    onError,
    retry = defaultRetry,
    refetchQueries = [],
    awaitRefetchQueries,
    suspense = defaultSuspense,
    noCache = false,
    extensions
  } = {}) => {
    const [state, setState] = React3.useState({});
    if (suspense) {
      if (state.promise) throw state.promise;
      if (state.error) throw state.error;
    }
    const mutate2 = React3.useCallback(
      async ({
        fn = mutationFn,
        args
      } = {}) => {
        if (!fn) {
          throw new GQtyError(`Please specify a mutation function.`);
        }
        try {
          const promise = resolve3(
            ({ mutation: mutation2 }) => {
              if (mutation2 === void 0) {
                throw new GQtyError(`Mutation is not defined in the schema.`);
              }
              return fn(mutation2, args);
            },
            {
              cachePolicy: noCache ? "no-store" : "no-cache",
              retryPolicy: retry,
              extensions
            }
          ).then((data2) => {
            const refetches = refetchQueries.map((v) => refetch2(v));
            return awaitRefetchQueries ? Promise.all(refetches).then(() => data2) : data2;
          });
          setState({ promise });
          const data = await promise;
          await (onComplete == null ? void 0 : onComplete(data));
          setState({ data });
          return data;
        } catch (e) {
          const error = GQtyError.create(e);
          onError == null ? void 0 : onError(error);
          setState({ error });
          throw error;
        }
      },
      [mutationFn, noCache, retry, refetchQueries, awaitRefetchQueries]
    );
    return Object.freeze([
      mutate2,
      Object.freeze({
        data: state.data,
        error: state.error,
        isLoading: state.promise !== void 0
      })
    ]);
  };
  return useMutation2;
};

// ../../node_modules/@gqty/react/query/hoc.mjs
var React4 = __toESM(require_react(), 1);
function createGraphqlHOC({ createResolver, subscribeLegacySelections }, {
  defaults: { suspense: defaultSuspense, retry }
}) {
  const graphql2 = function graphql22(component, {
    onError,
    operationName,
    staleWhileRevalidate,
    suspense = defaultSuspense
  } = {}) {
    const withGraphQL = function WithGraphQL(props) {
      const {
        accessor: { query: query2, mutation: mutation2, subscription: subscription2 },
        context,
        resolve: resolve3
      } = createResolver({ operationName, retryPolicy: retry });
      const unsubscribe = subscribeLegacySelections((selection, cache2) => {
        context.select(selection, cache2);
      });
      const render = useRerender();
      React4.useEffect(render, [staleWhileRevalidate]);
      let elm = null;
      try {
        elm = component({ ...props, query: query2, mutation: mutation2, subscription: subscription2 });
      } finally {
        unsubscribe();
      }
      if (!context.shouldFetch) {
        return elm;
      }
      const promise = resolve3().finally(render);
      if (onError) {
        promise.catch(onError);
      }
      if (suspense === true) {
        throw promise;
      } else if (typeof suspense === "object") {
        const Suspender = () => {
          if (!promise) return null;
          throw promise;
        };
        return /* @__PURE__ */ React4.createElement(React4.Suspense, { fallback: suspense.fallback }, /* @__PURE__ */ React4.createElement(Suspender, null), elm);
      }
      return elm;
    };
    withGraphQL.displayName = `GraphQLComponent(${(component == null ? void 0 : component.displayName) || (component == null ? void 0 : component.name) || "Anonymous"})${Date.now()}`;
    return withGraphQL;
  };
  return graphql2;
}

// ../../node_modules/@gqty/react/query/preparedQuery.mjs
var import_shim = __toESM(require_shim(), 1);

// ../../node_modules/@gqty/react/memoryStore.mjs
var createMemoryStore = (initialValue) => {
  let state = Object.freeze({ ...initialValue });
  const listeners = /* @__PURE__ */ new Set();
  return {
    add: (value) => {
      state = Object.freeze({ ...state, ...value });
      listeners.forEach((listener) => listener());
    },
    get: () => state,
    set: (value) => {
      state = Object.freeze({ ...value });
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

// ../../node_modules/@gqty/react/query/preparedQuery.mjs
function createPrepareQuery({ prefetch, query: query2, refetch: clientRefetch }, {
  defaults: { preparedSuspense: defaultSuspense }
}) {
  const prepareQuery2 = (fn) => {
    const store = createMemoryStore({
      called: false,
      isLoading: false,
      isRefetching: false
    });
    const preload = async (args) => {
      store.set({
        data: void 0,
        error: void 0,
        promise: void 0,
        called: true,
        isLoading: true,
        isRefetching: false
      });
      const promise = prefetch((query22) => fn(query22, args));
      if (promise instanceof Promise) {
        store.add({ promise });
      }
      try {
        const data = await promise;
        store.add({
          data,
          promise: void 0,
          isLoading: false
        });
        return data;
      } catch (error) {
        store.add({
          error: GQtyError.create(error),
          promise: void 0,
          isLoading: false
        });
        throw error;
      }
    };
    const refetch2 = async (args) => {
      store.set({
        data: void 0,
        error: void 0,
        promise: void 0,
        called: true,
        isLoading: false,
        isRefetching: true
      });
      const promise = clientRefetch(() => fn(query2, args));
      store.add({ promise });
      try {
        const data = await promise;
        store.add({
          data,
          promise: void 0,
          isRefetching: false
        });
        return data;
      } catch (error) {
        store.add({
          error: GQtyError.create(error),
          promise: void 0,
          isRefetching: false
        });
        throw error;
      }
    };
    const usePrepared = ({
      suspense = defaultSuspense
    } = {}) => {
      const state = (0, import_shim.useSyncExternalStore)(store.subscribe, store.get);
      if (suspense) {
        if (state.promise) throw state.promise;
        if (state.error) throw state.error;
      }
      return state;
    };
    return {
      preload,
      refetch: refetch2,
      usePrepared,
      callback: fn
    };
  };
  return prepareQuery2;
}

// ../../node_modules/@gqty/react/query/useLazyQuery.mjs
var React5 = __toESM(require_react(), 1);
function UseLazyQueryReducer(state, action) {
  switch (action.type) {
    case "loading": {
      if (state.isLoading) return state;
      return {
        data: state.data,
        isLoading: true,
        isCalled: true,
        promise: action.promise
      };
    }
    case "success": {
      return {
        data: action.data,
        isLoading: false,
        isCalled: true
      };
    }
    case "failure": {
      return {
        data: state.data,
        isLoading: false,
        error: action.error,
        isCalled: true
      };
    }
    case "cache-found": {
      return {
        data: action.data,
        isLoading: state.isLoading,
        isCalled: true
      };
    }
  }
}
function InitUseLazyQueryReducer() {
  return {
    data: void 0,
    isLoading: false,
    isCalled: false
  };
}
function createUseLazyQuery({ resolve: resolve3 }, {
  defaults: {
    retry: defaultRetry,
    lazyQuerySuspense: defaultSuspense,
    lazyFetchPolicy: defaultFetchPolicy
  }
}) {
  const useLazyQuery2 = (fn, {
    onCompleted,
    onError,
    fetchPolicy: hookDefaultFetchPolicy = defaultFetchPolicy,
    retry = defaultRetry,
    suspense = defaultSuspense,
    operationName: defaultOperationName
  } = {}) => {
    const [state, dispatch] = React5.useReducer(
      UseLazyQueryReducer,
      void 0,
      InitUseLazyQueryReducer
    );
    if (suspense) {
      if (state.promise) throw state.promise;
      if (state.error) throw state.error;
    }
    return React5.useMemo(() => {
      const fetchQuery = async ({
        fn: resolveFn = fn,
        args,
        fetchPolicy = hookDefaultFetchPolicy,
        operationName = defaultOperationName
      } = {}) => {
        let innerFetchPromise;
        try {
          const fetchPromise = resolve3(
            ({ query: query2 }) => resolveFn(query2, args),
            {
              awaitsFetch: false,
              cachePolicy: translateFetchPolicy(fetchPolicy),
              onFetch(promise) {
                innerFetchPromise = promise;
              },
              retryPolicy: retry,
              operationName
            }
          ).then((data2) => {
            const typedData = data2;
            if (fetchPolicy === "cache-and-network") {
              dispatch({ type: "cache-found", data: typedData });
            }
            return innerFetchPromise != null ? innerFetchPromise : typedData;
          });
          dispatch({ type: "loading", promise: fetchPromise });
          const data = await fetchPromise;
          onCompleted == null ? void 0 : onCompleted(data);
          dispatch({ type: "success", data });
          return data;
        } catch (error) {
          const typedError = GQtyError.create(error);
          onError == null ? void 0 : onError(typedError);
          dispatch({ type: "failure", error: typedError });
          throw error;
        }
      };
      return Object.freeze([fetchQuery, state]);
    }, [fn, onCompleted, onError, retry]);
  };
  return useLazyQuery2;
}

// ../../node_modules/@gqty/react/query/usePaginatedQuery.mjs
var React6 = __toESM(require_react(), 1);
var createUsePaginatedQuery = ({ createResolver, resolve: resolve3 }, {
  defaults: {
    paginatedQueryFetchPolicy: defaultFetchPolicy,
    paginatedQuerySuspense: defaultSuspense
  }
}) => (fn, {
  initialArgs,
  fetchPolicy: hookFetchPolicy = defaultFetchPolicy,
  merge,
  retry,
  skip = false,
  suspense = defaultSuspense,
  operationName
}) => {
  const {
    accessor: { query: query2 },
    context,
    selections
  } = React6.useMemo(
    () => createResolver({
      cachePolicy: translateFetchPolicy(hookFetchPolicy),
      operationName,
      retryPolicy: retry
    }),
    [hookFetchPolicy, operationName, retry]
  );
  const [state, setState] = React6.useState({
    args: initialArgs
  });
  if (suspense) {
    if (state.promise) throw state.promise;
    if (state.error) throw state.error;
  }
  const mergeData = React6.useCallback(
    (incoming) => {
      var _a;
      return (_a = merge == null ? void 0 : merge({
        data: {
          existing: state.data,
          incoming
        },
        uniqBy,
        sortBy
      })) != null ? _a : incoming;
    },
    [merge]
  );
  const fetchData = React6.useCallback(
    async (args, fetchPolicy = hookFetchPolicy) => {
      const promise = resolve3(({ query: query22 }) => fn(query22, args, coreHelpers), {
        cachePolicy: translateFetchPolicy(fetchPolicy),
        operationName,
        retryPolicy: retry,
        onSelect(selection, cache2) {
          context.select(selection, cache2);
        }
      });
      if (!context.shouldFetch) {
        state.data = mergeData(fn(query2, args, coreHelpers));
        return state.data;
      }
      if (hookFetchPolicy === "cache-and-network" && context.hasCacheHit) {
        state.data = mergeData(fn(query2, args, coreHelpers));
      }
      state.promise = promise;
      promise.finally(() => {
        if (state.promise === promise) {
          state.promise = void 0;
        }
      });
      return promise;
    },
    [
      context,
      coreHelpers,
      fn,
      // fn almost guaranteed to change on every render
      hookFetchPolicy,
      mergeData,
      operationName,
      query2,
      retry
    ]
  );
  React6.useState(() => {
    if (skip) return setState(({ args }) => ({ args }));
    const promise = fetchData(initialArgs);
    promise.then(
      (data) => {
        setTimeout(() => {
          setState(({ args }) => ({ args, data }));
        }, 1e3);
      },
      (error) => {
        setState(({ args }) => ({
          args,
          error: GQtyError.create(error)
        }));
      }
    ).finally(() => context.reset());
    if (context.shouldFetch) {
      if (suspense) {
        throw promise;
      } else {
        setState(({ args }) => ({ args, promise }));
      }
    }
  });
  React6.useEffect(() => {
    if (skip || selections.size === 0) return;
    return context.cache.subscribe(
      [...selections].map((s) => s.cacheKeys.join(".")),
      () => setState((state2) => ({ ...state2 }))
    );
  }, [selections.size]);
  const fetchMore = React6.useCallback(
    async (newArgs, fetchPolicy) => {
      const currentArgs = typeof newArgs === "function" ? newArgs({ existingData: state.data, existingArgs: state.args }) : newArgs != null ? newArgs : state.args;
      try {
        const promise = fetchData(currentArgs, fetchPolicy);
        const data = await promise.then(mergeData);
        setState(({ args }) => ({ args, data }));
        return data;
      } catch (e) {
        const error = GQtyError.create(e);
        setState(({ args }) => ({ args, error }));
        throw error;
      }
    },
    [fetchData]
  );
  React6.useEffect(() => {
    return context.cache.subscribe(
      [...selections].map((s) => s.cacheKeys.join(".")),
      () => {
        setState((state2) => ({
          ...state2,
          data: fn(query2, state2.args, coreHelpers)
        }));
      }
    );
  }, [fn, state, selections.size]);
  return React6.useMemo(
    () => Object.freeze({
      args: state.args,
      data: state.data,
      fetchMore,
      isLoading: state.promise !== void 0
    }),
    [state.args, state.data, fetchMore, state.promise]
  );
};

// ../../node_modules/@gqty/react/query/useQuery.mjs
var import_react12 = __toESM(require_react(), 1);

// ../../node_modules/@gqty/react/ModifiedSet.mjs
var __typeError2 = (msg) => {
  throw TypeError(msg);
};
var __accessCheck2 = (obj, member, msg) => member.has(obj) || __typeError2("Cannot " + msg);
var __privateGet2 = (obj, member, getter) => (__accessCheck2(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateAdd2 = (obj, member, value) => member.has(obj) ? __typeError2("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
var __privateSet2 = (obj, member, value, setter) => (__accessCheck2(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var _lastAdded;
var ModifiedSet = class extends Set {
  constructor() {
    super(...arguments);
    __privateAdd2(this, _lastAdded);
  }
  add(value) {
    if (!super.has(value)) {
      __privateSet2(this, _lastAdded, value);
    }
    return super.add(value);
  }
  clear() {
    __privateSet2(this, _lastAdded, void 0);
    return super.clear();
  }
  /**
   * Only changes when the last call to `.add()` is a new value had not been
   * added yet.
   */
  get lastAdded() {
    return __privateGet2(this, _lastAdded);
  }
};
_lastAdded = /* @__PURE__ */ new WeakMap();

// ../../node_modules/@gqty/react/useOnlineEffect.mjs
var import_react9 = __toESM(require_react(), 1);
var useOnlineEffect = (fn, deps) => {
  (0, import_react9.useEffect)(() => {
    var _a;
    (_a = globalThis.addEventListener) == null ? void 0 : _a.call(globalThis, "online", fn);
    return () => {
      var _a2;
      (_a2 = globalThis.removeEventListener) == null ? void 0 : _a2.call(globalThis, "online", fn);
    };
  }, deps);
};

// ../../node_modules/@gqty/react/useRenderSession.mjs
var import_react10 = __toESM(require_react(), 1);
var useRenderSession = ({
  onClear = (map) => map.clear()
} = {}) => {
  const mapRef = (0, import_react10.useRef)(/* @__PURE__ */ new Map());
  (0, import_react10.useEffect)(() => onClear(mapRef.current));
  return mapRef.current;
};

// ../../node_modules/@gqty/react/useWindowFocusEffect.mjs
var import_react11 = __toESM(require_react(), 1);
var useWindowFocusEffect = (fn, deps = []) => {
  (0, import_react11.useEffect)(() => {
    var _a, _b;
    const visibilityChangeFn = () => {
      var _a2;
      if (((_a2 = globalThis.document) == null ? void 0 : _a2.visibilityState) === "visible") {
        fn();
      }
    };
    (_a = globalThis.addEventListener) == null ? void 0 : _a.call(globalThis, "visibilitychange", visibilityChangeFn);
    (_b = globalThis.addEventListener) == null ? void 0 : _b.call(globalThis, "focus", visibilityChangeFn);
    return () => {
      var _a2, _b2;
      (_a2 = globalThis.removeEventListener) == null ? void 0 : _a2.call(globalThis, "visibilitychange", visibilityChangeFn);
      (_b2 = globalThis.removeEventListener) == null ? void 0 : _b2.call(globalThis, "focus", visibilityChangeFn);
    };
  }, deps.concat(fn));
};

// ../../node_modules/@gqty/react/query/useQuery.mjs
var createUseQuery = (client2, {
  defaults: {
    initialLoadingState: defaultInitialLoadingState,
    suspense: defaultSuspense,
    staleWhileRevalidate: defaultStaleWhileRevalidate,
    retry: defaultRetry
  }
}) => {
  const cofetchingResolvers = new MultiDict();
  const resolverStack = new ModifiedSet();
  return ({
    extensions,
    fetchInBackground = false,
    fetchPolicy,
    cachePolicy = translateFetchPolicy(fetchPolicy != null ? fetchPolicy : "cache-first"),
    initialLoadingState = defaultInitialLoadingState,
    suspense = defaultSuspense,
    notifyOnNetworkStatusChange = !suspense,
    onError,
    operationName,
    prepare,
    refetchInterval,
    refetchOnReconnect = true,
    refetchOnRender = true,
    refetchOnWindowVisible = true,
    retry = defaultRetry,
    retryPolicy = retry,
    staleWhileRevalidate = defaultStaleWhileRevalidate
  } = {}) => {
    const initialStateRef = (0, import_react12.useRef)(initialLoadingState);
    const render = useRerender();
    const renderSession = useRenderSession();
    renderSession.set("isRendering", true);
    const resolver = (0, import_react12.useMemo)(() => {
      const resolver2 = client2.createResolver({
        cachePolicy,
        extensions,
        operationName,
        retryPolicy,
        onSelect() {
          const currentResolver = resolverStack.lastAdded;
          if (currentResolver && currentResolver !== resolver2) {
            cofetchingResolvers.set(currentResolver, resolver2);
          }
          resolverStack.add(resolver2);
          if (!renderSession.get("isRendering")) {
            Promise.resolve().then(
              () => refetch2({ skipPrepass: true, skipOnError: true })
            );
          } else if (!renderSession.get("postFetch")) {
            if (cachePolicy === "reload" || cachePolicy === "no-cache" || cachePolicy === "no-store") {
              resolver2.context.shouldFetch = true;
            }
            if (!renderSession.get("postFetchSelectionCleared")) {
              renderSession.set("postFetchSelectionCleared", true);
              selections.clear();
            }
          }
        }
      });
      return resolver2;
    }, [cachePolicy, operationName, retryPolicy]);
    const {
      accessor: { query: query2 },
      accessor,
      context,
      resolve: resolve3,
      selections
    } = resolver;
    const [state, setState] = (0, import_react12.useState)({});
    if (prepare) {
      context.shouldFetch = false;
      prepare({ prepass, query: query2 });
      if (context.shouldFetch && suspense) {
        throw client2.resolve(({ query: query22 }) => prepare({ prepass, query: query22 }), {
          cachePolicy,
          operationName,
          retryPolicy
        });
      }
    }
    if (suspense) {
      if (state.error) {
        throw state.error;
      }
      if (state.promise && (!context.hasCacheHit || notifyOnNetworkStatusChange)) {
        throw state.promise;
      }
    }
    (0, import_react12.useEffect)(
      () => context.cache.subscribe(
        [...selections].map((s) => s.cacheKeys.join(".")),
        render
      ),
      [render, selections.size]
    );
    const refetch2 = (0, import_react12.useCallback)(
      async (options) => {
        var _a, _b, _c;
        if (state.promise !== void 0) {
          return;
        }
        if (state.error && ((_a = options == null ? void 0 : options.skipOnError) != null ? _a : !suspense)) {
          return;
        }
        if (!fetchInBackground && ((_b = globalThis.document) == null ? void 0 : _b.visibilityState) === "hidden") {
          return;
        }
        if ((options == null ? void 0 : options.ignoreCache) === true) {
          context.shouldFetch = true;
        } else if (!(options == null ? void 0 : options.skipPrepass) && isFinite(client2.cache.maxAge)) {
          prepass(accessor, selections);
        }
        if (!context.shouldFetch) {
          return;
        }
        initialStateRef.current = false;
        try {
          if (!client2.cache.normalizationOptions) {
            const seen = /* @__PURE__ */ new Set();
            for (const { cacheKeys: [type, field] = [] } of selections) {
              if (type !== "query") {
                continue;
              }
              if (seen.has(field)) {
                continue;
              } else {
                seen.add(field);
              }
              resolversLoop: for (const stackResolver of resolverStack) {
                if (stackResolver === resolver) {
                  continue;
                }
                for (const {
                  cacheKeys: [objType, objField]
                } of stackResolver.selections) {
                  if (type === objType && field === objField) {
                    cofetchingResolvers.set(resolver, stackResolver);
                    continue resolversLoop;
                  }
                }
              }
            }
          }
          const pendingPromises = [...(_c = cofetchingResolvers.get(resolver)) != null ? _c : []].map(({ context: context2, resolve: resolve22 }) => {
            context2.shouldFetch = true;
            const ret = resolve22();
            context2.shouldFetch = false;
            return ret;
          }).concat(resolve3());
          context.shouldFetch = false;
          const promise = Promise.all(pendingPromises);
          state.promise = promise;
          if (!context.hasCacheHit || notifyOnNetworkStatusChange) {
            setState({ promise });
          }
          await promise;
        } catch (e) {
          const error = GQtyError.create(e);
          onError == null ? void 0 : onError(error);
          setState({ error });
        } finally {
          context.reset();
          state.promise = void 0;
          resolverStack.clear();
          cofetchingResolvers.delete(resolver);
          renderSession.set("postFetch", true);
          setState(({ error }) => ({
            error,
            promise: void 0
          }));
        }
      },
      [
        cachePolicy,
        context.shouldFetch,
        fetchInBackground,
        operationName,
        selections
      ]
    );
    (0, import_react12.useEffect)(() => {
      if (!refetchOnRender) {
        return;
      }
      refetch2({ skipPrepass: true });
    });
    useIntervalEffect(() => {
      refetch2();
    }, refetchInterval);
    useOnlineEffect(() => {
      if (!refetchOnReconnect) {
        return;
      }
      refetch2();
    }, [refetchOnReconnect]);
    useWindowFocusEffect(() => {
      if (!refetchOnWindowVisible) {
        return;
      }
      refetch2();
    });
    const swrDiff = usePrevious(staleWhileRevalidate);
    useUpdateEffect(() => {
      if (!staleWhileRevalidate || Object.is(staleWhileRevalidate, swrDiff)) {
        return;
      }
      refetch2({ ignoreCache: true });
    }, [refetch2, swrDiff]);
    return (0, import_react12.useMemo)(() => {
      return new Proxy(
        Object.freeze({
          $refetch: (ignoreCache = true) => refetch2({ ignoreCache, skipOnError: false }),
          $state: Object.freeze({
            isLoading: state.promise !== void 0 || initialStateRef.current,
            error: state.error
          })
        }),
        {
          get: (target, key, proxy) => {
            var _a;
            return (_a = Reflect.get(target, key, proxy)) != null ? _a : Reflect.get(
              prepare && cachePolicy !== "no-store" ? (
                // Using global schema accessor prevents the second pass fetch
                // essentially let `prepare` decides what data to fetch, data
                // placeholder will always render in case of a cache miss.
                client2.schema.query
              ) : query2,
              key
            );
          }
        }
      );
    }, [query2, refetch2, state.error, state.promise]);
  };
};

// ../../node_modules/@gqty/react/query/useRefetch.mjs
var React7 = __toESM(require_react(), 1);
var createUseRefetch = (client2, { defaults: { retry: defaultRetry } }) => {
  const useRefetch2 = ({
    notifyOnNetworkStatusChange = true,
    operationName,
    startWatching = true,
    retry = defaultRetry,
    suspense = false
  } = {}) => {
    const [state, setState] = React7.useState();
    const watchingRef = React7.useRef(startWatching);
    const [selections] = React7.useState(() => /* @__PURE__ */ new Set());
    const [unsubscribeSelections] = React7.useState(
      () => client2.subscribeLegacySelections((selection) => {
        if (watchingRef.current && selection.root.key === "query") {
          selections.add(selection);
        }
      })
    );
    React7.useEffect(() => unsubscribeSelections, [unsubscribeSelections]);
    if (suspense) {
      if (state == null ? void 0 : state.promise) throw state == null ? void 0 : state.promise;
      if (state == null ? void 0 : state.error) throw state == null ? void 0 : state.error;
    }
    const refetch2 = React7.useCallback(
      async (fnArg) => {
        const promise = (() => {
          if (fnArg) return client2.refetch(fnArg);
          const { context, resolve: resolve3 } = client2.createResolver({
            retryPolicy: retry,
            operationName
          });
          selections.forEach((selection) => {
            context.select(selection);
          });
          return resolve3();
        })();
        setState({ promise });
        try {
          return await promise;
        } catch (error) {
          const theError = GQtyError.create(error);
          setState({ error: theError });
          throw theError;
        }
      },
      [notifyOnNetworkStatusChange, operationName, retry]
    );
    return React7.useMemo(
      () => Object.assign(refetch2, {
        isLoading: (state == null ? void 0 : state.promise) !== void 0,
        error: state == null ? void 0 : state.error,
        startWatching: () => {
          watchingRef.current = true;
        },
        stopWatching: () => {
          watchingRef.current = false;
        }
      }),
      []
    );
  };
  return useRefetch2;
};

// ../../node_modules/@gqty/react/query/useTransactionQuery.mjs
function createUseTransactionQuery(useQuery2, {
  defaults: {
    transactionFetchPolicy: defaultFetchPolicy,
    retry: defaultRetry,
    transactionQuerySuspense: defaultSuspense
  }
}) {
  const useTransactionQuery2 = (fn, {
    fetchPolicy = defaultFetchPolicy,
    cachePolicy = translateFetchPolicy(fetchPolicy),
    notifyOnNetworkStatusChange = true,
    onCompleted,
    onError,
    operationName,
    pollInBackground = false,
    pollInterval,
    retry = defaultRetry,
    skip = false,
    suspense = defaultSuspense,
    variables
  } = {}) => {
    const query2 = useQuery2({
      cachePolicy,
      fetchInBackground: pollInBackground,
      notifyOnNetworkStatusChange,
      operationName,
      prepare: ({ query: query22 }) => skip ? void 0 : fn(query22, variables),
      refetchInterval: pollInterval,
      refetchOnReconnect: false,
      refetchOnRender: false,
      refetchOnWindowVisible: false,
      retry,
      suspense
    });
    useUpdateEffect(() => {
      const {
        $state: { isLoading, error }
      } = query2;
      if (!isLoading && !error) {
        onCompleted == null ? void 0 : onCompleted(fn(query2, variables));
      }
    }, [query2.$state.isLoading]);
    useUpdateEffect(() => {
      if (query2.$state.error) {
        onError == null ? void 0 : onError(query2.$state.error);
      }
    }, [query2.$state.error]);
    return skip ? {
      isCalled: false,
      isLoading: false
    } : {
      data: fn(query2, variables),
      isCalled: true,
      isLoading: query2.$state.isLoading,
      error: query2.$state.error
    };
  };
  return useTransactionQuery2;
}

// ../../node_modules/@gqty/react/ssr/ssr.mjs
var import_react13 = __toESM(require_react(), 1);
var import_server = __toESM(require_server_browser(), 1);

// ../../node_modules/@gqty/react/utils.mjs
function getDefault(v) {
  return ("default" in v ? v.default : v) || v;
}

// ../../node_modules/@gqty/react/ssr/ssr.mjs
var IS_SERVER = typeof window === "undefined";
function createSSRHelpers({ hydrateCache, prepareRender, query: query2, refetch: refetch2 }, { defaults: { refetchAfterHydrate } }) {
  const prepareReactRender2 = async function prepareReactRender22(element) {
    const majorVersion = +import_server.version.split(".")[0];
    if (majorVersion >= 18) {
      const { renderToPipeableStream, renderToReadableStream } = await import("./server.browser-BXI3O2NF.js");
      if (renderToReadableStream !== void 0) {
        return prepareRender(async () => {
          const stream = await renderToReadableStream(element);
          await stream.allReady;
        });
      } else {
        return prepareRender(
          () => new Promise((resolve3, reject) => {
            renderToPipeableStream(element, {
              onAllReady: resolve3,
              onError: reject
            });
          })
        );
      }
    } else {
      const ssrPrepass = getDefault(await import("./react-ssr-prepass.es-SGNTLSJH.js"));
      return prepareRender(() => ssrPrepass(element));
    }
  };
  const useHydrateCache2 = function useHydrateCache22({
    cacheSnapshot,
    shouldRefetch = refetchAfterHydrate
  }) {
    (0, import_react13.useMemo)(() => {
      if (!IS_SERVER && cacheSnapshot) {
        hydrateCache({ cacheSnapshot, shouldRefetch: false });
      }
    }, [cacheSnapshot]);
    (0, import_react13.useEffect)(() => {
      if (!IS_SERVER && shouldRefetch) {
        refetch2(query2).catch(console.error);
      }
    }, [shouldRefetch]);
  };
  return {
    useHydrateCache: useHydrateCache2,
    prepareReactRender: prepareReactRender2
  };
}

// ../../node_modules/@gqty/react/subscription/useSubscription.mjs
var import_react14 = __toESM(require_react(), 1);
function createUseSubscription({
  createResolver
}) {
  const useSubscription = ({
    onError,
    operationName,
    renderThrottleDelay = 100
  } = {}) => {
    const {
      accessor: { subscription: subscription2 },
      subscribe: subscribe2,
      selections
    } = (0, import_react14.useMemo)(() => createResolver({ operationName }), [operationName]);
    const render = useRerender();
    const throttledRender = useThrottledCallback(
      render,
      [render],
      renderThrottleDelay
    );
    const [error, setError] = (0, import_react14.useState)();
    if (error) throw error;
    (0, import_react14.useEffect)(() => {
      return subscribe2({
        onNext: () => throttledRender(),
        onError(error2) {
          const theError = GQtyError.create(error2);
          if (onError) {
            onError(theError);
          } else {
            setError(theError);
          }
        }
      });
    }, [onError, selections, selections.size]);
    if (!subscription2) {
      throw new GQtyError(`Subscription is not defined in the schema.`);
    }
    return subscription2;
  };
  return useSubscription;
}

// ../../node_modules/@gqty/react/client.mjs
function createReactClient(client2, {
  defaults: { suspense = false } = {},
  defaults: {
    initialLoadingState = false,
    transactionFetchPolicy = "cache-first",
    lazyFetchPolicy = "network-only",
    staleWhileRevalidate = false,
    retry = true,
    lazyQuerySuspense = false,
    transactionQuerySuspense = suspense,
    mutationSuspense = false,
    preparedSuspense = suspense,
    refetchAfterHydrate = false,
    paginatedQueryFetchPolicy = "cache-first",
    paginatedQuerySuspense = suspense
  } = {},
  ...options
} = {}) {
  const opts = {
    ...options,
    defaults: {
      initialLoadingState,
      lazyFetchPolicy,
      lazyQuerySuspense,
      mutationSuspense,
      paginatedQueryFetchPolicy,
      paginatedQuerySuspense,
      preparedSuspense,
      refetchAfterHydrate,
      retry,
      staleWhileRevalidate,
      suspense,
      transactionFetchPolicy,
      transactionQuerySuspense
    }
  };
  const { prepareReactRender: prepareReactRender2, useHydrateCache: useHydrateCache2 } = createSSRHelpers(
    client2,
    opts
  );
  const useQuery2 = createUseQuery(client2, opts);
  return {
    useQuery: useQuery2,
    useRefetch: createUseRefetch(client2, opts),
    useLazyQuery: createUseLazyQuery(client2, opts),
    useTransactionQuery: createUseTransactionQuery(useQuery2, opts),
    usePaginatedQuery: createUsePaginatedQuery(client2, opts),
    useMutation: createUseMutation(client2, opts),
    graphql: createGraphqlHOC(client2, opts),
    state: {
      get isLoading() {
        var _a;
        const cache2 = (_a = $meta(client2.schema.query)) == null ? void 0 : _a.context.cache;
        const promises = cache2 && getActivePromises(cache2);
        return !!(promises == null ? void 0 : promises.length);
      }
    },
    prepareReactRender: prepareReactRender2,
    useHydrateCache: useHydrateCache2,
    useMetaState: createUseMetaState(),
    useSubscription: createUseSubscription(client2),
    prepareQuery: createPrepareQuery(client2, opts)
  };
}

// .pylon/client/schema.generated.ts
var scalarsEnumsHash = {
  Any: true,
  Boolean: true,
  Date: true,
  File: true,
  Float: true,
  ID: true,
  Int: true,
  JSON: true,
  Number: true,
  Object: true,
  String: true,
  Void: true
};
var generatedSchema = {
  Author: {
    __typename: { __type: "String!" },
    email: { __type: "String!" },
    id: { __type: "Number!" },
    name: { __type: "String!" }
  },
  Post: {
    __typename: { __type: "String!" },
    author: { __type: "Author!" },
    content: { __type: "String!" },
    id: { __type: "Number!" },
    tags: { __type: "[String!]!" },
    title: { __type: "String!" }
  },
  User: {
    __typename: { __type: "String!" },
    email: { __type: "String!" },
    id: { __type: "Number!" },
    name: { __type: "String!" },
    posts: { __type: "[Post!]!" }
  },
  mutation: {},
  query: {
    __typename: { __type: "String!" },
    posts: { __type: "[Post!]!" },
    users: { __type: "[User!]!" }
  },
  subscription: {}
};

// .pylon/client/index.ts
var queryFetcher = async function({ query: query2, variables, operationName }, fetchOptions) {
  const response = await fetch("http://localhost:3000/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: query2,
      variables,
      operationName
    }),
    mode: "cors",
    ...fetchOptions
  });
  return await defaultResponseHandler(response);
};
var cache = new Cache(
  void 0,
  /**
   * Default option is immediate cache expiry but keep it for 5 minutes,
   * allowing soft refetches in background.
   */
  {
    maxAge: 0,
    staleWhileRevalidate: 5 * 60 * 1e3,
    normalization: true
  }
);
var client = createClient({
  schema: generatedSchema,
  scalars: scalarsEnumsHash,
  cache,
  fetchOptions: {
    fetcher: queryFetcher
  }
});
var { resolve: resolve2, subscribe, schema } = client;
var { query, mutation, mutate, subscription, resolved, refetch, track } = client;
var {
  graphql,
  useQuery,
  usePaginatedQuery,
  useTransactionQuery,
  useLazyQuery,
  useRefetch,
  useMutation,
  useMetaState,
  prepareReactRender,
  useHydrateCache,
  prepareQuery
} = createReactClient(client, {
  defaults: {
    // Enable Suspense, you can override this option for each hook.
    suspense: true
  }
});
export {
  client,
  generatedSchema,
  graphql,
  mutate,
  mutation,
  prepareQuery,
  prepareReactRender,
  query,
  refetch,
  resolve2 as resolve,
  resolved,
  scalarsEnumsHash,
  schema,
  subscribe,
  subscription,
  track,
  useHydrateCache,
  useLazyQuery,
  useMetaState,
  useMutation,
  usePaginatedQuery,
  useQuery,
  useRefetch,
  useTransactionQuery
};
/*! Bundled license information:

use-sync-external-store/cjs/use-sync-external-store-shim.development.js:
  (**
   * @license React
   * use-sync-external-store-shim.development.js
   *
   * Copyright (c) Meta Platforms, Inc. and affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
