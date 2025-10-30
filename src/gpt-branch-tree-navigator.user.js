// ==UserScript==
// @name         GPT Branch Tree Navigator (Preview + Jump)
// @namespace    jiaoling.tools.gpt.tree
// @version      1.6.0
// @description  树状分支 + 预览 + 一键跳转；支持隐藏与悬浮按钮恢复；快捷键 Alt+T；/ 聚焦搜索、Esc 关闭；拖拽移动面板；渐进式渲染；Markdown 预览；防抖监听；修复：当前分支已渲染却被误判为“未在该分支”。
// @author       Jiaoling
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  /** *********************************************************************
   * 配置常量
   ********************************************************************* */
  const Config = Object.freeze({
    PANEL_WIDTH_MIN: 500,
    PANEL_WIDTH_MAX: 500,
    PANEL_WIDTH_STEP: 1,
    CARD_WIDTH_MAX: 400,
    CARD_INDENT: 25,
    PREVIEW_FULL_LINES: 2,
    PREVIEW_TAIL_CHARS: 10,
    HIGHLIGHT_MS: 1400,
    SCROLL_OFFSET: 80,
    LS_KEY: "gtt_prefs_v3",
    RENDER_CHUNK: 120,
    RENDER_IDLE_MS: 12,
    OBS_DEBOUNCE_MS: 250,
    SIG_TEXT_LEN: 200,
    SELECTORS: {
      scrollRoot: "main",
      messageBlocks: [
        "[data-message-author-role]",
        "article:has(.markdown)",
        "main [data-testid^=\"conversation-turn\"]",
        "main .group.w-full",
        "main [data-message-id]"
      ].join(","),
      messageText: [
        ".markdown", ".prose",
        "[data-message-author-role] .whitespace-pre-wrap",
        "[data-message-author-role]"
      ].join(",")
    },
    ENDPOINTS: (cid) => ({
      get: [
        `/backend-api/conversation/${cid}`,
        `/backend-api/conversation/${cid}/`
      ]
    })
  });

  /** *********************************************************************
   * 样式
   ********************************************************************* */
  const StyleManager = (() => {
    function inject(css) {
      try {
        GM_addStyle(css);
      } catch (_) {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      }
    }

    return { inject };
  })();

  StyleManager.inject(`
    :root{--gtt-cur:#fa8c16;}
    #gtt-panel{
      position:fixed;top:64px;right:12px;z-index:999999;
      width:min(var(--gtt-panel-width, ${Config.PANEL_WIDTH_MAX}px), calc(100vw - 24px));
      max-width:min(${Config.PANEL_WIDTH_MAX}px, calc(100vw - 24px));
      min-width:min(${Config.PANEL_WIDTH_MIN}px, calc(100vw - 24px));
      max-height:calc(100vh - 84px);display:flex;flex-direction:column;overflow:hidden;
      border-radius:12px;border:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-bg,#fff);
      box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial;
      user-select:none
    }
    #gtt-header{display:flex;gap:8px;align-items:center;padding:10px 10px 10px 18px;border-bottom:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-hd,#f6f8fa)}
    #gtt-header .title{font-weight:700;flex:1;cursor:move}
    #gtt-header .btn{border:1px solid var(--gtt-bd,#d0d7de);background:#fff;cursor:pointer;padding:4px 8px;border-radius:8px;font-size:12px}
    #gtt-body{display:flex;flex-direction:column;min-height:0;flex:1 1 auto}
    #gtt-search{margin:8px 10px 8px 18px;padding:6px 8px;border:1px solid var(--gtt-bd,#d0d7de);border-radius:8px;width:calc(100% - 28px);outline:none;background:var(--gtt-bg,#fff)}
    #gtt-resize{position:absolute;top:0;left:0;width:8px;height:100%;cursor:ew-resize;display:flex;align-items:center;justify-content:center;z-index:1;touch-action:none}
    #gtt-resize::after{content:'';width:2px;height:32px;border-radius:1px;background:var(--gtt-bd,#d0d7de);opacity:.55;transition:opacity .2s ease}
    #gtt-resize:hover::after{opacity:.85}
    #gtt-pref{display:flex;gap:10px;align-items:center;padding:0 10px 8px 18px;color:#555;flex-wrap:wrap}
    #gtt-pref .gtt-pref-row{display:flex;align-items:center;gap:8px;flex:1 1 100%;font-size:12px}
    #gtt-pref .gtt-pref-title{white-space:nowrap;opacity:.8}
    #gtt-pref .gtt-pref-value{min-width:44px;text-align:right;opacity:.8}
    #gtt-pref input[type="range"]{flex:1 1 auto}
    #gtt-pref .gtt-pref-reset{border:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-bg,#fff);color:inherit;padding:2px 6px;border-radius:6px;font-size:11px;cursor:pointer}
    #gtt-tree{overflow:auto;overflow-x:auto;padding:8px 12px 10px 18px;max-width:calc(${Config.PANEL_WIDTH_MAX}px - 30px);flex:1 1 auto;min-height:0;width:100%;max-height:var(--gtt-tree-max-height,360px)}
    .gtt-node{padding:6px 8px;border-radius:8px;margin:2px 0;cursor:pointer;position:relative;display:flex;flex-direction:column;gap:4px;width:100%;max-width:${Config.CARD_WIDTH_MAX}px;flex-shrink:0;box-sizing:border-box}
    .gtt-node:hover{background:rgba(127,127,255,.08)}
    .gtt-node .head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .gtt-node .badge{display:inline-flex;align-items:center;justify-content:center;font-size:10px;padding:1px 5px;border-radius:6px;border:1px solid var(--gtt-bd,#d0d7de);opacity:.75;min-width:18px}
    .gtt-node .title{font-weight:600;word-break:break-word;flex:1 1 auto}
    .gtt-node .meta{opacity:.65;font-size:10px;margin-left:auto;white-space:nowrap}
    .gtt-node .pv{display:flex;flex-direction:column;gap:2px;opacity:.88;margin:0;white-space:normal;word-break:break-word}
    .gtt-node .pv-line{display:block}
    .gtt-node .pv-line-more{font-size:12px;opacity:.7}
    .gtt-children{margin-left:${Config.CARD_INDENT}px;border-left:1px dashed var(--gtt-bd,#d0d7de);padding-left:10px}
    .gtt-hidden{display:none!important}
    .gtt-highlight{outline:3px solid rgba(88,101,242,.65)!important;transition:outline-color .6s ease}
    .gtt-node.gtt-current{background:rgba(250,140,22,.12);border-left:2px solid var(--gtt-cur,#fa8c16);padding-left:10px}
    .gtt-node.gtt-current .badge{border-color:var(--gtt-cur,#fa8c16);color:var(--gtt-cur,#fa8c16);opacity:1}
    .gtt-node.gtt-current-leaf{box-shadow:0 0 0 2px rgba(250,140,22,.24) inset}
    .gtt-children.gtt-current-line{border-left:2px dashed var(--gtt-cur,#fa8c16)}

    #gtt-modal{position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,.42);display:none;align-items:center;justify-content:center}
    #gtt-modal .card{max-width:880px;max-height:80vh;overflow:auto;background:var(--gtt-bg,#fff);border:1px solid var(--gtt-bd,#d0d7de);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25)}
    #gtt-modal .hd{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-hd,#f6f8fa);position:sticky;top:0;z-index:1}
    #gtt-modal .bd{padding:12px 16px;font-size:14px;line-height:1.65;overflow-x:auto}
    #gtt-modal .bd p{margin:0 0 10px}
    #gtt-modal .bd h1,#gtt-modal .bd h2,#gtt-modal .bd h3,#gtt-modal .bd h4,#gtt-modal .bd h5,#gtt-modal .bd h6{margin:18px 0 10px;font-weight:600}
    #gtt-modal .bd pre{background:rgba(99,110,123,.08);padding:10px 12px;border-radius:8px;margin:12px 0;font-family:SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;line-height:1.55;white-space:pre;overflow:auto}
    #gtt-modal .bd code{background:rgba(99,110,123,.2);padding:1px 4px;border-radius:4px;font-family:SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:13px}
    #gtt-modal .bd pre code{background:transparent;padding:0}
    #gtt-modal .bd ul{margin:0 0 12px 18px;padding:0 0 0 12px}
    #gtt-modal .bd li{margin:4px 0}
    #gtt-modal .btn{border:1px solid var(--gtt-bd,#d0d7de);background:#fff;cursor:pointer;padding:4px 8px;border-radius:8px;font-size:12px}

    #gtt-fab{
      position:fixed;right:12px;bottom:16px;z-index:999999;display:none;align-items:center;gap:8px;
      padding:8px 12px;border-radius:999px;border:1px solid var(--gtt-bd,#d0d7de);
      background:var(--gtt-bg,#fff);box-shadow:0 8px 28px rgba(0,0,0,.18);cursor:pointer
    }
    #gtt-fab .dot{width:8px;height:8px;border-radius:50%;background:#5865f2}
    #gtt-fab .txt{font-weight:600}

    @media (prefers-color-scheme: dark){
      :root{--gtt-bg:#0b0e14;--gtt-hd:#0f131a;--gtt-bd:#2b3240;--gtt-cur:#f59b4c;color-scheme:dark}
      #gtt-header .btn,#gtt-modal .btn,#gtt-fab{background:#0b0e14;color:#d1d7e0}
      .gtt-node:hover{background:rgba(120,152,255,.12)}
      .gtt-node.gtt-current{background:rgba(250,140,22,.18)}
    }
  `);

  /** *********************************************************************
   * 基础工具
   ********************************************************************* */
  const DOM = {
    query(selector, root = document) { return root.querySelector(selector); },
    queryAll(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }
  };

  const Text = {
    normalize(value) {
      return (value || "").replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
    },
    normalizeForPreview(value) {
      return (value || "").replace(/\u200b/g, "").replace(/\r\n?/g, "\n");
    },
    truncate(value, maxChars) {
      if (!value) return "";
      if (!Number.isFinite(maxChars) || maxChars <= 0) return value;
      const units = Array.from(value);
      if (units.length <= maxChars) return value;
      return units.slice(0, maxChars).join("");
    }
  };

  const Hash = {
    of(value) {
      const input = value || "";
      let h = 0;
      for (let i = 0; i < input.length; i++) {
        h = ((h << 5) - h + input.charCodeAt(i)) | 0;
      }
      return (h >>> 0).toString(36);
    }
  };

  const HTML = {
    ESCAPES: { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" },
    escape(value = "") {
      return value.replace(/[&<>'"]/g, ch => HTML.ESCAPES[ch] || ch);
    },
    escapeAttr(value = "") {
      return HTML.escape(value).replace(/`/g, "&#96;");
    },
    formatInline(text = "") {
      let out = HTML.escape(text);
      out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
      out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${HTML.escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`);
      const codeHolders = [];
      out = out.replace(/<code>[^<]*<\/code>/g, (match) => {
        codeHolders.push(match);
        return `\uFFF0${codeHolders.length - 1}\uFFF1`;
      });
      out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
      out = out.replace(/(\s|^)\*([^*\n]+)\*(?=\s|[\.,!?:;\)\]\}“”"'`]|$)/g, (_m, pre, body) => `${pre}<em>${body}</em>`);
      out = out.replace(/(\s|^)_(?!_)([^_\n]+)_(?=\s|[\.,!?:;\)\]\}“”"'`]|$)/g, (_m, pre, body) => `${pre}<em>${body}</em>`);
      out = out.replace(/\uFFF0(\d+)\uFFF1/g, (_m, idx) => codeHolders[Number(idx)]);
      return out;
    }
  };

  const Markdown = {
    renderLite(raw = "") {
      const text = Text.normalizeForPreview(raw || "").trimEnd();
      if (!text) return "<p>(空)</p>";
      const lines = text.split("\n");
      let html = "";
      let inList = false;
      let codeBuffer = null;
      let codeLang = "";

      const flushList = () => { if (inList) { html += "</ul>"; inList = false; } };
      const flushCode = () => {
        if (!codeBuffer) return;
        const cls = codeLang ? ` class="lang-${HTML.escapeAttr(codeLang)}"` : "";
        const body = codeBuffer.map(HTML.escape).join("\n");
        html += `<pre><code${cls}>${body}</code></pre>`;
        codeBuffer = null;
        codeLang = "";
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (/^```/.test(trimmed)) {
          if (codeBuffer) {
            flushCode();
          } else {
            flushList();
            codeBuffer = [];
            codeLang = trimmed.slice(3).trim();
          }
          continue;
        }
        if (codeBuffer) {
          codeBuffer.push(line);
          continue;
        }
        if (!trimmed) {
          flushList();
          html += "<br>";
          continue;
        }
        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
          flushList();
          const level = heading[1].length;
          html += `<h${level}>${HTML.formatInline(heading[2])}</h${level}>`;
          continue;
        }
        const listItem = line.match(/^\s*[-*+]\s+(.*)$/);
        if (listItem) {
          if (!inList) {
            html += "<ul>";
            inList = true;
          }
          html += `<li>${HTML.formatInline(listItem[1])}</li>`;
          continue;
        }
        flushList();
        html += `<p>${HTML.formatInline(line)}</p>`;
      }
      flushCode();
      flushList();
      return html;
    }
  };

  const Preview = (() => {
    const FULL_LINES = Math.max(0, Number(Config.PREVIEW_FULL_LINES) || 0);
    const TAIL_CHARS = Math.max(0, Number(Config.PREVIEW_TAIL_CHARS) || 0);

    function sliceUnits(value, count) {
      if (!Number.isFinite(count) || count <= 0) return "";
      return Array.from(value || "").slice(0, count).join("");
    }

    function lines(rawText) {
      const normalized = Text
        .normalizeForPreview(rawText || "")
        .split("\n")
        .map(segment => Text.normalize(segment))
        .filter(Boolean);

      if (!normalized.length) return ["(空)"];

      const result = [];
      const take = FULL_LINES > 0 ? Math.min(FULL_LINES, normalized.length) : Math.min(2, normalized.length);
      for (let i = 0; i < take; i++) {
        result.push(normalized[i]);
      }

      if (normalized.length > take) {
        const rest = Text.normalize(normalized.slice(take).join(" "));
        if (rest) {
          const snippet = TAIL_CHARS > 0 ? sliceUnits(rest, TAIL_CHARS) : "";
          result.push(`${snippet}...`);
        }
      }

      return result;
    }

    return { lines };
  })();

  const Timing = {
    rafIdle(fn, ms = Config.RENDER_IDLE_MS) { return setTimeout(fn, ms); },
    debounce(fn, wait) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
      };
    }
  };

  const LocationHelper = {
    getConversationId() {
      const match = location.pathname.match(/\/c\/([a-z0-9-]{10,})/i) || [];
      return match[1] || null;
    }
  };

  const Signature = {
    create(role, text) {
      return (role || "assistant") + "|" + Hash.of(Text.normalize(text).slice(0, Config.SIG_TEXT_LEN));
    }
  };

  /** *********************************************************************
   * 偏好存储
   ********************************************************************* */
  const Prefs = (() => {
    const defaults = { hidden: false, pos: null, width: null };

    function load() {
      try {
        const raw = localStorage.getItem(Config.LS_KEY) || localStorage.getItem("gtt_prefs_v2");
        const parsed = raw ? JSON.parse(raw) : {};
        return { ...defaults, ...parsed };
      } catch (_) {
        return { ...defaults };
      }
    }

    let state = load();

    function save() {
      try { localStorage.setItem(Config.LS_KEY, JSON.stringify(state)); }
      catch (_) { /* ignore */ }
    }

    function set(key, value, { silent = false } = {}) {
      state = { ...state, [key]: value };
      if (!silent) save();
    }

    function assign(patch, { silent = false } = {}) {
      state = { ...state, ...patch };
      if (!silent) save();
    }

    return {
      defaults,
      snapshot: () => ({ ...state }),
      get: (key) => state[key],
      set,
      assign,
      save,
    };
  })();

  /** *********************************************************************
   * 认证与数据获取
   ********************************************************************* */
  const Auth = (() => {
    const origFetch = window.fetch.bind(window);
    let lastAuth = null;
    let patched = false;

    function extractAuthHeaders(input, init) {
      try {
        if (input instanceof Request) {
          const headers = Object.fromEntries(input.headers.entries());
          return headers.authorization || headers.Authorization || null;
        }
        const headers = init?.headers;
        if (headers instanceof Headers) {
          return headers.get("authorization") || headers.get("Authorization");
        }
        if (headers && typeof headers === "object") {
          return headers.authorization || headers.Authorization || null;
        }
      } catch (_) {
        return null;
      }
      return null;
    }

    function rememberAuth(authHeader) {
      if (!authHeader || lastAuth) return;
      lastAuth = { Authorization: authHeader };
    }

    async function ensureAuth() {
      if (lastAuth?.Authorization) return lastAuth;
      try {
        const res = await origFetch("/api/auth/session", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data?.accessToken) {
            lastAuth = { Authorization: `Bearer ${data.accessToken}` };
            return lastAuth;
          }
        }
      } catch (_) {
        /* ignore */
      }
      return lastAuth || {};
    }

    function withHeaders(extra = {}) {
      return { ...(lastAuth || {}), ...extra };
    }

    function patch(onMapping) {
      if (patched) return;
      patched = true;
      window.fetch = async (...args) => {
        const [input, init] = args;
        const authHeader = extractAuthHeaders(input, init);
        if (authHeader) rememberAuth(authHeader);
        const response = await origFetch(...args);
        try {
          const url = typeof input === "string" ? input : (input?.url || "");
          if (/\/backend-api\/conversation\//.test(url)) {
            const clone = response.clone();
            const json = await clone.json();
            if (json?.mapping) {
              onMapping(json.mapping);
            }
          }
        } catch (_) {
          /* ignore parsing errors */
        }
        return response;
      };
    }

    return { ensureAuth, withHeaders, patch, origFetch };
  })();

  /** *********************************************************************
   * 树形数据状态
   ********************************************************************* */
  const TreeState = (() => {
    const state = {
      mapping: new Map(),
      linearNodes: [],
      domById: new Map(),
      domBySig: new Map(),
      currentBranchIds: new Set(),
      currentBranchSigs: new Set(),
      currentBranchLeafId: null,
      currentBranchLeafSig: null,
    };

    function reset() {
      state.mapping.clear();
      state.linearNodes = [];
      state.domById.clear();
      state.domBySig.clear();
      state.currentBranchIds.clear();
      state.currentBranchSigs.clear();
      state.currentBranchLeafId = null;
      state.currentBranchLeafSig = null;
    }

    function setMapping(raw) {
      state.mapping.clear();
      if (!raw) return;
      if (raw instanceof Map) {
        for (const [key, value] of raw.entries()) {
          state.mapping.set(key, value);
        }
        return;
      }
      if (typeof raw === "object") {
        for (const [key, value] of Object.entries(raw)) {
          state.mapping.set(key, value);
        }
      }
    }

    function updateCurrentBranch({ ids, sigs, leafId, leafSig }) {
      state.currentBranchIds = new Set(ids || []);
      state.currentBranchSigs = new Set(sigs || []);
      state.currentBranchLeafId = leafId || null;
      state.currentBranchLeafSig = leafSig || null;
    }

    return {
      state,
      reset,
      setMapping,
      updateCurrentBranch,
    };
  })();

  /** *********************************************************************
   * 模态框 & 导航
   ********************************************************************* */
  const Modal = (() => {
    function open(text, reason) {
      const body = DOM.query("#gtt-md-body");
      const title = DOM.query("#gtt-md-title");
      const modal = DOM.query("#gtt-modal");
      if (!body || !title || !modal) return;
      body.innerHTML = Markdown.renderLite(text);
      title.textContent = reason || "节点预览";
      modal.style.display = "flex";
    }

    function close() {
      const modal = DOM.query("#gtt-modal");
      const body = DOM.query("#gtt-md-body");
      if (modal) modal.style.display = "none";
      if (body) body.innerHTML = "";
    }

    return { open, close };
  })();

  const Navigator = (() => {
    function scrollToEl(el) {
      if (!el) return;
      const root = DOM.query(Config.SELECTORS.scrollRoot) || document.scrollingElement || document.documentElement;
      const rect = el.getBoundingClientRect();
      const targetY = (root.scrollTop || window.scrollY || 0) + rect.top - Config.SCROLL_OFFSET;
      root.scrollTo({ top: Math.max(0, targetY), behavior: "smooth" });
      el.classList.add("gtt-highlight");
      setTimeout(() => el.classList.remove("gtt-highlight"), Config.HIGHLIGHT_MS);
    }

    function locateByText(text) {
      const normalized = Text.normalize(text);
      if (!normalized) return null;
      const selector = Config.SELECTORS.messageBlocks;
      const blocks = DOM.queryAll(selector);
      for (const block of blocks) {
        const textEl = DOM.query(Config.SELECTORS.messageText, block);
        if (!textEl) continue;
        const blockText = Text.normalize(textEl.textContent);
        if (!blockText) continue;
        if (blockText.includes(normalized.slice(0, 24))) {
          return block;
        }
      }
      return null;
    }

    async function jumpTo(node) {
      if (!node) return;
      let target = TreeState.state.domById.get(node.id);
      if (target && target.isConnected) return scrollToEl(target);
      const sig = node.sig || Signature.create(node.role, node.text);
      target = TreeState.state.domBySig.get(sig);
      if (target && target.isConnected) return scrollToEl(target);
      target = locateByText(node.text);
      if (target) return scrollToEl(target);
      Modal.open(node.text || "(无文本)", "节点预览（未能定位到页面元素，已为你展示文本）");
    }

    return { jumpTo };
  })();

  /** *********************************************************************
   * 面板
   ********************************************************************* */
  const Panel = (() => {
    let widthRangeEl = null;
    let widthValueEl = null;
    let resizeListenerBound = false;
    let treeHeightScheduled = false;

    function scheduleNextFrame(cb) {
      const runner = () => {
        treeHeightScheduled = false;
        cb();
      };
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(runner);
      } else {
        setTimeout(runner, 16);
      }
    }

    function updateTreeHeight(immediate = false) {
      const measure = () => {
        const tree = DOM.query("#gtt-tree");
        if (!tree) return;
        const nodes = Array.from(tree.querySelectorAll(".gtt-node")).filter(node => node.offsetParent);
        if (!nodes.length) {
          tree.style.removeProperty("--gtt-tree-max-height");
          return;
        }
        const take = nodes.slice(0, Math.min(3, nodes.length));
        let total = 0;
        for (const node of take) {
          const style = window.getComputedStyle(node);
          const marginTop = parseFloat(style.marginTop) || 0;
          const marginBottom = parseFloat(style.marginBottom) || 0;
          total += node.offsetHeight + marginTop + marginBottom;
        }
        const treeStyle = window.getComputedStyle(tree);
        const paddingTop = parseFloat(treeStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(treeStyle.paddingBottom) || 0;
        const height = Math.max(0, Math.ceil(total + paddingTop + paddingBottom));
        if (height > 0) {
          tree.style.setProperty("--gtt-tree-max-height", `${height}px`);
        } else {
          tree.style.removeProperty("--gtt-tree-max-height");
        }
      };

      if (immediate) {
        measure();
        return;
      }
      if (treeHeightScheduled) return;
      treeHeightScheduled = true;
      scheduleNextFrame(measure);
    }

    function getViewportWidthLimit() {
      const viewportLimit = Math.max(Config.PANEL_WIDTH_MIN, Math.floor(window.innerWidth - 24));
      return Math.min(Config.PANEL_WIDTH_MAX, viewportLimit);
    }

    function clampWidth(value) {
      const max = getViewportWidthLimit();
      if (!Number.isFinite(value)) return max;
      return Math.min(Math.max(Config.PANEL_WIDTH_MIN, Math.round(value)), max);
    }

    function getAutoWidth() {
      return clampWidth(Config.PANEL_WIDTH_MAX);
    }

    function updateWidthRangeBounds() {
      if (!widthRangeEl) return;
      widthRangeEl.min = String(Config.PANEL_WIDTH_MIN);
      widthRangeEl.max = String(getViewportWidthLimit());
    }

    function updateWidthDisplay(value) {
      if (widthValueEl) {
        widthValueEl.textContent = Number.isFinite(value) ? `${clampWidth(value)}px` : "自动";
      }
      if (widthRangeEl) {
        const fallback = getAutoWidth();
        const displayValue = Number.isFinite(value) ? clampWidth(value) : fallback;
        widthRangeEl.value = String(displayValue);
      }
    }

    function syncWidth(value = Prefs.get("width"), { preview = false } = {}) {
      const panel = DOM.query("#gtt-panel");
      if (!panel) return null;
      updateWidthRangeBounds();
      let applied = null;
      if (Number.isFinite(value)) {
        const clamped = clampWidth(value);
        panel.style.setProperty("--gtt-panel-width", `${clamped}px`);
        updateWidthDisplay(clamped);
        applied = clamped;
      } else {
        if (!preview) panel.style.removeProperty("--gtt-panel-width");
        updateWidthDisplay(null);
      }
      updateTreeHeight();
      return applied;
    }

    function setWidth(value, { silent = false } = {}) {
      if (!Number.isFinite(value)) {
        Prefs.set("width", null, { silent });
        syncWidth(null);
        return null;
      }
      const clamped = clampWidth(value);
      Prefs.set("width", clamped, { silent });
      syncWidth(clamped);
      return clamped;
    }

    function resetWidth() {
      setWidth(null);
    }

    function ensureResizeListener() {
      if (resizeListenerBound) return;
      resizeListenerBound = true;
      window.addEventListener("resize", () => {
        syncWidth();
        updateTreeHeight();
      });
    }

    function ensureFab() {
      if (DOM.query("#gtt-fab")) return;
      const fab = document.createElement("div");
      fab.id = "gtt-fab";
      fab.innerHTML = `<span class="dot"></span><span class="txt">GPT Tree</span>`;
      fab.addEventListener("click", () => setHidden(false));
      document.body.appendChild(fab);
    }

    function ensurePanel() {
      if (DOM.query("#gtt-panel")) return;
      const panel = document.createElement("div");
      panel.id = "gtt-panel";
      panel.innerHTML = `
        <div id="gtt-resize" title="拖拽调整宽度"></div>
        <div id="gtt-header">
          <div class="title" id="gtt-drag">GPT Tree</div>
          <button class="btn" id="gtt-btn-refresh">刷新</button>
          <button class="btn" id="gtt-btn-hide" title="隐藏（Alt+T）">隐藏</button>
        </div>
        <div id="gtt-body">
          <input id="gtt-search" placeholder="搜索节点（文本/角色）… / 聚焦，Esc 清除">
          <div id="gtt-pref">
            <span style="opacity:.65" id="gtt-stats"></span>
            <div class="gtt-pref-row">
              <span class="gtt-pref-title">最大宽度</span>
              <input type="range" id="gtt-width-range" min="${Config.PANEL_WIDTH_MIN}" max="${Config.PANEL_WIDTH_MAX}" step="${Config.PANEL_WIDTH_STEP}">
              <span class="gtt-pref-value" id="gtt-width-value"></span>
              <button type="button" class="gtt-pref-reset" id="gtt-width-reset" title="恢复默认宽度">重置</button>
            </div>
          </div>
          <div id="gtt-tree"></div>
        </div>
        <div id="gtt-modal">
          <div class="card">
            <div class="hd">
              <div style="font-weight:700;flex:1" id="gtt-md-title">节点预览</div>
              <button class="btn" id="gtt-md-close">关闭</button>
            </div>
            <div class="bd" id="gtt-md-body"></div>
          </div>
        </div>
      `;
      document.body.appendChild(panel);
      bindPanel(panel);
      applyState(panel);
    }

    function bindPanel(panel) {
      const btnHide = DOM.query("#gtt-btn-hide", panel);
      const btnRefresh = DOM.query("#gtt-btn-refresh", panel);
      const btnCloseModal = DOM.query("#gtt-md-close", panel);
      const dragHandle = DOM.query("#gtt-drag", panel);
      const inputSearch = DOM.query("#gtt-search", panel);
      widthRangeEl = DOM.query("#gtt-width-range", panel);
      widthValueEl = DOM.query("#gtt-width-value", panel);
      const widthResetBtn = DOM.query("#gtt-width-reset", panel);
      const resizeHandle = DOM.query("#gtt-resize", panel);

      if (btnHide) btnHide.addEventListener("click", () => setHidden(true));
      if (btnRefresh) btnRefresh.addEventListener("click", () => Lifecycle.rebuild({ forceFetch: true, hard: true }));
      if (btnCloseModal) btnCloseModal.addEventListener("click", Modal.close);

      if (inputSearch) {
        const handleSearch = Timing.debounce((e) => {
          const query = (typeof e === "string" ? e : (e?.target?.value || "")).trim().toLowerCase();
          DOM.queryAll("#gtt-tree .gtt-node").forEach(node => {
            node.style.display = node.textContent.toLowerCase().includes(query) ? "" : "none";
          });
          updateTreeHeight();
        }, 120);
        inputSearch.addEventListener("input", handleSearch);
      }

      if (widthRangeEl) {
        widthRangeEl.addEventListener("input", (e) => {
          const value = Number(e.target?.value);
          if (Number.isFinite(value)) syncWidth(value, { preview: true });
        });
        widthRangeEl.addEventListener("change", (e) => {
          setWidth(Number(e.target?.value));
        });
      }

      if (widthResetBtn) widthResetBtn.addEventListener("click", () => resetWidth());

      if (dragHandle) {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;

        const handleMove = (evt) => {
          if (!dragging) return;
          const point = evt.touches ? evt.touches[0] : evt;
          if (!point) return;
          const deltaX = point.clientX - startX;
          const deltaY = point.clientY - startY;
          const nextLeft = startLeft + deltaX;
          const nextTop = startTop + deltaY;
          panel.style.left = `${nextLeft}px`;
          panel.style.top = `${nextTop}px`;
          panel.style.right = "auto";
        };

        const handleUp = () => {
          if (!dragging) return;
          dragging = false;
          document.removeEventListener("mousemove", handleMove);
          document.removeEventListener("mouseup", handleUp);
          document.removeEventListener("touchmove", handleMove);
          document.removeEventListener("touchend", handleUp);
          document.removeEventListener("touchcancel", handleUp);
          Prefs.set("pos", { left: panel.offsetLeft, top: panel.offsetTop });
        };

        const startDrag = (evt) => {
          dragging = true;
          const point = evt.touches ? evt.touches[0] : evt;
          startX = point.clientX;
          startY = point.clientY;
          startLeft = panel.offsetLeft;
          startTop = panel.offsetTop;
          document.addEventListener("mousemove", handleMove);
          document.addEventListener("mouseup", handleUp);
          document.addEventListener("touchmove", handleMove, { passive: false });
          document.addEventListener("touchend", handleUp, { passive: false });
          document.addEventListener("touchcancel", handleUp, { passive: false });
        };

        dragHandle.addEventListener("mousedown", (e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          startDrag(e);
        });
        dragHandle.addEventListener("touchstart", (e) => {
          const touch = e.touches?.[0];
          if (!touch) return;
          startDrag(e);
        }, { passive: false });
      }

      if (resizeHandle) {
        const cleanup = (moveListener, upListener) => {
          document.removeEventListener("mousemove", moveListener);
          document.removeEventListener("mouseup", upListener);
          document.removeEventListener("touchmove", moveListener);
          document.removeEventListener("touchend", upListener);
          document.removeEventListener("touchcancel", upListener);
        };

        const startResize = (clientX) => {
          let resizing = true;
          let previewWidth = null;
          const startX = clientX;
          const startWidth = panel.getBoundingClientRect().width;
          const prevUserSelect = document.body.style.userSelect;
          const prevCursor = document.body.style.cursor;
          document.body.style.userSelect = "none";
          document.body.style.cursor = "ew-resize";

          const handleMove = (evt) => {
            if (!resizing) return;
            if (evt?.cancelable) evt.preventDefault();
            const point = evt.touches ? evt.touches[0] : evt;
            if (!point) return;
            const delta = startX - point.clientX;
            const next = clampWidth(startWidth + delta);
            previewWidth = next;
            syncWidth(next, { preview: true });
          };

          const handleUp = () => {
            if (!resizing) return;
            resizing = false;
            cleanup(handleMove, handleUp);
            document.body.style.userSelect = prevUserSelect;
            document.body.style.cursor = prevCursor;
            const stored = Prefs.get("width");
            if (previewWidth != null && Math.abs(previewWidth - startWidth) >= 1) {
              setWidth(previewWidth);
            } else if (!Number.isFinite(stored)) {
              syncWidth(null);
            } else {
              syncWidth(stored);
            }
          };

          document.addEventListener("mousemove", handleMove);
          document.addEventListener("mouseup", handleUp, { once: true });
          document.addEventListener("touchmove", handleMove, { capture: true, passive: false });
          document.addEventListener("touchend", handleUp, { once: true, capture: true });
          document.addEventListener("touchcancel", handleUp, { once: true, capture: true });
        };

        resizeHandle.addEventListener("mousedown", (e) => {
          e.preventDefault();
          startResize(e.clientX);
        });

        resizeHandle.addEventListener("touchstart", (e) => {
          const touch = e.touches?.[0];
          if (!touch) return;
          e.preventDefault();
          startResize(touch.clientX);
        }, { passive: false });

        resizeHandle.addEventListener("dblclick", (e) => {
          e.preventDefault();
          resetWidth();
        });
      }
    }

    function applyState(panel) {
      const { hidden, pos, width } = Prefs.snapshot();
      setHidden(hidden, { silent: true });
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        panel.style.left = `${pos.left}px`;
        panel.style.top = `${pos.top}px`;
        panel.style.right = "auto";
      }
      syncWidth(width, { preview: true });
    }

    function setHidden(value, { silent = false } = {}) {
      const panel = DOM.query("#gtt-panel");
      const fab = DOM.query("#gtt-fab");
      if (!panel || !fab) return;
      if (value) {
        panel.style.display = "none";
        fab.style.display = "inline-flex";
      } else {
        panel.style.display = "flex";
        fab.style.display = "none";
        updateTreeHeight();
      }
      Prefs.set("hidden", !!value, { silent });
    }

    function updateStats(total) {
      const el = DOM.query("#gtt-stats");
      if (el) el.textContent = total ? `节点：${total}` : "";
    }

    function applyPosition() {
      const panel = DOM.query("#gtt-panel");
      if (!panel) return;
      const pos = Prefs.get("pos");
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        panel.style.left = `${pos.left}px`;
        panel.style.top = `${pos.top}px`;
        panel.style.right = "auto";
      }
    }

    return {
      ensure: () => { ensureFab(); ensurePanel(); ensureResizeListener(); },
      ensureFab,
      ensurePanel,
      setHidden,
      updateStats,
      applyPosition,
      syncWidth,
      setWidth,
      updateTreeHeight,
    };
  })();

  /** *********************************************************************
   * 分支高亮
   ********************************************************************* */
  const BranchHighlighter = (() => {
    function clear(rootEl) {
      const nodeEls = rootEl.querySelectorAll(".gtt-node");
      const connectorEls = rootEl.querySelectorAll(".gtt-children");
      nodeEls.forEach(el => el.classList.remove("gtt-current", "gtt-current-leaf"));
      connectorEls.forEach(el => el.classList.remove("gtt-current-line"));
    }

    function apply(rootEl = DOM.query("#gtt-tree")) {
      if (!rootEl) return;
      clear(rootEl);
      const hasBranch = (TreeState.state.currentBranchIds.size || TreeState.state.currentBranchSigs.size);
      if (!hasBranch) return;
      const nodeEls = rootEl.querySelectorAll(".gtt-node");
      nodeEls.forEach(el => {
        const id = el.dataset?.nodeId;
        const sig = el.dataset?.sig;
        const chainIds = Array.isArray(el._chainIds) ? el._chainIds : null;
        const chainSigs = Array.isArray(el._chainSigs) ? el._chainSigs : null;
        const matchesId = id && TreeState.state.currentBranchIds.has(id);
        const matchesSig = sig && TreeState.state.currentBranchSigs.has(sig);
        const matchesChainId = chainIds ? chainIds.some(cid => TreeState.state.currentBranchIds.has(cid)) : false;
        const matchesChainSig = chainSigs ? chainSigs.some(cs => TreeState.state.currentBranchSigs.has(cs)) : false;
        const isCurrent = matchesId || matchesSig || matchesChainId || matchesChainSig;
        if (!isCurrent) return;
        el.classList.add("gtt-current");
        const isLeaf = (
          (TreeState.state.currentBranchLeafId && (id === TreeState.state.currentBranchLeafId || (chainIds && chainIds.includes(TreeState.state.currentBranchLeafId)))) ||
          (TreeState.state.currentBranchLeafSig && (sig === TreeState.state.currentBranchLeafSig || (chainSigs && chainSigs.includes(TreeState.state.currentBranchLeafSig))))
        );
        if (isLeaf) {
          el.classList.add("gtt-current-leaf");
        }
        const parent = el.parentElement;
        if (parent && parent.classList.contains("gtt-children")) {
          parent.classList.add("gtt-current-line");
        }
      });
    }

    return { apply };
  })();

  /** *********************************************************************
   * 节点构建与渲染
   ********************************************************************* */

  const TreeBuilder = (() => {
    function isToolishRole(role) {
      return role === "tool" || role === "system" || role === "function";
    }

    function getRecText(rec) {
      const parts = rec?.message?.content?.parts ?? [];
      if (Array.isArray(parts)) return parts.join("\n");
      if (typeof parts === "string") return parts;
      return "";
    }

    function isVisibleRec(rec) {
      if (!rec) return false;
      const role = rec?.message?.author?.role || "assistant";
      if (isToolishRole(role)) return false;
      const text = getRecText(rec);
      return !!Text.normalize(text);
    }

    function visibleParentId(mapping, id) {
      let cur = id;
      let guard = 0;
      while (guard++ < 4096) {
        const parentId = mapping[cur]?.parent;
        if (parentId == null) return null;
        const parentRec = mapping[parentId];
        if (isVisibleRec(parentRec)) return parentId;
        cur = parentId;
      }
      return null;
    }

    function dedupBySig(ids, mapping) {
      const seen = new Set();
      const out = [];
      for (const cid of ids) {
        const rec = mapping[cid];
        if (!rec) continue;
        const role = rec?.message?.author?.role || "assistant";
        const text = Text.normalize(getRecText(rec));
        const sig = Signature.create(role, text);
        if (!seen.has(sig)) {
          seen.add(sig);
          out.push(cid);
        }
      }
      return out;
    }

    function foldSameRoleChain(startId, mapping, childrenMap) {
      let cur = startId;
      let rec = mapping[cur];
      const role = rec?.message?.author?.role || "assistant";
      let text = getRecText(rec);
      let guard = 0;
      const chainIds = [];
      const chainSigs = [];
      while (rec && guard++ < 4096) {
        const curText = getRecText(rec);
        if (curText) {
          chainIds.push(cur);
          chainSigs.push(Signature.create(role, curText));
        }
        const kids = childrenMap.get(cur) || [];
        if (kids.length !== 1) break;
        const kidId = kids[0];
        const kidRec = mapping[kidId];
        const kidRole = kidRec?.message?.author?.role || "assistant";
        const kidText = getRecText(kidRec);
        if (kidRole === role && kidText && text) {
          text = `${text}\n${kidText}`.trim();
          cur = kidId;
          rec = kidRec;
          continue;
        }
        break;
      }
      return { id: cur, role, text, chainIds, chainSigs };
    }

    function mappingToTree(mapping) {
      const visibleIds = Object.keys(mapping).filter(id => isVisibleRec(mapping[id]));
      const parentMap = new Map();
      for (const vid of visibleIds) {
        parentMap.set(vid, visibleParentId(mapping, vid));
      }
      const childrenMap = new Map(visibleIds.map(id => [id, []]));
      for (const vid of visibleIds) {
        const parentId = parentMap.get(vid);
        if (parentId && childrenMap.has(parentId)) {
          childrenMap.get(parentId).push(vid);
        }
      }
      for (const [pid, arr] of childrenMap.entries()) {
        childrenMap.set(pid, dedupBySig(arr, mapping));
      }
      const roots = visibleIds.filter(id => parentMap.get(id) == null);

      const toNode = (id) => {
        const folded = foldSameRoleChain(id, mapping, childrenMap);
        const currentId = folded.id;
        const currentRole = folded.role;
        const currentText = folded.text;
        const sig = Signature.create(currentRole, currentText);
        const chainIds = folded.chainIds?.length ? folded.chainIds : [currentId];
        const chainSigs = folded.chainSigs?.length ? folded.chainSigs : [sig];
        const children = (childrenMap.get(currentId) || []).map(toNode).filter(Boolean);
        return { id: currentId, role: currentRole, text: currentText, sig, chainIds, chainSigs, children };
      };

      return roots.map(toNode).filter(Boolean);
    }

    function linearToTree(linear) {
      const nodes = [];
      for (let i = 0; i < linear.length; i++) {
        const current = linear[i];
        if (current.role === "user") {
          const next = linear[i + 1];
          const pair = { id: current.id, role: "user", text: current.text, sig: current.sig, children: [] };
          if (next && next.role === "assistant") {
            pair.children.push({ id: next.id, role: "assistant", text: next.text, sig: next.sig, children: [] });
          }
          nodes.push(pair);
        } else {
          nodes.push({ id: current.id, role: "assistant", text: current.text, sig: current.sig, children: [] });
        }
      }
      return nodes;
    }

    function fromMapping() {
      const mapping = Object.fromEntries(TreeState.state.mapping);
      if (!Object.keys(mapping).length) return [];
      return mappingToTree(mapping);
    }

    function fromLinear(linear) {
      return linearToTree(Array.isArray(linear) ? linear : []);
    }

    return { fromMapping, fromLinear };
  })();


  const TreeRenderer = (() => {
    function createItem(node) {
      const item = document.createElement("div");
      item.className = "gtt-node";
      if (node.id) item.dataset.nodeId = node.id;
      if (node.sig) item.dataset.sig = node.sig;
      if (node.chainIds) item._chainIds = node.chainIds;
      if (node.chainSigs) item._chainSigs = node.chainSigs;

      const head = document.createElement("div");
      head.className = "head";
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = node.role === "user" ? "U" : (node.role === "assistant" ? "A" : (node.role || "·"));
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = node.role === "user" ? "用户" : (node.role === "assistant" ? "Asst" : (node.role || "·"));
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = node.children?.length ? `×${node.children.length}` : "";
      head.append(badge, title);
      if (meta.textContent) head.append(meta);

      const pv = document.createElement("span");
      pv.className = "pv";
      const pvLines = Preview.lines(node.text);
      pvLines.forEach((line, idx) => {
        const lineEl = document.createElement("span");
        lineEl.className = "pv-line";
        if (idx >= 2) lineEl.classList.add("pv-line-more");
        lineEl.textContent = line;
        pv.appendChild(lineEl);
      });

      item.append(head, pv);
      item.title = `${node.id || ""}\n\n${node.text || ""}`;
      item.addEventListener("click", () => Navigator.jumpTo(node));
      return item;
    }

    function render(treeData = []) {
      const treeEl = DOM.query("#gtt-tree");
      if (!treeEl) return;
      treeEl.innerHTML = "";
      Panel.updateTreeHeight(true);

      const fragment = document.createDocumentFragment();
      const root = document.createElement("div");
      fragment.appendChild(root);
      const stats = { total: 0 };
      const queue = [];
      const pushList = (nodes, parent) => { if (Array.isArray(nodes)) { for (const node of nodes) queue.push({ node, parent }); } };
      pushList(treeData, root);

      const step = () => {
        let count = 0;
        while (count < Config.RENDER_CHUNK && queue.length) {
          const { node, parent } = queue.shift();
          const item = createItem(node);
          parent.appendChild(item);
          stats.total++;
          if (node.children?.length) {
            const kids = document.createElement("div");
            kids.className = "gtt-children";
            parent.appendChild(kids);
            pushList(node.children, kids);
          }
          count++;
        }
        if (queue.length) {
          Timing.rafIdle(step);
        } else {
          treeEl.appendChild(fragment);
          Panel.updateStats(stats.total);
          BranchHighlighter.apply(treeEl);
          Panel.updateTreeHeight();
        }
      };

      step();
    }

    return { render };
  })();

  /** *********************************************************************
   * 观察与生命周期
   ********************************************************************* */

  const Observer = (() => {
    let mutationObserver = null;
    let currentConversationId = null;

    function collectLinearNodes() {
      const blocks = DOM.queryAll(Config.SELECTORS.messageBlocks);
      const records = [];
      const ids = new Set();
      const sigs = new Set();
      TreeState.state.domById.clear();
      TreeState.state.domBySig.clear();

      for (const el of blocks) {
        const textEl = DOM.query(Config.SELECTORS.messageText, el) || el;
        const raw = (textEl?.innerText || textEl?.textContent || "").trim();
        const text = Text.normalize(raw);
        if (!text) continue;
        let role = el.getAttribute("data-message-author-role") || el.dataset?.messageAuthorRole;
        if (!role) role = el.querySelector(".markdown,.prose") ? "assistant" : "user";
        const messageId = el.getAttribute("data-message-id") || el.dataset?.messageId || (el.id?.startsWith("conversation-turn-") ? el.id.replace("conversation-turn-", "") : null);
        const id = messageId || `lin-${Hash.of(text.slice(0, 80))}`;
        const sig = Signature.create(role, text);
        records.push({ id, role, text, sig });
        if (messageId) TreeState.state.domById.set(messageId, el);
        TreeState.state.domBySig.set(sig, el);
        ids.add(id);
        sigs.add(sig);
      }

      const leaf = records[records.length - 1];
      TreeState.updateCurrentBranch({
        ids,
        sigs,
        leafId: leaf?.id || null,
        leafSig: leaf?.sig || null,
      });
      TreeState.state.linearNodes = records;
      return records;
    }

    function observeMessages() {
      const linear = collectLinearNodes();
      BranchHighlighter.apply();
      return linear;
    }

    function handleDomChange() {
      observeMessages();
      Lifecycle.scheduleRebuild({ reason: "dom-change" });
    }

    function bindMutation() {
      const root = document.body;
      if (!root) return;
      if (mutationObserver) mutationObserver.disconnect();
      mutationObserver = new MutationObserver(Timing.debounce(handleDomChange, Config.OBS_DEBOUNCE_MS));
      mutationObserver.observe(root, { childList: true, subtree: true });
    }

    function ensureConversationWatcher() {
      const cid = LocationHelper.getConversationId();
      if (!cid || cid === currentConversationId) return;
      currentConversationId = cid;
      Lifecycle.rebuild({ forceFetch: true, hard: true, reason: "route-watch" });
    }

    return { observeMessages, bindMutation, ensureConversationWatcher };
  })();

  /** *********************************************************************
   * 生命周期控制
   ********************************************************************* */

  const Lifecycle = (() => {
    let rebuildTimer = null;

    async function fetchMapping(conversationId) {
      if (!conversationId) return null;
      await Auth.ensureAuth();
      const endpoints = Config.ENDPOINTS(conversationId).get;
      for (const endpoint of endpoints) {
        try {
          const res = await Auth.origFetch(endpoint, { credentials: "include", headers: Auth.withHeaders() });
          if (!res.ok) continue;
          const json = await res.json();
          if (json?.mapping) return json.mapping;
        } catch (_) {
          /* ignore network errors */
        }
      }
      return null;
    }

    function scheduleRebuild({ delay = 120, reason = "" } = {}) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => rebuild({ reason }), delay);
    }

    async function rebuild({ forceFetch = false, hard = false, reason = "" } = {}) {
      try {
        Panel.ensure();
        Panel.applyPosition();

        const conversationId = LocationHelper.getConversationId();
        if (!conversationId) return;

        if (hard) {
          TreeState.reset();
          Panel.updateStats(0);
          const treeEl = DOM.query("#gtt-tree");
          if (treeEl) treeEl.innerHTML = "";
        }

        const linearNodes = Observer.observeMessages();

        if (forceFetch || !TreeState.state.mapping.size) {
          const mapping = await fetchMapping(conversationId);
          if (mapping) {
            TreeState.setMapping(mapping);
          }
        }

        let treeData = [];
        if (TreeState.state.mapping.size) {
          treeData = TreeBuilder.fromMapping();
        } else if (linearNodes?.length) {
          treeData = TreeBuilder.fromLinear(linearNodes);
        } else if (TreeState.state.linearNodes.length) {
          treeData = TreeBuilder.fromLinear(TreeState.state.linearNodes);
        }

        TreeRenderer.render(treeData);
      } catch (err) {
        console.error("GPT Tree rebuild failed", err, reason);
      }
    }

    return { rebuild, scheduleRebuild };
  })();

  /** *********************************************************************
   * 路由监听
   ********************************************************************* */
  const Router = (() => {
    function bind(onChange) {
      if (typeof history === "undefined") return;
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      const fire = () => window.dispatchEvent(new Event("gtt:locationchange"));
      history.pushState = function (...args) {
        const result = origPush.apply(this, args);
        fire();
        return result;
      };
      history.replaceState = function (...args) {
        const result = origReplace.apply(this, args);
        fire();
        return result;
      };
      window.addEventListener("popstate", fire);
      window.addEventListener("gtt:locationchange", onChange);
    }

    return { bind };
  })();

  /** *********************************************************************
   * 键盘快捷键
   ********************************************************************* */
  const Keyboard = (() => {
    function handleKeydown(e) {
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyT") {
        e.preventDefault();
        const hidden = Prefs.get("hidden");
        Panel.setHidden(!hidden);
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const search = DOM.query("#gtt-search");
        if (search) {
          e.preventDefault();
          search.focus();
          search.select();
        }
      }
      if (e.key === "Escape") {
        const modal = DOM.query("#gtt-modal");
        if (modal?.style.display === "flex") {
          e.preventDefault();
          Modal.close();
          return;
        }
        const search = DOM.query("#gtt-search");
        if (document.activeElement === search) {
          e.preventDefault();
          search.blur();
          search.value = "";
          search.dispatchEvent(new Event("input"));
        }
      }
    }

    function bind() {
      document.addEventListener("keydown", handleKeydown, true);
    }

    return { bind };
  })();

  /** *********************************************************************
   * 初始化
   ********************************************************************* */
  function bootstrap() {
    Panel.ensure();
    Keyboard.bind();
    Observer.bindMutation();
    Router.bind(() => Lifecycle.rebuild({ forceFetch: true, hard: true, reason: "route-change" }));
    Auth.patch((mapping) => {
      TreeState.setMapping(mapping);
      Lifecycle.scheduleRebuild({ reason: "fetch-patch" });
    });
    Lifecycle.rebuild({ forceFetch: true, hard: true, reason: "init" });
    setInterval(() => Observer.ensureConversationWatcher(), 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
