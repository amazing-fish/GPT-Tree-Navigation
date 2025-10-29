// ==UserScript==
// @name         GPT Branch Tree Navigator (Preview + Jump)
// @namespace    jiaoling.tools.gpt.tree
// @version      1.5.0
// @description  树状分支 + 预览 + 一键跳转；支持最小化/隐藏与悬浮按钮恢复；快捷键 Alt+T / Alt+M；/ 聚焦搜索、Esc 关闭；拖拽移动面板；渐进式渲染；Markdown 预览；防抖监听；修复：当前分支已渲染却被误判为“未在该分支”。
// @author       Jiaoling
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  /** ================= 配置 ================= **/
  const CONFIG = Object.freeze({
    PANEL_WIDTH: 360,
    PREVIEW_MAX_CHARS: 200,
    HIGHLIGHT_MS: 1400,
    SCROLL_OFFSET: 80,
    LS_KEY: 'gtt_prefs_v3',
    RENDER_CHUNK: 120,
    RENDER_IDLE_MS: 12,
    OBS_DEBOUNCE_MS: 250,
    SIG_TEXT_LEN: 200,
    SELECTORS: {
      scrollRoot: 'main',
      messageBlocks: [
        '[data-message-author-role]',
        'article:has(.markdown)',
        'main [data-testid^="conversation-turn"]',
        'main .group.w-full',
        'main [data-message-id]'
      ].join(','),
      messageText: [
        '.markdown', '.prose',
        '[data-message-author-role] .whitespace-pre-wrap',
        '[data-message-author-role]'
      ].join(','),
    },
    ENDPOINTS: (cid) => ({
      get: [
        `/backend-api/conversation/${cid}`,
        `/backend-api/conversation/${cid}/`,
      ]
    })
  });

  /** ================= 样式 ================= **/
  const Style = {
    inject(css) {
      try { GM_addStyle(css); }
      catch (_) {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
      }
    }
  };

  Style.inject(`
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

  /** ================= 工具 ================= **/
  const DOM = {
    query(selector, root = document) { return root.querySelector(selector); },
    queryAll(selector, root = document) { return Array.from(root.querySelectorAll(selector)); },
  };

  const Text = {
    normalize(value) {
      return (value || '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    },
    normalizeForPreview(value) {
      return (value || '').replace(/\u200b/g, '').replace(/\r\n?/g, '\n');
    }
  };

  const Hash = {
    of(value) {
      const input = value || '';
      let h = 0;
      for (let i = 0; i < input.length; i++) {
        h = ((h << 5) - h + input.charCodeAt(i)) | 0;
      }
      return (h >>> 0).toString(36);
    }
  };

  const HTML = {
    ESCAPES: { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" },
    escape(value = '') {
      return value.replace(/[&<>'"]/g, ch => HTML.ESCAPES[ch] || ch);
    },
    escapeAttr(value = '') {
      return HTML.escape(value).replace(/`/g, '&#96;');
    },
    formatInline(text = '') {
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
    renderLite(raw = '') {
      const text = Text.normalizeForPreview(raw || '').trimEnd();
      if (!text) return '<p>(空)</p>';
      const lines = text.split('\n');
      let html = '';
      let inList = false;
      let codeBuffer = null;
      let codeLang = '';
      const flushList = () => { if (inList) { html += '</ul>'; inList = false; } };
      const flushCode = () => {
        if (!codeBuffer) return;
        const cls = codeLang ? ` class="lang-${HTML.escapeAttr(codeLang)}"` : '';
        const body = codeBuffer.map(HTML.escape).join('\n');
        html += `<pre><code${cls}>${body}</code></pre>`;
        codeBuffer = null;
        codeLang = '';
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
          html += '<br>';
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
            html += '<ul>';
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

  const Timing = {
    rafIdle(fn, ms = CONFIG.RENDER_IDLE_MS) { return setTimeout(fn, ms); },
    debounce(fn, wait) {
      let timer;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
      };
    }
  };

  const Location = {
    getConversationId() {
      const match = location.pathname.match(/\/c\/([a-z0-9-]{10,})/i) || [];
      return match[1] || null;
    }
  };

  const Signature = {
    create(role, text) {
      return (role || 'assistant') + '|' + Hash.of(Text.normalize(text).slice(0, CONFIG.SIG_TEXT_LEN));
    }
  };

  /** ================= 偏好 ================= **/
  const Prefs = (() => {
    const defaults = { minimized: false, hidden: false, pos: null };

    function load() {
      try {
        const raw = localStorage.getItem(CONFIG.LS_KEY) || localStorage.getItem('gtt_prefs_v2');
        const parsed = raw ? JSON.parse(raw) : {};
        return { ...defaults, ...parsed };
      } catch (_) {
        return { ...defaults };
      }
    }

    let state = load();

    function save() {
      try { localStorage.setItem(CONFIG.LS_KEY, JSON.stringify(state)); }
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

  /** ================= 授权 ================= **/
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
          return headers.get('authorization') || headers.get('Authorization');
        }
        if (headers && typeof headers === 'object') {
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
        const res = await origFetch('/api/auth/session', { credentials: 'include' });
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
          const url = typeof input === 'string' ? input : (input?.url || '');
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

  /** ================= 树状态 ================= **/
  const TreeState = {
    mapping: null,
    domBySig: new Map(),
    domById: new Map(),
    currentBranchIds: new Set(),
    currentBranchSigs: new Set(),
    currentBranchLeafId: null,
    currentBranchLeafSig: null,
  };

  /** ================= 模态 & 跳转 ================= **/
  const Navigator = (() => {
    const SCROLLABLE_VALUES = new Set(['auto', 'scroll', 'overlay']);

    function findScrollContainer(el) {
      const rootSel = CONFIG.SELECTORS?.scrollRoot;
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
    }

    function scrollToEl(el) {
      if (!el) return;
      const container = findScrollContainer(el);
      if (container && container !== document.body && container !== document.documentElement) {
        const rect = el.getBoundingClientRect();
        const parentRect = container.getBoundingClientRect();
        const offset = rect.top - parentRect.top + container.scrollTop - CONFIG.SCROLL_OFFSET;
        container.scrollTo({ top: offset, behavior: 'smooth' });
      } else {
        const offset = el.getBoundingClientRect().top + window.scrollY - CONFIG.SCROLL_OFFSET;
        window.scrollTo({ top: offset, behavior: 'smooth' });
      }
      el.classList.add('gtt-highlight');
      setTimeout(() => el.classList.remove('gtt-highlight'), CONFIG.HIGHLIGHT_MS);
    }

    function locateByText(text) {
      const snippet = Text.normalize(text).slice(0, 120);
      if (!snippet) return null;
      const blocks = DOM.queryAll(CONFIG.SELECTORS.messageBlocks);
      let best = null;
      let score = -1;
      for (const el of blocks) {
        const textEl = DOM.query(CONFIG.SELECTORS.messageText, el) || el;
        const normalized = Text.normalize(textEl?.innerText || '');
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
    }

    function openModal(text, reason) {
      const body = DOM.query('#gtt-md-body');
      const title = DOM.query('#gtt-md-title');
      const modal = DOM.query('#gtt-modal');
      if (!body || !title || !modal) return;
      body.innerHTML = Markdown.renderLite(text);
      title.textContent = reason || '节点预览（未能定位到页面元素，已为你展示文本）';
      modal.style.display = 'flex';
    }

    function closeModal() {
      const modal = DOM.query('#gtt-modal');
      const body = DOM.query('#gtt-md-body');
      if (modal) modal.style.display = 'none';
      if (body) body.innerHTML = '';
    }

    async function jumpTo(node) {
      if (!node) return;
      let target = TreeState.domById.get(node.id);
      if (target && target.isConnected) return scrollToEl(target);
      const sig = node.sig || Signature.create(node.role, node.text);
      target = TreeState.domBySig.get(sig);
      if (target && target.isConnected) return scrollToEl(target);
      target = locateByText(node.text);
      if (target) return scrollToEl(target);
      openModal(node.text || '(无文本)', '节点预览（未能定位到页面元素，已为你展示文本）');
    }

    return { jumpTo, openModal, closeModal };
  })();

  /** ================= 面板 ================= **/
  const Panel = (() => {
    function ensureFab() {
      if (DOM.query('#gtt-fab')) return;
      const fab = document.createElement('div');
      fab.id = 'gtt-fab';
      fab.innerHTML = `<span class="dot"></span><span class="txt">GPT Tree</span>`;
      fab.addEventListener('click', () => setHidden(false));
      document.body.appendChild(fab);
    }

    function ensurePanel() {
      if (DOM.query('#gtt-panel')) return;
      const panel = document.createElement('div');
      panel.id = 'gtt-panel';
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
      bindPanel(panel);
      applyState(panel);
    }

    function bindPanel(panel) {
      const btnMin = DOM.query('#gtt-btn-min', panel);
      const btnHide = DOM.query('#gtt-btn-hide', panel);
      const btnRefresh = DOM.query('#gtt-btn-refresh', panel);
      const btnCollapse = DOM.query('#gtt-btn-collapse', panel);
      const btnCloseModal = DOM.query('#gtt-md-close', panel);
      const header = DOM.query('#gtt-header', panel);
      const dragHandle = DOM.query('#gtt-drag', panel);
      const inputSearch = DOM.query('#gtt-search', panel);

      if (btnMin) btnMin.addEventListener('click', () => setMinimized(!Prefs.get('minimized')));
      if (btnHide) btnHide.addEventListener('click', () => setHidden(true));
      if (btnRefresh) btnRefresh.addEventListener('click', () => Lifecycle.rebuild({ forceFetch: true, hard: true }));
      if (btnCollapse) btnCollapse.addEventListener('click', toggleCollapseAll);
      if (btnCloseModal) btnCloseModal.addEventListener('click', Navigator.closeModal);
      if (header) header.addEventListener('dblclick', () => setMinimized(!Prefs.get('minimized')));

      if (inputSearch) {
        const handleSearch = Timing.debounce((e) => {
          const query = (typeof e === 'string' ? e : (e?.target?.value || '')).trim().toLowerCase();
          DOM.queryAll('#gtt-tree .gtt-node').forEach(node => {
            node.style.display = node.textContent.toLowerCase().includes(query) ? '' : 'none';
          });
        }, 120);
        inputSearch.addEventListener('input', handleSearch);
      }

      if (dragHandle) enableDrag(panel, dragHandle);
    }

    function applyState(panel) {
      setMinimized(Prefs.get('minimized'), { silent: true });
      setHidden(Prefs.get('hidden'), { silent: true });
      applyPosition(panel);
    }

    function applyPosition(panel = DOM.query('#gtt-panel')) {
      if (!panel) return;
      const pos = Prefs.get('pos');
      if (pos) {
        panel.style.left = `${pos.left}px`;
        panel.style.top = `${pos.top}px`;
        panel.style.right = 'auto';
      }
    }

    function rememberPosition(panel) {
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      Prefs.set('pos', { left: Math.round(rect.left), top: Math.round(rect.top) });
    }

    function enableDrag(panel, handle) {
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let startLeft = 0;
      let startTop = 0;

      handle.addEventListener('mousedown', (e) => {
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = panel.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        panel.style.right = 'auto';
        const onMove = (ev) => {
          if (!dragging) return;
          const left = startLeft + (ev.clientX - startX);
          const top = startTop + (ev.clientY - startY);
          panel.style.left = `${Math.max(8, left)}px`;
          panel.style.top = `${Math.max(8, top)}px`;
        };
        const onUp = () => {
          dragging = false;
          document.removeEventListener('mousemove', onMove);
          rememberPosition(panel);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp, { once: true });
      });
    }

    function toggleCollapseAll() {
      DOM.queryAll('.gtt-children').forEach(el => el.classList.toggle('gtt-hidden'));
    }

    function setHidden(value, { silent = false } = {}) {
      const panel = DOM.query('#gtt-panel');
      const fab = DOM.query('#gtt-fab');
      if (!panel || !fab) return;
      if (value) {
        panel.style.display = 'none';
        fab.style.display = 'inline-flex';
      } else {
        panel.style.display = 'flex';
        fab.style.display = 'none';
      }
      Prefs.set('hidden', !!value, { silent });
    }

    function setMinimized(value, { silent = false } = {}) {
      const panel = DOM.query('#gtt-panel');
      const btn = DOM.query('#gtt-btn-min');
      if (!panel || !btn) return;
      panel.classList.toggle('gtt-min', !!value);
      btn.textContent = value ? '还原' : '最小化';
      Prefs.set('minimized', !!value, { silent });
    }

    function updateStats(total) {
      const el = DOM.query('#gtt-stats');
      if (el) el.textContent = total ? `节点：${total}` : '';
    }

    return {
      ensure: () => { ensureFab(); ensurePanel(); },
      ensureFab,
      ensurePanel,
      setHidden,
      setMinimized,
      toggleCollapseAll,
      updateStats,
      applyPosition,
    };
  })();

  /** ================= 分支高亮 ================= **/
  const BranchHighlighter = (() => {
    function clear(rootEl) {
      const nodeEls = rootEl.querySelectorAll('.gtt-node');
      const connectorEls = rootEl.querySelectorAll('.gtt-children');
      nodeEls.forEach(el => el.classList.remove('gtt-current', 'gtt-current-leaf'));
      connectorEls.forEach(el => el.classList.remove('gtt-current-line'));
    }

    function apply(rootEl = DOM.query('#gtt-tree')) {
      if (!rootEl) return;
      clear(rootEl);
      const hasBranch = (TreeState.currentBranchIds.size || TreeState.currentBranchSigs.size);
      if (!hasBranch) return;
      const nodeEls = rootEl.querySelectorAll('.gtt-node');
      nodeEls.forEach(el => {
        const id = el.dataset?.nodeId;
        const sig = el.dataset?.sig;
        const chainIds = Array.isArray(el._chainIds) ? el._chainIds : null;
        const chainSigs = Array.isArray(el._chainSigs) ? el._chainSigs : null;
        const matchesId = id && TreeState.currentBranchIds.has(id);
        const matchesSig = sig && TreeState.currentBranchSigs.has(sig);
        const matchesChainId = chainIds ? chainIds.some(cid => TreeState.currentBranchIds.has(cid)) : false;
        const matchesChainSig = chainSigs ? chainSigs.some(cs => TreeState.currentBranchSigs.has(cs)) : false;
        const isCurrent = matchesId || matchesSig || matchesChainId || matchesChainSig;
        if (!isCurrent) return;
        el.classList.add('gtt-current');
        const isLeaf = (
          (TreeState.currentBranchLeafId && (id === TreeState.currentBranchLeafId || (chainIds && chainIds.includes(TreeState.currentBranchLeafId)))) ||
          (TreeState.currentBranchLeafSig && (sig === TreeState.currentBranchLeafSig || (chainSigs && chainSigs.includes(TreeState.currentBranchLeafSig))))
        );
        if (isLeaf) el.classList.add('gtt-current-leaf');
        const parent = el.parentElement;
        if (parent?.classList?.contains('gtt-children')) {
          parent.classList.add('gtt-current-line');
        }
      });
    }

    return { apply };
  })();

  /** ================= 构树 ================= **/
  const Tree = (() => {
    function preview(text, limit = CONFIG.PREVIEW_MAX_CHARS) {
      const normalized = Text.normalize(text);
      return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
    }

    function isToolishRole(role) {
      return role === 'tool' || role === 'system' || role === 'function';
    }

    function getRecText(rec) {
      const parts = rec?.message?.content?.parts ?? [];
      if (Array.isArray(parts)) return parts.join('\n');
      if (typeof parts === 'string') return parts;
      return '';
    }

    function isVisibleRec(rec) {
      if (!rec) return false;
      const role = rec?.message?.author?.role || 'assistant';
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
        const role = rec?.message?.author?.role || 'assistant';
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
      const role = rec?.message?.author?.role || 'assistant';
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
        const kidRole = kidRec?.message?.author?.role || 'assistant';
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
        if (current.role === 'user') {
          const next = linear[i + 1];
          const pair = { id: current.id, role: 'user', text: current.text, sig: current.sig, children: [] };
          if (next && next.role === 'assistant') {
            pair.children.push({ id: next.id, role: 'assistant', text: next.text, sig: next.sig, children: [] });
          }
          nodes.push(pair);
        } else {
          nodes.push({ id: current.id, role: 'assistant', text: current.text, sig: current.sig, children: [] });
        }
      }
      return nodes;
    }

    function renderTreeGradually(targetEl, treeData) {
      targetEl.innerHTML = '';
      const stats = { total: 0 };
      const container = document.createDocumentFragment();
      const queue = [];

      const pushList = (nodes, parent) => { for (const node of nodes) queue.push({ node, parent }); };

      const createItem = (node) => {
        const item = document.createElement('div');
        item.className = 'gtt-node';
        item.dataset.nodeId = node.id;
        item.dataset.sig = node.sig;
        item.title = `${node.id}\n\n${node.text || ''}`;
        if (node.chainIds) item._chainIds = node.chainIds;
        if (node.chainSigs) item._chainSigs = node.chainSigs;
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = node.role === 'user' ? 'U' : (node.role || '·');
        const title = document.createElement('span');
        title.textContent = node.role === 'user' ? '用户' : '助手';
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = node.children?.length ? `(${node.children.length})` : '';
        const pv = document.createElement('span');
        pv.className = 'pv';
        pv.textContent = preview(node.text);
        item.append(badge, title, meta, pv);
        item.addEventListener('click', () => Navigator.jumpTo(node));
        return item;
      };

      const rootDiv = document.createElement('div');
      container.appendChild(rootDiv);
      pushList(treeData, rootDiv);

      const step = () => {
        let count = 0;
        while (count < CONFIG.RENDER_CHUNK && queue.length) {
          const { node, parent } = queue.shift();
          const item = createItem(node);
          parent.appendChild(item);
          stats.total++;
          if (node.children?.length) {
            const kids = document.createElement('div');
            kids.className = 'gtt-children';
            parent.appendChild(kids);
            pushList(node.children, kids);
          }
          count++;
        }
        if (queue.length) {
          Timing.rafIdle(step);
        } else {
          targetEl.appendChild(container);
          Panel.updateStats(stats.total);
          BranchHighlighter.apply(targetEl);
        }
      };

      step();
    }

    function harvestLinearNodes() {
      const blocks = DOM.queryAll(CONFIG.SELECTORS.messageBlocks);
      const result = [];
      const ids = new Set();
      const sigs = new Set();
      const domBySig = new Map();
      const domById = new Map();

      for (const el of blocks) {
        const textEl = DOM.query(CONFIG.SELECTORS.messageText, el) || el;
        const raw = (textEl?.innerText || '').trim();
        const text = Text.normalize(raw);
        if (!text) continue;
        let role = el.getAttribute('data-message-author-role');
        if (!role) role = el.querySelector('.markdown,.prose') ? 'assistant' : 'user';
        const messageId = el.getAttribute('data-message-id') || el.dataset?.messageId || DOM.query('[data-message-id]', el)?.getAttribute('data-message-id') || (el.id?.startsWith('conversation-turn-') ? el.id.split('conversation-turn-')[1] : null);
        const id = messageId ? messageId : (`lin-${Hash.of(text.slice(0, 80))}`);
        const sig = Signature.create(role, text);
        const record = { id, role, text, sig, _el: el };
        result.push(record);
        domBySig.set(sig, el);
        ids.add(id);
        sigs.add(sig);
        if (messageId) domById.set(messageId, el);
      }

      TreeState.domBySig = domBySig;
      TreeState.domById = domById;
      TreeState.currentBranchIds = ids;
      TreeState.currentBranchSigs = sigs;
      if (result.length) {
        const leaf = result[result.length - 1];
        TreeState.currentBranchLeafId = leaf?.id || null;
        TreeState.currentBranchLeafSig = leaf?.sig || null;
      } else {
        TreeState.currentBranchLeafId = null;
        TreeState.currentBranchLeafSig = null;
      }

      BranchHighlighter.apply();
      return result;
    }

    function buildFromMapping(mapping) {
      const treeEl = DOM.query('#gtt-tree');
      if (!treeEl) return;
      const treeData = mappingToTree(mapping);
      renderTreeGradually(treeEl, treeData);
    }

    function buildFromLinear(linear) {
      const treeEl = DOM.query('#gtt-tree');
      if (!treeEl) return;
      const treeData = linearToTree(linear);
      renderTreeGradually(treeEl, treeData);
    }

    return { harvestLinearNodes, buildFromMapping, buildFromLinear };
  })();

  /** ================= 数据层 ================= **/
  const Data = (() => {
    const fetchCtl = { token: 0 };

    async function fetchMapping() {
      const currentToken = ++fetchCtl.token;
      await Auth.ensureAuth();
      const cid = Location.getConversationId();
      if (!cid) return null;
      const { get: urls } = CONFIG.ENDPOINTS(cid);
      for (const url of urls) {
        try {
          const response = await Auth.origFetch(url, { credentials: 'include', headers: Auth.withHeaders() });
          if (currentToken !== fetchCtl.token) return null;
          if (response.ok) {
            const json = await response.json();
            if (json?.mapping) return json.mapping;
          }
        } catch (_) {
          /* ignore network errors */
        }
      }
      return null;
    }

    return { fetchMapping };
  })();

  /** ================= 监听 ================= **/
  const Observers = (() => {
    const observer = new MutationObserver(Timing.debounce(() => {
      Tree.harvestLinearNodes();
    }, CONFIG.OBS_DEBOUNCE_MS));

    function start() {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    function stop() {
      observer.disconnect();
    }

    return { start, stop };
  })();

  /** ================= 路由感知 ================= **/
  const Router = (() => {
    function hook(onChange) {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      function fire() { window.dispatchEvent(new Event('gtt:locationchange')); }
      history.pushState = function () {
        const result = origPush.apply(this, arguments);
        fire();
        return result;
      };
      history.replaceState = function () {
        const result = origReplace.apply(this, arguments);
        fire();
        return result;
      };
      window.addEventListener('popstate', fire);
      window.addEventListener('gtt:locationchange', onChange);
      window.addEventListener('popstate', onChange);
    }

    return { hook };
  })();

  /** ================= 键盘 ================= **/
  const Keyboard = (() => {
    function bind() {
      document.addEventListener('keydown', (e) => {
        const searchInput = DOM.query('#gtt-search');
        if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          searchInput?.focus();
        }
        if (e.key === 'Escape') {
          const modal = DOM.query('#gtt-modal');
          if (modal?.style?.display === 'flex') {
            Navigator.closeModal();
          } else if (searchInput) {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
          }
        }
        if (!e.altKey) return;
        if (e.key === 't' || e.key === 'T') {
          e.preventDefault();
          Panel.setHidden(!Prefs.get('hidden'));
        }
        if (e.key === 'm' || e.key === 'M') {
          e.preventDefault();
          Panel.setMinimized(!Prefs.get('minimized'));
        }
      });
    }

    return { bind };
  })();

  /** ================= 生命周期 ================= **/
  const Lifecycle = (() => {
    async function rebuild(opts = {}) {
      Panel.ensure();
      if (opts.hard) TreeState.mapping = null;
      const linearNodes = Tree.harvestLinearNodes();
      if (opts.forceFetch || !TreeState.mapping) {
        const mapping = await Data.fetchMapping();
        if (mapping) {
          TreeState.mapping = mapping;
          Tree.buildFromMapping(mapping);
          return;
        }
      }
      if (TreeState.mapping) {
        Tree.buildFromMapping(TreeState.mapping);
      } else {
        Tree.buildFromLinear(linearNodes);
      }
    }

    function handleMappingFromFetch(mapping) {
      if (!mapping) return;
      TreeState.mapping = mapping;
      Panel.ensure();
      Tree.buildFromMapping(mapping);
    }

    function boot() {
      Panel.ensureFab();
      Panel.ensurePanel();
      Observers.start();
      Router.hook(async () => {
        await rebuild({ forceFetch: true, hard: true });
      });
      Keyboard.bind();
      rebuild();
    }

    return { rebuild, handleMappingFromFetch, boot };
  })();

  /** ================= 启动 ================= **/
  Auth.patch(Lifecycle.handleMappingFromFetch);

  const readyTimer = setInterval(() => {
    if (document.querySelector('main')) {
      clearInterval(readyTimer);
      Lifecycle.boot();
    }
  }, 300);

})();

