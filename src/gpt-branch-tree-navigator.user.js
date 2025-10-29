// ==UserScript==
// @name         GPT Branch Tree Navigator (Preview + Jump)
// @namespace    jiaoling.tools.gpt.tree
// @version      1.5.0
// @description  树状分支 + 预览 + 一键跳转；支持最小化/隐藏与悬浮按钮恢复；快捷键 Alt+T / Alt+M；/ 聚焦搜索、Esc 关闭；拖拽移动面板；渐进式渲染；Markdown 预览；防抖监听；模块化重构。
// @author       Jiaoling
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  /** ================= 配置 ================= **/
  const CONFIG = {
    PANEL_WIDTH: 360,
    PREVIEW_MAX_CHARS: 200,
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
        'main [data-testid^="conversation-turn"]',
        "main .group.w-full",
        "main [data-message-id]"
      ].join(","),
      messageText: [
        ".markdown",
        ".prose",
        "[data-message-author-role] .whitespace-pre-wrap",
        "[data-message-author-role]"
      ].join(","),
    },
    ENDPOINTS: (cid) => ({
      get: [
        `/backend-api/conversation/${cid}`,
        `/backend-api/conversation/${cid}/`,
      ]
    })
  };

  /** ================= 时间工具 ================= **/
  const Timing = createTimingTools(CONFIG);

  /** ================= DOM 工具 ================= **/
  const Dom = createDomTools(CONFIG);

  /** ================= 文本 & Markdown ================= **/
  const Text = createTextTools(CONFIG);

  /** ================= 首屏样式 ================= **/
  Dom.injectStyle(`
    :root{--gtt-cur:#fa8c16;}
    #gtt-panel{
      position:fixed;top:64px;right:12px;z-index:999999;width:${CONFIG.PANEL_WIDTH}px;
      max-height:calc(100vh - 84px);display:flex;flex-direction:column;overflow:hidden;
      border-radius:12px;border:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-bg,#fff);
      box-shadow:0 8px 28px rgba(0,0,0,.18);font:13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial;
      user-select:none
    }
    #gtt-header{display:flex;gap:8px;align-items:center;padding:10px;border-bottom:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-hd,#f6f8fa)}
    #gtt-header .title{font-weight:700;flex:1;cursor:move}
    #gtt-header .btn{border:1px solid var(--gtt-bd,#d0d7de);background:#fff;cursor:pointer;padding:4px 8px;border-radius:8px;font-size:12px}
    #gtt-body{display:flex;flex-direction:column;min-height:0}
    #gtt-search{margin:8px 10px;padding:6px 8px;border:1px solid var(--gtt-bd,#d0d7de);border-radius:8px;width:calc(100% - 20px);outline:none;background:var(--gtt-bg,#fff)}
    #gtt-pref{display:flex;gap:10px;align-items:center;padding:0 10px 8px;color:#555;flex-wrap:wrap}
    #gtt-tree{overflow:auto;padding:8px 6px 10px}
    .gtt-node{padding:6px 6px 6px 8px;border-radius:8px;margin:2px 0;cursor:pointer;position:relative}
    .gtt-node:hover{background:rgba(127,127,255,.08)}
    .gtt-node .badge{display:inline-block;font-size:10px;padding:2px 6px;border-radius:999px;border:1px solid var(--gtt-bd,#d0d7de);margin-right:6px;opacity:.75}
    .gtt-node .meta{opacity:.7;font-size:11px;margin-left:6px}
    .gtt-node .pv{display:inline-block;opacity:.9;margin-left:6px;white-space:nowrap;max-width:calc(100% - 90px);overflow:hidden;text-overflow:ellipsis}
    .gtt-children{margin-left:14px;border-left:1px dashed var(--gtt-bd,#d0d7de);padding-left:8px}
    .gtt-hidden{display:none!important}
    .gtt-highlight{outline:3px solid rgba(88,101,242,.65)!important;transition:outline-color .6s ease}
    .gtt-node.gtt-current{background:rgba(250,140,22,.12);border-left:2px solid var(--gtt-cur,#fa8c16);padding-left:10px}
    .gtt-node.gtt-current .badge{border-color:var(--gtt-cur,#fa8c16);color:var(--gtt-cur,#fa8c16);opacity:1}
    .gtt-node.gtt-current-leaf{box-shadow:0 0 0 2px rgba(250,140,22,.24) inset}
    .gtt-children.gtt-current-line{border-left:2px dashed var(--gtt-cur,#fa8c16)}

    #gtt-panel.gtt-min #gtt-body{display:none}

    #gtt-modal{position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,.42);display:none;align-items:center;justify-content:center}
    #gtt-modal .card{max-width:880px;max-height:80vh;overflow:auto;background:var(--gtt-bg,#fff);border:1px solid var(--gtt-bd,#d0d7de);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25)}
    #gtt-modal .hd{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-hd,#f6f8fa)}
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

  /** ================= 偏好存储 ================= **/
  const Prefs = createPrefStore(CONFIG);

  /** ================= 模态控制 ================= **/
  const Modal = createModalController({ dom: Dom, markdown: Text.renderMarkdownLite });

  /** ================= 分支跟踪 ================= **/
  const Branch = createBranchTracker({ config: CONFIG, dom: Dom, text: Text });

  /** ================= 节点跳转 ================= **/
  const Navigator = createNavigator({ config: CONFIG, dom: Dom, text: Text, branch: Branch, modal: Modal });

  /** ================= 树渲染 ================= **/
  const Tree = createTreeRenderer({ config: CONFIG, dom: Dom, text: Text, branch: Branch, navigator: Navigator, timing: Timing });

  /** ================= 面板控制 ================= **/
  const Panel = createPanelController({
    dom: Dom,
    prefs: Prefs,
    modal: Modal,
    timing: Timing,
    onRefresh: () => rebuildTree({ forceFetch: true, hard: true }),
    onCollapse: () => Tree.toggleCollapseAll()
  });

  /** ================= 鉴权与网络 ================= **/
  const Auth = createAuthManager();
  const Data = createDataService({ config: CONFIG, auth: Auth });

  let lastMapping = null;

  Auth.onMapping((mapping) => {
    if (!mapping) return;
    lastMapping = mapping;
    Panel.ensureFab();
    Panel.ensurePanel();
    Tree.buildTreeFromMapping(mapping);
  });

  /** ================= 监听 & 启动 ================= **/
  const observer = new MutationObserver(Timing.debounce(() => {
    Branch.harvestLinearNodes();
  }, CONFIG.OBS_DEBOUNCE_MS));

  hookHistory();

  let locationGuard = location.pathname;
  const onLocationChange = async () => {
    if (location.pathname === locationGuard) return;
    locationGuard = location.pathname;
    await rebuildTree({ forceFetch: true, hard: true });
  };
  window.addEventListener("gtt:locationchange", onLocationChange);
  window.addEventListener("popstate", onLocationChange);

  document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      Panel.setHidden(!Prefs.get().hidden);
    }
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      Panel.setMinimized(!Prefs.get().minimized);
    }
  });

  function boot() {
    Panel.ensureFab();
    Panel.ensurePanel();
    rebuildTree();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const wait = setInterval(() => {
    if (document.querySelector("main")) {
      clearInterval(wait);
      boot();
    }
  }, 300);

  /** ================= 主流程 ================= **/
  async function rebuildTree(opts = {}) {
    Panel.ensureFab();
    Panel.ensurePanel();
    if (opts.hard) {
      lastMapping = null;
    }
    const linearNodes = Branch.harvestLinearNodes();
    if (opts.forceFetch || !lastMapping) {
      lastMapping = await Data.fetchMapping();
    }
    if (lastMapping) {
      Tree.buildTreeFromMapping(lastMapping);
    } else {
      Tree.buildTreeFromLinear(linearNodes);
    }
  }

  /** ================= 工具模块实现 ================= **/
  function createTimingTools(config) {
    const debounce = (fn, ms) => {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
      };
    };
    const rafIdle = (fn, ms = config.RENDER_IDLE_MS) => setTimeout(fn, ms);
    return { debounce, rafIdle };
  }

  function createDomTools(config) {
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

    const injectStyle = (css) => {
      try {
        GM_addStyle(css);
      } catch (_) {
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);
      }
    };

    const SCROLLABLE_VALUES = new Set(["auto", "scroll", "overlay"]);
    const findScrollContainer = (el) => {
      const rootSel = config.SELECTORS?.scrollRoot;
      if (rootSel) {
        const root = document.querySelector(rootSel);
        if (root && root.contains(el) && root.scrollHeight > root.clientHeight + 8) {
          return root;
        }
      }
      let cur = el?.parentElement;
      while (cur && cur !== document.body) {
        const style = getComputedStyle(cur);
        if ((SCROLLABLE_VALUES.has(style.overflowY) || SCROLLABLE_VALUES.has(style.overflow)) && cur.scrollHeight > cur.clientHeight + 8) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };

    const scrollToEl = (el) => {
      if (!el) return;
      const container = findScrollContainer(el);
      if (container && container !== document.body && container !== document.documentElement) {
        const rect = el.getBoundingClientRect();
        const parentRect = container.getBoundingClientRect();
        const offset = rect.top - parentRect.top + container.scrollTop - config.SCROLL_OFFSET;
        container.scrollTo({ top: offset, behavior: "smooth" });
      } else {
        const offset = el.getBoundingClientRect().top + window.scrollY - config.SCROLL_OFFSET;
        window.scrollTo({ top: offset, behavior: "smooth" });
      }
      el.classList.add("gtt-highlight");
      setTimeout(() => el.classList.remove("gtt-highlight"), config.HIGHLIGHT_MS);
    };

    return { $, $$, injectStyle, scrollToEl };
  }

  function createTextTools(config) {
    const hash = (s) => {
      let h = 0;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      }
      return (h >>> 0).toString(36);
    };
    const normalize = (s) => (s || "").replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
    const normalizeForPreview = (s) => (s || "").replace(/\u200b/g, "").replace(/\r\n?/g, "\n");

    const HTML_ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    const escapeHtml = (str = "") => str.replace(/[&<>"']/g, (ch) => HTML_ESC[ch] || ch);
    const escapeAttr = (str = "") => escapeHtml(str).replace(/`/g, "&#96;");

    const formatInline = (txt = "") => {
      let out = escapeHtml(txt);
      out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
      out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`);
      const codeHolders = [];
      out = out.replace(/<code>[^<]*<\/code>/g, (match) => {
        codeHolders.push(match);
        return `\uFFF0${codeHolders.length - 1}\uFFF1`;
      });
      out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      out = out.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
      out = out.replace(/(\s|^)\*([^*\n]+)\*(?=\s|[\.,!?:;\)\]\}“”"'`]|$)/g, (_m, pre, body) => `${pre}<em>${body}</em>`);
      out = out.replace(/(\s|^)_([^_\n]+)_(?=\s|[\.,!?:;\)\]\}“”"'`]|$)/g, (_m, pre, body) => `${pre}<em>${body}</em>`);
      out = out.replace(/\uFFF0(\d+)\uFFF1/g, (_m, idx) => codeHolders[Number(idx)]);
      return out;
    };

    const renderMarkdownLite = (raw = "") => {
      const text = normalizeForPreview(raw || "").trimEnd();
      if (!text) return "<p>(空)</p>";
      const lines = text.split("\n");
      let html = "";
      let inList = false;
      let codeBuffer = null;
      let codeLang = "";

      const flushList = () => {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
      };
      const flushCode = () => {
        if (codeBuffer) {
          const cls = codeLang ? ` class="lang-${escapeAttr(codeLang)}"` : "";
          const body = codeBuffer.map(escapeHtml).join("\n");
          html += `<pre><code${cls}>${body}</code></pre>`;
          codeBuffer = null;
          codeLang = "";
        }
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
          html += `<h${level}>${formatInline(heading[2])}</h${level}>`;
          continue;
        }
        const listItem = line.match(/^\s*[-*+]\s+(.*)$/);
        if (listItem) {
          if (!inList) {
            html += "<ul>";
            inList = true;
          }
          html += `<li>${formatInline(listItem[1])}</li>`;
          continue;
        }
        flushList();
        html += `<p>${formatInline(line)}</p>`;
      }
      flushCode();
      flushList();
      return html;
    };

    const makeSig = (role, text) => (role || "assistant") + "|" + hash(normalize(text).slice(0, config.SIG_TEXT_LEN));
    const preview = (t, n = config.PREVIEW_MAX_CHARS) => {
      const s = normalize(t);
      return s.length > n ? s.slice(0, n) + "…" : s;
    };

    return { hash, normalize, normalizeForPreview, escapeHtml, escapeAttr, formatInline, renderMarkdownLite, makeSig, preview };
  }

  function createPrefStore(config) {
    const defaults = { minimized: false, hidden: false, pos: null };
    let state = load();

    function load() {
      try {
        const raw = localStorage.getItem(config.LS_KEY) || localStorage.getItem("gtt_prefs_v2");
        const obj = raw ? JSON.parse(raw) : {};
        return { ...defaults, ...obj };
      } catch {
        return { ...defaults };
      }
    }

    function save() {
      try {
        localStorage.setItem(config.LS_KEY, JSON.stringify(state));
      } catch {
        /* ignore */
      }
    }

    function get() {
      return { ...state };
    }

    function setMinimized(value, { silent = false } = {}) {
      state = { ...state, minimized: !!value };
      if (!silent) save();
    }

    function setHidden(value, { silent = false } = {}) {
      state = { ...state, hidden: !!value };
      if (!silent) save();
    }

    function setPosition(pos, { silent = false } = {}) {
      const next = pos ? { left: Math.round(pos.left), top: Math.round(pos.top) } : null;
      state = { ...state, pos: next };
      if (!silent) save();
    }

    return { get, setMinimized, setHidden, setPosition };
  }

  function createModalController({ dom, markdown }) {
    const open = (text, title) => {
      const body = dom.$("#gtt-md-body");
      const modal = dom.$("#gtt-modal");
      const titleEl = dom.$("#gtt-md-title");
      if (!body || !modal || !titleEl) return;
      body.innerHTML = markdown(text);
      titleEl.textContent = title || "节点预览（未能定位到页面元素，已为你展示文本）";
      modal.style.display = "flex";
    };

    const close = () => {
      const modal = dom.$("#gtt-modal");
      const body = dom.$("#gtt-md-body");
      if (modal) modal.style.display = "none";
      if (body) body.innerHTML = "";
    };

    return { open, close };
  }

  function createBranchTracker({ config, dom, text }) {
    let domBySig = new Map();
    let domById = new Map();
    let currentIds = new Set();
    let currentSigs = new Set();
    let leafId = null;
    let leafSig = null;

    const harvestLinearNodes = () => {
      const blocks = dom.$$(config.SELECTORS.messageBlocks);
      const nodes = [];
      const ids = new Set();
      const sigs = new Set();
      domBySig = new Map();
      domById = new Map();

      for (const el of blocks) {
        const textEl = dom.$(config.SELECTORS.messageText, el) || el;
        const raw = (textEl?.innerText || "").trim();
        const normalized = text.normalize(raw);
        if (!normalized) continue;
        let role = el.getAttribute("data-message-author-role");
        if (!role) role = el.querySelector(".markdown,.prose") ? "assistant" : "user";
        const messageId = el.getAttribute("data-message-id") || el.dataset?.messageId || dom.$("[data-message-id]", el)?.getAttribute("data-message-id") || (el.id?.startsWith("conversation-turn-") ? el.id.split("conversation-turn-")[1] : null);
        const id = messageId ? messageId : ("lin-" + text.hash(normalized.slice(0, 80)));
        const sig = text.makeSig(role, normalized);
        nodes.push({ id, role, text: normalized, sig, _el: el });
        domBySig.set(sig, el);
        ids.add(id);
        sigs.add(sig);
        if (messageId) domById.set(messageId, el);
      }

      currentIds = ids;
      currentSigs = sigs;
      if (nodes.length) {
        const leaf = nodes[nodes.length - 1];
        leafId = leaf?.id || null;
        leafSig = leaf?.sig || null;
      } else {
        leafId = null;
        leafSig = null;
      }

      applyHighlight();
      return nodes;
    };

    const applyHighlight = (rootEl) => {
      const treeRoot = rootEl || dom.$("#gtt-tree");
      if (!treeRoot) return;
      const nodeEls = treeRoot.querySelectorAll(".gtt-node");
      const connectorEls = treeRoot.querySelectorAll(".gtt-children");
      nodeEls.forEach((el) => el.classList.remove("gtt-current", "gtt-current-leaf"));
      connectorEls.forEach((el) => el.classList.remove("gtt-current-line"));

      const hasBranch = (currentIds?.size || 0) > 0 || (currentSigs?.size || 0) > 0;
      if (!hasBranch) return;

      nodeEls.forEach((el) => {
        const id = el.dataset?.nodeId;
        const sig = el.dataset?.sig;
        const chainIds = Array.isArray(el._chainIds) ? el._chainIds : null;
        const chainSigs = Array.isArray(el._chainSigs) ? el._chainSigs : null;
        const matchesId = id && currentIds.has(id);
        const matchesSig = sig && currentSigs.has(sig);
        const matchesChainId = chainIds ? chainIds.some((cid) => currentIds.has(cid)) : false;
        const matchesChainSig = chainSigs ? chainSigs.some((cs) => currentSigs.has(cs)) : false;
        const isCurrent = matchesId || matchesSig || matchesChainId || matchesChainSig;
        if (!isCurrent) return;
        el.classList.add("gtt-current");
        const isLeaf = (
          (leafId && (id === leafId || (chainIds && chainIds.includes(leafId)))) ||
          (leafSig && (sig === leafSig || (chainSigs && chainSigs.includes(leafSig))))
        );
        if (isLeaf) {
          el.classList.add("gtt-current-leaf");
        }
        const parent = el.parentElement;
        if (parent?.classList?.contains("gtt-children")) {
          parent.classList.add("gtt-current-line");
        }
      });
    };

    const getDomById = (id) => {
      const el = domById.get(id);
      return el && el.isConnected ? el : null;
    };

    const getDomBySig = (sig) => {
      const el = domBySig.get(sig);
      return el && el.isConnected ? el : null;
    };

    return { harvestLinearNodes, applyHighlight, getDomById, getDomBySig };
  }

  function createNavigator({ config, dom, text, branch, modal }) {
    const locateByText = (rawText) => {
      const snippet = text.normalize(rawText).slice(0, 120);
      if (!snippet) return null;
      const blocks = dom.$$(config.SELECTORS.messageBlocks);
      let best = null;
      let score = -1;
      for (const el of blocks) {
        const textEl = dom.$(config.SELECTORS.messageText, el) || el;
        const normalized = text.normalize(textEl?.innerText || "");
        const idx = normalized.indexOf(snippet);
        if (idx >= 0) {
          const sc = 3000 - idx + Math.min(120, snippet.length);
          if (sc > score) {
            score = sc;
            best = el;
          }
        }
      }
      return best;
    };

    const jumpTo = (node) => {
      const direct = branch.getDomById(node.id);
      if (direct) {
        dom.scrollToEl(direct);
        return;
      }

      const sig = node.sig || text.makeSig(node.role, node.text);
      const bySig = branch.getDomBySig(sig);
      if (bySig) {
        dom.scrollToEl(bySig);
        return;
      }

      const fallback = locateByText(node.text);
      if (fallback) {
        dom.scrollToEl(fallback);
        return;
      }

      modal.open(node.text || "(无文本)");
    };

    return { jumpTo };
  }

  function createTreeRenderer({ config, dom, text, branch, navigator, timing }) {
    const getRecText = (rec) => {
      const parts = rec?.message?.content?.parts ?? [];
      if (Array.isArray(parts)) return parts.join("\n");
      if (typeof parts === "string") return parts;
      return "";
    };
    const isToolishRole = (role) => role === "tool" || role === "system" || role === "function";
    const isVisibleRec = (rec) => {
      if (!rec) return false;
      const role = rec?.message?.author?.role || "assistant";
      if (isToolishRole(role)) return false;
      const textContent = getRecText(rec);
      return !!text.normalize(textContent);
    };
    const visibleParentId = (mapping, id) => {
      let cur = id;
      let guard = 0;
      while (guard++ < 4096) {
        const p = mapping[cur]?.parent;
        if (p == null) return null;
        const parentRec = mapping[p];
        if (isVisibleRec(parentRec)) return p;
        cur = p;
      }
      return null;
    };
    const dedupBySig = (ids, mapping) => {
      const seen = new Set();
      const out = [];
      for (const cid of ids) {
        const rec = mapping[cid];
        if (!rec) continue;
        const role = rec?.message?.author?.role || "assistant";
        const textContent = text.normalize(getRecText(rec));
        const sig = text.makeSig(role, textContent);
        if (!seen.has(sig)) {
          seen.add(sig);
          out.push(cid);
        }
      }
      return out;
    };

    const updateStats = (total) => {
      const el = dom.$("#gtt-stats");
      if (el) el.textContent = total ? `节点：${total}` : "";
    };

    const renderTreeGradually = (targetEl, treeData) => {
      if (!targetEl) return;
      targetEl.innerHTML = "";
      const stats = { total: 0 };
      const fragment = document.createDocumentFragment();
      const queue = [];
      const pushList = (nodes, parent) => {
        for (const node of nodes) {
          queue.push({ node, parent });
        }
      };

      const createItem = (node) => {
        const item = document.createElement("div");
        item.className = "gtt-node";
        item.dataset.nodeId = node.id;
        item.dataset.sig = node.sig;
        item.title = `${node.id}\n\n${node.text || ""}`;
        if (node.chainIds) item._chainIds = node.chainIds;
        if (node.chainSigs) item._chainSigs = node.chainSigs;
        const badge = document.createElement("span");
        badge.className = "badge";
        badge.textContent = node.role === "user" ? "U" : (node.role || "·");
        const title = document.createElement("span");
        title.textContent = node.role === "user" ? "用户" : "助手";
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = node.children?.length ? `(${node.children.length})` : "";
        const pv = document.createElement("span");
        pv.className = "pv";
        pv.textContent = text.preview(node.text);
        item.append(badge, title, meta, pv);
        item.addEventListener("click", () => navigator.jumpTo(node));
        return item;
      };

      const rootDiv = document.createElement("div");
      fragment.appendChild(rootDiv);
      pushList(treeData, rootDiv);

      const step = () => {
        let processed = 0;
        while (processed < config.RENDER_CHUNK && queue.length) {
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
          processed++;
        }
        if (queue.length) {
          timing.rafIdle(step);
        } else {
          targetEl.appendChild(fragment);
          updateStats(stats.total);
          branch.applyHighlight(targetEl);
        }
      };
      step();
    };

    const buildTreeFromMapping = (mapping) => {
      const treeEl = dom.$("#gtt-tree");
      if (!treeEl) return;
      const byId = mapping;
      const visibleIds = Object.keys(byId).filter((id) => isVisibleRec(byId[id]));
      const parentMap = new Map();
      visibleIds.forEach((vid) => parentMap.set(vid, visibleParentId(byId, vid)));
      const childrenMap = new Map(visibleIds.map((id) => [id, []]));
      visibleIds.forEach((vid) => {
        const parentId = parentMap.get(vid);
        if (parentId && childrenMap.has(parentId)) {
          childrenMap.get(parentId).push(vid);
        }
      });
      for (const [pid, arr] of childrenMap.entries()) {
        childrenMap.set(pid, dedupBySig(arr, byId));
      }
      const roots = visibleIds.filter((id) => parentMap.get(id) == null);

      const foldSameRoleChain = (startId) => {
        let currentId = startId;
        let rec = byId[currentId];
        const role = rec?.message?.author?.role || "assistant";
        let textContent = getRecText(rec);
        let guard = 0;
        const chainIds = [];
        const chainSigs = [];
        while (rec && guard++ < 4096) {
          const curText = getRecText(rec);
          if (curText) {
            chainIds.push(currentId);
            chainSigs.push(text.makeSig(role, curText));
          }
          const kids = childrenMap.get(currentId) || [];
          if (kids.length !== 1) break;
          const kidId = kids[0];
          const kidRec = byId[kidId];
          const kidRole = kidRec?.message?.author?.role || "assistant";
          const kidText = getRecText(kidRec);
          if (kidRole === role && kidText && textContent) {
            textContent = (textContent + "\n" + kidText).trim();
            currentId = kidId;
            rec = kidRec;
            continue;
          }
          break;
        }
        return { id: currentId, role, text: textContent, chainIds, chainSigs };
      };

      const toNode = (id) => {
        const folded = foldSameRoleChain(id);
        const nodeId = folded.id;
        const role = folded.role;
        const nodeText = folded.text;
        const childIds = childrenMap.get(nodeId) || [];
        const children = childIds.map(toNode).filter(Boolean);
        const sig = text.makeSig(role, nodeText);
        const chainIds = folded.chainIds.length ? folded.chainIds : [nodeId];
        const chainSigs = folded.chainSigs.length ? folded.chainSigs : [sig];
        return { id: nodeId, role, text: nodeText, sig, chainIds, chainSigs, children };
      };

      const tree = roots.map(toNode).filter(Boolean);
      renderTreeGradually(treeEl, tree);
    };

    const buildTreeFromLinear = (linear) => {
      const treeEl = dom.$("#gtt-tree");
      if (!treeEl) return;
      const nodes = [];
      for (let i = 0; i < linear.length; i++) {
        const cur = linear[i];
        if (cur.role === "user") {
          const pair = { id: cur.id, role: "user", text: cur.text, sig: cur.sig, children: [] };
          const nxt = linear[i + 1];
          if (nxt && nxt.role === "assistant") {
            pair.children.push({ id: nxt.id, role: "assistant", text: nxt.text, sig: nxt.sig, children: [] });
          }
          nodes.push(pair);
        } else {
          nodes.push({ id: cur.id, role: "assistant", text: cur.text, sig: cur.sig, children: [] });
        }
      }
      renderTreeGradually(treeEl, nodes);
    };

    const toggleCollapseAll = () => {
      dom.$$(".gtt-children").forEach((el) => el.classList.toggle("gtt-hidden"));
    };

    return { buildTreeFromMapping, buildTreeFromLinear, toggleCollapseAll };
  }

  function createPanelController({ dom, prefs, modal, timing, onRefresh, onCollapse }) {
    let panelBound = false;
    let keyboardBound = false;

    const ensureFab = () => {
      if (dom.$("#gtt-fab")) return;
      const fab = document.createElement("div");
      fab.id = "gtt-fab";
      fab.innerHTML = `<span class="dot"></span><span class="txt">GPT Tree</span>`;
      fab.addEventListener("click", () => setHidden(false));
      document.body.appendChild(fab);
    };

    const applyPositionFromPrefs = () => {
      const state = prefs.get();
      const panel = dom.$("#gtt-panel");
      if (!panel) return;
      if (state.pos) {
        panel.style.left = state.pos.left + "px";
        panel.style.top = state.pos.top + "px";
        panel.style.right = "auto";
      }
    };

    const applyHiddenState = (value) => {
      const panel = dom.$("#gtt-panel");
      const fab = dom.$("#gtt-fab");
      if (!panel || !fab) return;
      if (value) {
        panel.style.display = "none";
        fab.style.display = "inline-flex";
      } else {
        panel.style.display = "flex";
        fab.style.display = "none";
      }
    };

    const applyMinimizedState = (value) => {
      const panel = dom.$("#gtt-panel");
      const btn = dom.$("#gtt-btn-min");
      if (!panel || !btn) return;
      panel.classList.toggle("gtt-min", !!value);
      btn.textContent = value ? "还原" : "最小化";
    };

    const setHidden = (value, { silent = false } = {}) => {
      ensureFab();
      ensurePanel();
      applyHiddenState(value);
      prefs.setHidden(value, { silent });
    };

    const setMinimized = (value, { silent = false } = {}) => {
      ensurePanel();
      applyMinimizedState(value);
      prefs.setMinimized(value, { silent });
    };

    const enableDrag = (panel, handle) => {
      let dragging = false;
      let sx = 0;
      let sy = 0;
      let sl = 0;
      let st = 0;
      handle.addEventListener("mousedown", (e) => {
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        const rect = panel.getBoundingClientRect();
        sl = rect.left;
        st = rect.top;
        panel.style.right = "auto";
        const onMove = (ev) => {
          if (!dragging) return;
          const l = sl + (ev.clientX - sx);
          const t = st + (ev.clientY - sy);
          panel.style.left = Math.max(8, l) + "px";
          panel.style.top = Math.max(8, t) + "px";
        };
        const onUp = () => {
          dragging = false;
          document.removeEventListener("mousemove", onMove);
          const rect = panel.getBoundingClientRect();
          prefs.setPosition({ left: rect.left, top: rect.top });
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp, { once: true });
      });
    };

    const ensurePanel = () => {
      if (panelBound) return;
      if (dom.$("#gtt-panel")) {
        panelBound = true;
      } else {
        const panel = document.createElement("div");
        panel.id = "gtt-panel";
        panel.innerHTML = `
          <div id="gtt-header">
            <div class="title" id="gtt-drag">GPT Tree</div>
            <button class="btn" id="gtt-btn-min" title="最小化/还原（Alt+M）">最小化</button>
            <button class="btn" id="gtt-btn-refresh">刷新</button>
            <button class="btn" id="gtt-btn-collapse">折叠</button>
            <button class="btn" id="gtt-btn-hide" title="隐藏（Alt+T）">隐藏</button>
          </div>
          <div id="gtt-body">
            <input id="gtt-search" placeholder="搜索节点（文本/角色）… / 聚焦，Esc 清除">
            <div id="gtt-pref">
              <span style="opacity:.65" id="gtt-stats"></span>
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
        panelBound = true;
      }

      const panelEl = dom.$("#gtt-panel");
      if (!panelEl) return;

      dom.$("#gtt-btn-min")?.addEventListener("click", () => setMinimized(!prefs.get().minimized));
      dom.$("#gtt-btn-hide")?.addEventListener("click", () => setHidden(true));
      dom.$("#gtt-btn-refresh")?.addEventListener("click", () => onRefresh());
      dom.$("#gtt-btn-collapse")?.addEventListener("click", () => onCollapse());
      dom.$("#gtt-md-close")?.addEventListener("click", () => modal.close());

      const inputSearch = dom.$("#gtt-search");
      if (inputSearch) {
        const onSearch = timing.debounce((val) => {
          const query = (typeof val === "string" ? val : inputSearch.value).trim().toLowerCase();
          dom.$$("#gtt-tree .gtt-node").forEach((node) => {
            node.style.display = node.textContent.toLowerCase().includes(query) ? "" : "none";
          });
        }, 120);
        inputSearch.addEventListener("input", (e) => onSearch(e.target.value));
      }

      dom.$("#gtt-header")?.addEventListener("dblclick", () => setMinimized(!prefs.get().minimized));
      const dragHandle = dom.$("#gtt-drag");
      if (dragHandle) enableDrag(panelEl, dragHandle);

      const state = prefs.get();
      applyMinimizedState(state.minimized);
      applyHiddenState(state.hidden);
      applyPositionFromPrefs();

      if (!keyboardBound) {
        keyboardBound = true;
        document.addEventListener("keydown", (e) => {
          if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
            const search = dom.$("#gtt-search");
            if (search) {
              e.preventDefault();
              search.focus();
            }
          }
          if (e.key === "Escape") {
            if (dom.$("#gtt-modal")?.style.display === "flex") {
              modal.close();
            } else {
              const search = dom.$("#gtt-search");
              if (search && search.value) {
                search.value = "";
                search.dispatchEvent(new Event("input"));
              }
            }
          }
        });
      }
    };

    return { ensureFab, ensurePanel, setHidden, setMinimized };
  }

  function createAuthManager() {
    const listeners = new Set();
    const origFetch = window.fetch.bind(window);
    let patched = false;
    let lastAuth = null;

    const notifyMapping = (mapping) => {
      listeners.forEach((fn) => {
        try { fn(mapping); } catch (_) { /* ignore */ }
      });
    };

    const patchFetch = () => {
      if (patched) return;
      patched = true;
      window.fetch = async (...args) => {
        const [input, init] = args;
        try {
          const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
          const auth = headers.get("authorization") || headers.get("Authorization");
          if (auth && !lastAuth) {
            lastAuth = { Authorization: auth };
          }
        } catch {
          /* ignore */
        }
        const res = await origFetch(...args);
        try {
          const url = typeof input === "string" ? input : input?.url || "";
          if (/\/backend-api\/conversation\//.test(url)) {
            const clone = res.clone();
            const json = await clone.json();
            if (json?.mapping) {
              notifyMapping(json.mapping);
            }
          }
        } catch {
          /* ignore */
        }
        return res;
      };
    };

    patchFetch();

    const ensureAuth = async () => {
      if (lastAuth?.Authorization) return lastAuth;
      try {
        const res = await origFetch("/api/auth/session", { credentials: "include" });
        if (res.ok) {
          const json = await res.json();
          if (json?.accessToken) {
            lastAuth = { Authorization: `Bearer ${json.accessToken}` };
            return lastAuth;
          }
        }
      } catch {
        /* ignore */
      }
      return lastAuth || {};
    };

    const withAuthHeaders = (extra = {}) => ({ ...(lastAuth || {}), ...extra });
    const onMapping = (fn) => {
      if (typeof fn === "function") listeners.add(fn);
      return () => listeners.delete(fn);
    };

    return { ensureAuth, withAuthHeaders, onMapping, origFetch };
  }

  function createDataService({ config, auth }) {
    let token = 0;

    const getConversationId = () => (location.pathname.match(/\/c\/([a-z0-9-]{10,})/i) || [])[1] || null;

    const fetchMapping = async () => {
      const myToken = ++token;
      await auth.ensureAuth();
      const cid = getConversationId();
      if (!cid) return null;
      const { get: urls } = config.ENDPOINTS(cid);
      for (const url of urls) {
        try {
          const res = await auth.origFetch(url, { credentials: "include", headers: auth.withAuthHeaders() });
          if (myToken !== token) return null;
          if (res.ok) {
            const json = await res.json();
            if (json?.mapping) return json.mapping;
          }
        } catch {
          /* ignore */
        }
      }
      return null;
    };

    return { fetchMapping };
  }

  function hookHistory() {
    const push = history.pushState;
    const replace = history.replaceState;
    const fire = () => window.dispatchEvent(new Event("gtt:locationchange"));
    history.pushState = function () {
      const r = push.apply(this, arguments);
      fire();
      return r;
    };
    history.replaceState = function () {
      const r = replace.apply(this, arguments);
      fire();
      return r;
    };
    window.addEventListener("popstate", fire);
  }

})();
