import type { CamsCasInjectInput } from "./cams-cas-types";

const CAS_PAGE_PATH = "/Investors/Statements/Consolidated-Account-Statement";

/**
 * Injected on https://www.camsonline.com — uses same-origin fetch + Web Crypto + site reCAPTCHA.
 * Mirrors the flow documented for CAMS CAS (CAMS + KFintech).
 */
export function buildCamsCasInjectScript(input: CamsCasInjectInput): string {
  const embedded = JSON.stringify(input);
  return `(function(){
  function run() {
    var FALLBACK_SITE_KEY = "6LeFNqcpAAAAAClHOnC8qbwSUtY9NFFDxYrMraWF";
    var SEED_ENC = "TkVJTEhobWFj";
    var SEED_DEC = "UkRYTElobWFj";
    var IV_STR = "globalaesvectors";
    var INPUT = ${embedded};
    var enc;
    var dec;
    var debugState = {
      lastFlag: "",
      sentSummary: "",
      responseContentType: "",
      responseLength: 0,
      responseFull: "",
      responseStart: "",
      responseEnd: "",
      parsedShape: "",
      cipherLength: 0,
      decodedByteLength: 0,
      decodedByteLengthMod16: -1,
      sanitizedCharsDropped: 0,
      expectedDecodedLength: 0,
      atobDecodedLength: -1,
      manualDecodedLength: -1,
      eqCount: 0,
      b64NormalizedLength: 0,
      cipherNormalizedEnd: "",
    };
    try {
      enc = new TextEncoder();
      dec = new TextDecoder();
      function emitProgress(step) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ progress: step }));
      }
      emitProgress("Injected script started");

      function toUrlB64(buf) {
        var bytes = new Uint8Array(buf);
        var s = "";
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        var b = btoa(s);
        return b.split("+").join("-").split("/").join("_");
      }
      function fromUrlB64(s) {
        var raw = String(s || "");
        debugState.sanitizedCharsDropped = 0;
        // Strict validation, no mutation.
        var badAt = -1;
        for (var bi = 0; bi < raw.length; bi++) {
          var ch = raw.charAt(bi);
          var ok =
            (ch >= "A" && ch <= "Z") ||
            (ch >= "a" && ch <= "z") ||
            (ch >= "0" && ch <= "9") ||
            ch === "+" ||
            ch === "/" ||
            ch === "_" ||
            ch === "-" ||
            ch === "=";
          if (!ok) {
            badAt = bi;
            break;
          }
        }
        if (badAt >= 0) {
          throw new Error(
            "invalid base64 character at index " + badAt + " (code " + raw.charCodeAt(badAt) + ")"
          );
        }
        var b = raw
          .replace(/-/g, "+")
          .replace(/_/g, "/");
        debugState.b64NormalizedLength = b.length;
        while (b.length % 4) b += "=";
        var eq = 0;
        if (b.length >= 1 && b.charAt(b.length - 1) === "=") eq++;
        if (b.length >= 2 && b.charAt(b.length - 2) === "=") eq++;
        debugState.eqCount = eq;
        debugState.expectedDecodedLength = Math.floor((b.length / 4) * 3) - eq;

        // Manual base64 decode for WebView consistency (some Android builds can be flaky).
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var table = {};
        for (var i = 0; i < chars.length; i++) table[chars.charAt(i)] = i;
        var outManual = [];
        for (var j = 0; j < b.length; j += 4) {
          var c1 = b.charAt(j);
          var c2 = b.charAt(j + 1);
          var c3 = b.charAt(j + 2);
          var c4 = b.charAt(j + 3);
          if (!(c1 in table) || !(c2 in table)) {
            throw new Error("invalid base64 quartet at index " + j);
          }
          var n1 = table[c1];
          var n2 = table[c2];
          var n3 = c3 === "=" ? 0 : table[c3];
          var n4 = c4 === "=" ? 0 : table[c4];
          var triplet = (n1 << 18) | (n2 << 12) | (n3 << 6) | n4;
          outManual.push((triplet >> 16) & 255);
          if (c3 !== "=") outManual.push((triplet >> 8) & 255);
          if (c4 !== "=") outManual.push(triplet & 255);
        }
        debugState.manualDecodedLength = outManual.length;

        var outAtob = null;
        try {
          var bin = atob(b);
          var arr = new Uint8Array(bin.length);
          for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
          outAtob = arr;
          debugState.atobDecodedLength = arr.length;
        } catch (e2) {
          debugState.atobDecodedLength = -1;
        }

        if (outAtob && outAtob.length === debugState.expectedDecodedLength) {
          return outAtob.buffer;
        }
        if (outManual.length === debugState.expectedDecodedLength) {
          return new Uint8Array(outManual).buffer;
        }
        // Fall back to manual bytes so caller can still attempt decrypt/log.
        return new Uint8Array(outManual).buffer;
      }

      function decodeSeedMaybeBase64(seed) {
        try {
          var b = String(seed || "").replace(/-/g, "+").replace(/_/g, "/");
          while (b.length % 4) b += "=";
          return atob(b);
        } catch (e) {
          return String(seed || "");
        }
      }

      function delay(ms) {
        return new Promise(function (resolve) {
          setTimeout(resolve, ms);
        });
      }

      function withTimeout(promise, ms, label) {
        var t;
        return Promise.race([
          promise,
          new Promise(function (_, reject) {
            t = setTimeout(function () {
              reject(new Error(label + " timed out"));
            }, ms);
          }),
        ]).then(
          function (v) {
            if (t) clearTimeout(t);
            return v;
          },
          function (e) {
            if (t) clearTimeout(t);
            throw e;
          }
        );
      }

      function aesKey(seed) {
        return crypto.subtle.digest("SHA-256", enc.encode(seed)).then(function (hash) {
          var hex = Array.from(new Uint8Array(hash))
            .map(function (x) { return x.toString(16).padStart(2, "0"); })
            .join("");
          return crypto.subtle.importKey(
            "raw",
            enc.encode(hex.substring(0, 32)),
            { name: "AES-CBC" },
            false,
            ["encrypt", "decrypt"]
          );
        });
      }

      function uniqueStrings(arr) {
        var out = [];
        var seen = {};
        for (var i = 0; i < arr.length; i++) {
          var v = String(arr[i] || "");
          if (!seen[v]) {
            seen[v] = true;
            out.push(v);
          }
        }
        return out;
      }

      function decryptWithAnySeed(buf, seeds) {
        var list = uniqueStrings(seeds);
        function one(i) {
          if (i >= list.length) {
            return Promise.reject(new Error("Could not decrypt CAMS payload with known keys"));
          }
          var seed = list[i];
          return aesKey(seed)
            .then(function (k) {
              return crypto.subtle.decrypt(
                { name: "AES-CBC", iv: enc.encode(IV_STR) },
                k,
                buf
              );
            })
            .then(function (pt) {
              var txt = dec.decode(pt);
              try {
                return JSON.parse(txt);
              } catch (e) {
                return one(i + 1);
              }
            })
            .catch(function () {
              return one(i + 1);
            });
        }
        return one(0);
      }

      function encryptPayload(obj) {
        var encSeeds = uniqueStrings([SEED_ENC, decodeSeedMaybeBase64(SEED_ENC)]);
        return aesKey(encSeeds[0])
          .then(function (k) {
            return crypto.subtle.encrypt(
              { name: "AES-CBC", iv: enc.encode(IV_STR) },
              k,
              enc.encode(JSON.stringify(obj))
            );
          })
          .then(function (ct) {
            return toUrlB64(ct);
          });
      }

      function decryptResponsePayload(cipherRaw) {
        var cipher = String(cipherRaw || "").trim();
        if (!cipher) return Promise.reject(new Error("Empty CAMS response"));
        var first = cipher.charAt(0);
        if (first === "{" || first === "[") {
          try {
            return Promise.resolve(JSON.parse(cipher));
          } catch (e0) {}
        }
        var buf;
        try {
          buf = fromUrlB64(cipher);
        } catch (e1) {
          return Promise.reject(new Error(
            "CAMS payload is not valid base64 (HTML or error page?). Start: " + cipher.slice(0, 120)
          ));
        }
        var seeds = uniqueStrings([
          SEED_DEC,
          decodeSeedMaybeBase64(SEED_DEC),
          SEED_ENC,
          decodeSeedMaybeBase64(SEED_ENC),
        ]);
        return decryptWithAnySeed(buf, seeds);
      }

      function fmtDate(iso) {
        var d = new Date(iso);
        var parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).formatToParts(d);
        var dayPart = parts.find(function (p) { return p.type === "day"; });
        var monPart = parts.find(function (p) { return p.type === "month"; });
        var yrPart = parts.find(function (p) { return p.type === "year"; });
        var dd = String(dayPart ? dayPart.value : "").padStart(2, "0");
        var mon = monPart ? monPart.value : "";
        var yyyy = yrPart ? yrPart.value : "";
        return dd + "-" + mon + "-" + yyyy;
      }

      function callApi(plain) {
        debugState.lastFlag = String(plain && plain.flag ? plain.flag : "");
        try {
          var summary = {
            flag: plain && plain.flag,
            sub_flag: plain && plain.sub_flag,
            service_code: plain && plain.service_code,
            request_flag: plain && plain.request_flag,
            statement_type: plain && plain.statement_type,
            login_type: plain && plain.login_type,
            zero_bal_folio: plain && plain.zero_bal_folio,
            has_session_id: !!(plain && plain.session_id),
            has_recaptchatoken: !!(plain && plain.recaptchatoken),
            has_pan: !!(plain && plain.pan),
            has_email: !!(plain && plain.email_id),
            has_password: !!(plain && plain.password),
            from_date: plain && plain.from_date,
            to_date: plain && plain.to_date,
          };
          debugState.sentSummary = JSON.stringify(summary);
        } catch (e0) {}
        emitProgress("Calling CAMS API: " + String(plain && plain.flag ? plain.flag : "unknown"));
        return encryptPayload(plain)
          .then(function (data) {
            return withTimeout(fetch("/api/v1/camsonline", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json, text/plain, */*",
              },
              credentials: "include",
              body: JSON.stringify({ data: data }),
            }), 30000, "CAMS API call");
          })
          .then(function (res) {
            return Promise.all([res.text(), Promise.resolve(res.headers && res.headers.get ? res.headers.get("content-type") : "")]);
          })
          .then(function (pair) {
            var textRaw = pair[0];
            var contentType = String(pair[1] || "").toLowerCase();
            var text = String(textRaw || "").trim();
            debugState.responseContentType = contentType;
            debugState.responseLength = text.length;
            debugState.responseFull = text;
            debugState.responseStart = text.slice(0, 220);
            debugState.responseEnd = text.slice(-120);
            debugState.parsedShape = "raw-text";
            if (contentType.indexOf("text/html") >= 0 || text.indexOf("<!DOCTYPE html") >= 0 || text.indexOf("<html") >= 0) {
              throw new Error("CAMS returned HTML instead of API payload");
            }
            var cipher = text;
            try {
              var j = JSON.parse(text);
              if (typeof j === "string" && j.length) {
                debugState.parsedShape = "json-string";
                cipher = j;
              } else if (j && typeof j === "object") {
                debugState.parsedShape = "json-object";
                if (typeof j.data === "string" && j.data.length) cipher = j.data;
                else if (typeof j.Data === "string" && j.Data.length) cipher = j.Data;
                else if (typeof j.response === "string" && j.response.length) cipher = j.response;
                else if (typeof j.result === "string" && j.result.length) cipher = j.result;
                else if (j.status != null || j.detail != null || j.detail1 != null) return j;
              }
            } catch (e) {}
            if (cipher.length >= 2 && cipher.charCodeAt(0) === 34 && cipher.charCodeAt(cipher.length - 1) === 34) {
              try {
                cipher = JSON.parse(cipher);
              } catch (e2) {}
            }
            cipher = String(cipher || "").trim();
            // Keep payload untouched except whitespace/newline cleanup.
            cipher = cipher.replace(/\\n/g, "").replace(/\\r/g, "");
            debugState.cipherNormalizedEnd = cipher.slice(-24);
            debugState.cipherLength = cipher.length;
            try {
              var b = fromUrlB64(cipher);
              debugState.decodedByteLength = b.byteLength || 0;
              debugState.decodedByteLengthMod16 = (b.byteLength || 0) % 16;
            } catch (e3) {
              debugState.decodedByteLength = -1;
              debugState.decodedByteLengthMod16 = -1;
            }
            return decryptResponsePayload(cipher);
          });
      }

      function getRecaptchaToken() {
        emitProgress("Fetching reCAPTCHA token...");
        function parseRenderKey(src) {
          try {
            var u = new URL(src, location.href);
            return u.searchParams.get("render") || "";
          } catch (e) {
            return "";
          }
        }
        function discoverSiteKeys() {
          var keys = [];
          try {
            var scripts = document.querySelectorAll("script[src*='recaptcha']");
            for (var i = 0; i < scripts.length; i++) {
              var src = scripts[i].getAttribute("src") || "";
              var k = parseRenderKey(src);
              if (k) keys.push(k);
            }
          } catch (e) {}
          try {
            var dataEls = document.querySelectorAll("[data-sitekey]");
            for (var di = 0; di < dataEls.length; di++) {
              var dk = dataEls[di].getAttribute("data-sitekey") || "";
              if (dk) keys.push(dk);
            }
          } catch (e2) {}
          try {
            var ifr = document.querySelectorAll("iframe[src*='recaptcha']");
            for (var fi = 0; fi < ifr.length; fi++) {
              var fs = ifr[fi].getAttribute("src") || "";
              var fk = "";
              try {
                var fu = new URL(fs, location.href);
                fk = fu.searchParams.get("k") || fu.searchParams.get("render") || "";
              } catch (e3) {}
              if (fk) keys.push(fk);
            }
          } catch (e4) {}
          try {
            var cfg = window.___grecaptcha_cfg;
            var clients = cfg && cfg.clients ? cfg.clients : null;
            if (clients) {
              function walk(obj) {
                if (!obj || typeof obj !== "object") return;
                for (var k in obj) {
                  if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
                  var v = obj[k];
                  if (k === "sitekey" && typeof v === "string" && v) keys.push(v);
                  if (v && typeof v === "object") walk(v);
                }
              }
              walk(clients);
            }
          } catch (e5) {}
          keys.push(FALLBACK_SITE_KEY);
          var seen = {};
          var out = [];
          for (var j = 0; j < keys.length; j++) {
            var v = String(keys[j] || "");
            if (v && !seen[v]) {
              seen[v] = true;
              out.push(v);
            }
          }
          return out;
        }
        function ensureApiLoadedForKey(key) {
          function load(src) {
            return new Promise(function (resolve, reject) {
              try {
                var s = document.createElement("script");
                s.src = src;
                s.async = true;
                s.defer = true;
                s.onload = function () { resolve(); };
                s.onerror = function () { reject(new Error("failed to load " + src)); };
                document.head.appendChild(s);
              } catch (e) {
                reject(e);
              }
            });
          }
          if (window.grecaptcha && (window.grecaptcha.enterprise || window.grecaptcha.execute)) {
            return Promise.resolve();
          }
          var k = encodeURIComponent(String(key || "explicit"));
          // Prefer enterprise runtime with key-bound render parameter.
          return load("https://www.google.com/recaptcha/enterprise.js?render=" + k)
            .catch(function () { return Promise.resolve(); })
            .then(function () {
              if (window.grecaptcha && window.grecaptcha.enterprise) return;
              // Fallback only if enterprise is unavailable.
              return load("https://www.google.com/recaptcha/api.js?render=" + k).catch(function () {
                return Promise.resolve();
              });
            });
        }
        function tryEnterprise(key) {
          if (!window.grecaptcha || !window.grecaptcha.enterprise) return Promise.reject(new Error("enterprise-not-loaded"));
          return withTimeout(
            new Promise(function (r) { grecaptcha.enterprise.ready(r); }),
            10000,
            "reCAPTCHA enterprise ready"
          ).then(function () {
            return withTimeout(
              grecaptcha.enterprise.execute(key, { action: "GET_ACCOUNT_STATEMENT" }),
              15000,
              "reCAPTCHA enterprise token"
            );
          });
        }
        function tryStandard(key) {
          if (!window.grecaptcha) return Promise.reject(new Error("grecaptcha-not-loaded"));
          return withTimeout(
            new Promise(function (r) { grecaptcha.ready(r); }),
            10000,
            "reCAPTCHA ready"
          ).then(function () {
            return withTimeout(
              grecaptcha.execute(key, { action: "GET_ACCOUNT_STATEMENT" }),
              15000,
              "reCAPTCHA token"
            );
          });
        }
        function renderAndExecuteEnterprise(key) {
          if (!window.grecaptcha || !window.grecaptcha.enterprise) return Promise.reject(new Error("enterprise-not-loaded"));
          return withTimeout(
            new Promise(function (r) { grecaptcha.enterprise.ready(r); }),
            10000,
            "reCAPTCHA enterprise ready"
          ).then(function () {
            var id = "cams-recaptcha-holder";
            var holder = document.getElementById(id);
            if (!holder) {
              holder = document.createElement("div");
              holder.id = id;
              holder.style.position = "fixed";
              holder.style.left = "-9999px";
              holder.style.top = "-9999px";
              holder.style.width = "1px";
              holder.style.height = "1px";
              holder.style.opacity = "0";
              document.body.appendChild(holder);
            }
            var widgetId = grecaptcha.enterprise.render(holder, {
              sitekey: key,
              size: "invisible",
            });
            return withTimeout(
              grecaptcha.enterprise.execute(widgetId, { action: "GET_ACCOUNT_STATEMENT" }),
              15000,
              "reCAPTCHA enterprise render token"
            );
          });
        }
        function renderAndExecuteStandard(key) {
          if (!window.grecaptcha) return Promise.reject(new Error("grecaptcha-not-loaded"));
          return withTimeout(
            new Promise(function (r) { grecaptcha.ready(r); }),
            10000,
            "reCAPTCHA ready"
          ).then(function () {
            var id = "cams-recaptcha-holder";
            var holder = document.getElementById(id);
            if (!holder) {
              holder = document.createElement("div");
              holder.id = id;
              holder.style.position = "fixed";
              holder.style.left = "-9999px";
              holder.style.top = "-9999px";
              holder.style.width = "1px";
              holder.style.height = "1px";
              holder.style.opacity = "0";
              document.body.appendChild(holder);
            }
            var widgetId = grecaptcha.render(holder, {
              sitekey: key,
              size: "invisible",
            });
            return withTimeout(grecaptcha.execute(widgetId), 15000, "reCAPTCHA render token");
          });
        }
        function discoverWidgetIds() {
          var ids = [];
          try {
            var cfg = window.___grecaptcha_cfg;
            var clients = cfg && cfg.clients ? cfg.clients : null;
            if (clients) {
              for (var k in clients) {
                if (!Object.prototype.hasOwnProperty.call(clients, k)) continue;
                if (/^\\d+$/.test(String(k))) ids.push(String(k));
              }
            }
          } catch (e) {}
          var seen = {};
          var out = [];
          for (var i = 0; i < ids.length; i++) {
            var v = String(ids[i] || "");
            if (v && !seen[v]) {
              seen[v] = true;
              out.push(v);
            }
          }
          return out;
        }
        function tryWidgetIds(ids, i) {
          if (i >= ids.length) return Promise.reject(new Error("no-widget-token"));
          var wid = ids[i];
          emitProgress("Trying reCAPTCHA widget id: " + wid);
          // Try enterprise widget execution first, then standard execute(widgetId).
          return withTimeout(
            new Promise(function (r) {
              if (window.grecaptcha && window.grecaptcha.enterprise) return grecaptcha.enterprise.ready(r);
              if (window.grecaptcha) return grecaptcha.ready(r);
              r();
            }),
            8000,
            "widget ready"
          )
            .then(function () {
              if (window.grecaptcha && window.grecaptcha.enterprise) {
                return withTimeout(
                  grecaptcha.enterprise.execute(wid, { action: "GET_ACCOUNT_STATEMENT" }),
                  15000,
                  "enterprise widget token"
                );
              }
              if (window.grecaptcha) {
                return withTimeout(grecaptcha.execute(wid), 15000, "widget token");
              }
              throw new Error("grecaptcha-not-loaded");
            })
            .catch(function () {
              return tryWidgetIds(ids, i + 1);
            });
        }
        var lastErr = "";
        function tryKeys(keys, i) {
          if (i >= keys.length) {
            return Promise.reject(new Error("No usable reCAPTCHA site key found. Last error: " + lastErr));
          }
          var k = keys[i];
          emitProgress("Trying reCAPTCHA key: " + k.slice(0, 8) + "...");
          return ensureApiLoadedForKey(k)
            .then(function () {
              if (window.grecaptcha && window.grecaptcha.enterprise) {
                return tryEnterprise(k).catch(function () {
                  return renderAndExecuteEnterprise(k);
                });
              }
              return tryStandard(k).catch(function () {
                return renderAndExecuteStandard(k);
              });
            })
            .catch(function (e) {
              lastErr = String((e && e.message) ? e.message : e);
              return tryKeys(keys, i + 1);
            });
        }
        var widgetIds = discoverWidgetIds();
        if (widgetIds.length) {
          return tryWidgetIds(widgetIds, 0).catch(function () {
            return tryKeys(discoverSiteKeys(), 0);
          });
        }
        return tryKeys(discoverSiteKeys(), 0);
      }

      function pickSessionId(session) {
        var d = session.detail || session.detail1 || session.DETAIL || {};
        return (
          d.session_id ||
          d.SESSION_ID ||
          session.session_id ||
          session.sessionId ||
          null
        );
      }

      var base = {
        application: "CAMSONLINE",
        sub_application: "CAMSONLINE",
        browser: "Chrome",
        device_id: "131.0.0.0",
        os_id: typeof navigator !== "undefined" ? navigator.platform || "Unknown" : "Unknown",
        deviceid: "mobile",
        page_name: "${CAS_PAGE_PATH}",
      };

      callApi(
        Object.assign({}, base, {
          flag: "GET_ACCOUNT_STATEMENT_SESSION",
          email_id: INPUT.email,
          user_id: String(INPUT.email).toLowerCase(),
          service_code: "INVACCCAMSKARVY",
          login_type: "EMAIL",
          checkfieldtouched: "EMAIL$",
          checkfieldpristine: "EMAIL$",
        })
      )
        .then(function (session) {
          if (!session || !session.status || session.status.errorflag) {
            throw new Error(
              "session: " + (session && session.status && session.status.errormsg
                ? session.status.errormsg
                : JSON.stringify(session))
            );
          }
          var sessionId = pickSessionId(session);
          if (!sessionId) {
            throw new Error("no session_id in session response");
          }
          return delay(1200).then(function () {
            return sessionId;
          });
        })
        .then(function (sessionId) {
          return getRecaptchaToken().then(function (recaptchatoken) {
            return { sessionId: sessionId, recaptchatoken: recaptchatoken };
          });
        })
        .then(function (ctx) {
          return callApi(
            Object.assign({}, base, {
              flag: "GET_ACCOUNT_STATEMENT",
              sub_flag: "CAMSKARVYFTAMILSBFS",
              user_id: String(INPUT.email).toLowerCase(),
              password: INPUT.password,
              from_date: fmtDate(INPUT.fromIso),
              to_date: fmtDate(INPUT.toIso),
              email_id: INPUT.email,
              statement_type: "detailed",
              login_type: "EMAIL",
              service_code: "INVACCCAMSKARVY",
              zero_bal_folio: INPUT.zeroBalFolio || "N",
              pan: (INPUT.pan || "").toUpperCase(),
              request_flag: "SP",
              session_id: ctx.sessionId,
              checkfieldtouched: "EMAIL$PWD$CPWD$",
              checkfieldpristine: "EMAIL$PWD$CPWD$",
              recaptchatoken: ctx.recaptchatoken,
            })
          );
        })
        .then(function (submit) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ ok: true, submit: submit }));
        })
        .catch(function (e) {
          window.ReactNativeWebView.postMessage(
            JSON.stringify({
              ok: false,
              error: String((e && e.message) ? e.message : e),
              debug: debugState,
            })
          );
        });
    } catch (e) {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          ok: false,
          error: String((e && e.message) ? e.message : e),
          debug: debugState,
        })
      );
    }
  }
  run();
})();
true;`;
}
