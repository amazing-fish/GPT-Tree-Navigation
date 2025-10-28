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
  const CONFIG = {
    PANEL_WIDTH: 360,
    PREVIEW_MAX_CHARS: 200,
    HIGHLIGHT_MS: 1400,
    SCROLL_OFFSET: 80,
    LS_KEY: 'gtt_prefs_v3',
    RENDER_CHUNK: 120,           // 每批渲染多少个节点，避免长树卡顿
    RENDER_IDLE_MS: 12,          // 渲染批次之间的间隔
    OBS_DEBOUNCE_MS: 250,        // DOM 监听防抖
    SIG_TEXT_LEN: 200,           // 用于签名的前缀长度（文本）
    SELECTORS: {
      scrollRoot: 'main',
      messageBlocks: [
        '[data-message-author-role]',
        'article:has(.markdown)',
        'main [data-testid^="conversation-turn"]',
        'main .group.w-full',
        'main [data-message-id]' // 新增：直接抓取包含 message-id 的块
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
  };

  /** ================= 样式 ================= **/
  const injectStyle = (css) => {
    try { GM_addStyle(css); } catch (_) {
      const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    }
  };

  injectStyle(`
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
    #gtt-tree{flex:1;overflow:auto;padding:8px 6px 10px;scrollbar-gutter:stable}
    .gtt-node{display:flex;gap:10px;align-items:flex-start;padding:6px 8px;border-radius:8px;margin:2px 0;cursor:pointer;position:relative}
    .gtt-node:hover{background:rgba(127,127,255,.08)}
    .gtt-node .badge{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;font-size:10px;padding:2px 6px;border-radius:999px;border:1px solid var(--gtt-bd,#d0d7de);opacity:.75;margin-top:1px}
    .gtt-node .text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
    .gtt-node .head{display:flex;align-items:center;gap:6px;min-width:0}
    .gtt-node .title{display:block;font-size:11px;font-weight:600;line-height:1.2;opacity:.85}
    .gtt-node .meta{margin-left:auto;opacity:.65;font-size:11px}
    .gtt-node .pv{display:block;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
    .gtt-children{margin-left:14px;border-left:1px dashed var(--gtt-bd,#d0d7de);padding-left:8px}
    .gtt-hidden{display:none!important}
    .gtt-highlight{outline:3px solid rgba(88,101,242,.65)!important;transition:outline-color .6s ease}
    .gtt-node.gtt-current{background:rgba(250,140,22,.12);border-left:2px solid var(--gtt-cur,#fa8c16);padding-left:10px}
    .gtt-node.gtt-current .badge{border-color:var(--gtt-cur,#fa8c16);color:var(--gtt-cur,#fa8c16);opacity:1}
    .gtt-node.gtt-current-leaf{box-shadow:0 0 0 2px rgba(250,140,22,.24) inset}
    .gtt-children.gtt-current-line{border-left:2px dashed var(--gtt-cur,#fa8c16)}

    /* 最小化态：只显示标题栏 */
    #gtt-panel.gtt-min #gtt-body{display:none}

    /* 预览模态 */
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

    /* 悬浮恢复按钮（隐藏后出现） */
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
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const hash = (s) => { let h=0; for (let i=0;i<s.length;i++) h=((h<<5)-h + s.charCodeAt(i))|0; return (h>>>0).toString(36); };
  const normalize = (s)=> (s||'').replace(/\u200b/g,'').replace(/\s+/g,' ').trim();
  const normalizeForPreview = (s)=> (s||'').replace(/\u200b/g,'').replace(/\r\n?/g,'\n');
  const HTML_ESC = { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" };
  const escapeHtml = (str='')=> str.replace(/[&<>'"]/g, (ch)=> HTML_ESC[ch] || ch);
  const escapeAttr = (str='')=> escapeHtml(str).replace(/`/g,'&#96;');
  const formatInline = (txt='')=>{
    let out = escapeHtml(txt);
    out = out.replace(/`([^`]+)`/g, (_m, code)=>`<code>${code}</code>`);
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url)=>`<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${label}</a>`);
    const codeHolders = [];
    out = out.replace(/<code>[^<]*<\/code>/g, (match)=>{ codeHolders.push(match); return `\uFFF0${codeHolders.length-1}\uFFF1`; });
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    out = out.replace(/(\s|^)\*([^*\n]+)\*(?=\s|[\.,!?:;\)\]\}“”"'`]|$)/g, (_m, pre, body)=> `${pre}<em>${body}</em>`);
    out = out.replace(/(\s|^)_(?!_)([^_\n]+)_(?=\s|[\.,!?:;\)\]\}“”"'`]|$)/g, (_m, pre, body)=> `${pre}<em>${body}</em>`);
    out = out.replace(/\uFFF0(\d+)\uFFF1/g, (_m, idx)=> codeHolders[Number(idx)]);
    return out;
  };
  const renderMarkdownLite = (raw='')=>{
    const text = normalizeForPreview(raw || '').trimEnd();
    if (!text) return '<p>(空)</p>';
    const lines = text.split('\n');
    let html = '';
    let inList = false;
    let codeBuffer = null;
    let codeLang = '';
    const flushList = ()=>{ if (inList){ html += '</ul>'; inList = false; } };
    const flushCode = ()=>{
      if (codeBuffer){
        const cls = codeLang ? ` class="lang-${escapeAttr(codeLang)}"` : '';
        const body = codeBuffer.map(escapeHtml).join('\n');
        html += `<pre><code${cls}>${body}</code></pre>`;
        codeBuffer = null;
        codeLang = '';
      }
    };
    for (const line of lines){
      const trimmed = line.trim();
      if (/^```/.test(trimmed)){
        if (codeBuffer){
          flushCode();
        }else{
          flushList();
          codeBuffer = [];
          codeLang = trimmed.slice(3).trim();
        }
        continue;
      }
      if (codeBuffer){
        codeBuffer.push(line);
        continue;
      }
      if (!trimmed){
        flushList();
        html += '<br>';
        continue;
      }
      const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (heading){
        flushList();
        const level = heading[1].length;
        html += `<h${level}>${formatInline(heading[2])}</h${level}>`;
        continue;
      }
      const listItem = line.match(/^\s*[-*+]\s+(.*)$/);
      if (listItem){
        if (!inList){ html += '<ul>'; inList = true; }
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
  const makeSig = (role, text)=> (role||'assistant') + '|' + hash(normalize(text).slice(0, CONFIG.SIG_TEXT_LEN));
  const getConversationId = () => (location.pathname.match(/\/c\/([a-z0-9-]{10,})/i)||[])[1]||null;
  const rafIdle = (fn, ms=CONFIG.RENDER_IDLE_MS) => setTimeout(fn, ms);
  const debounce = (fn, ms) => { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); } };

  /** ================= 状态持久化 ================= **/
  const defaults = {
    minimized: false,
    hidden: false,
    pos: null // {left, top} 若为 null 使用默认 right 固定
  };
  let prefs = loadPrefs();

  function loadPrefs(){
    try{
      const raw = localStorage.getItem(CONFIG.LS_KEY) || localStorage.getItem('gtt_prefs_v2');
      const obj = raw ? JSON.parse(raw) : {};
      // v2->v3 兼容：无 pos 字段
      return { ...defaults, ...obj };
    }catch{ return {...defaults}; }
  }
  function savePrefs(){ try{ localStorage.setItem(CONFIG.LS_KEY, JSON.stringify(prefs)); }catch{} }

  /** ================= 鉴权（更稳健） ================= **/
  let LAST_AUTH = null;   // {Authorization}
  let FETCH_PATCHED = false;
  const origFetch = window.fetch;
  if (!FETCH_PATCHED){
    FETCH_PATCHED = true;
    window.fetch = async (...args)=>{
      const [input, init] = args;
      try{
        const req = (input instanceof Request) ? input : null;
        const hdrs = req ? Object.fromEntries(req.headers.entries()) : (init?.headers || {});
        const auth = hdrs?.authorization || hdrs?.Authorization;
        if (auth && !LAST_AUTH){ LAST_AUTH = { Authorization: auth }; }
      }catch(_) {}
      const res = await origFetch(...args);
      try{
        const url = typeof input==='string' ? input : input?.url || '';
        if (/\/backend-api\/conversation\//.test(url)) {
          const clone = res.clone(); const json = await clone.json();
          if (json?.mapping) {
            ensurePanel();
            LAST_MAPPING = json.mapping;
            buildTreeFromMapping(LAST_MAPPING);
          }
        }
      }catch(_) {}
      return res;
    };
  }

  async function ensureAuth(){
    if (LAST_AUTH?.Authorization) return LAST_AUTH;
    try{
      const r = await origFetch('/api/auth/session', { credentials:'include' });
      if (r.ok){
        const j = await r.json();
        if (j?.accessToken){ LAST_AUTH = { Authorization: `Bearer ${j.accessToken}` }; return LAST_AUTH; }
      }
    }catch(_){ }
    return LAST_AUTH || {};
  }
  const withAuthHeaders = (extra={}) => ({ ...(LAST_AUTH||{}), ...extra });

  /** ================= 面板 + FAB ================= **/
  function ensureFab(){
    if ($('#gtt-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'gtt-fab';
    fab.innerHTML = `<span class="dot"></span><span class="txt">GPT Tree</span>`;
    fab.addEventListener('click', ()=> setHidden(false));
    document.body.appendChild(fab);
  }

  function ensurePanel(){
    if ($('#gtt-panel')) return;
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

    // 绑定交互
    $('#gtt-btn-min').addEventListener('click', ()=> setMinimized(!prefs.minimized));
    $('#gtt-btn-hide').addEventListener('click', ()=> setHidden(true));
    $('#gtt-btn-refresh').addEventListener('click', ()=>rebuildTree({forceFetch:true, hard:true}));
    $('#gtt-btn-collapse').addEventListener('click', toggleCollapseAll);
    $('#gtt-md-close').addEventListener('click', closeModal);

    const inputSearch = $('#gtt-search');
    const onSearch = debounce((e)=>{
      const q = (typeof e==='string'? e : (e?.target?.value||'')).trim().toLowerCase();
      $$('#gtt-tree .gtt-node').forEach(n=>{ n.style.display = n.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    }, 120);
    inputSearch.addEventListener('input', onSearch);

    // 初始化偏好
    // 双击标题栏=最小化/还原
    $('#gtt-header').addEventListener('dblclick', ()=> setMinimized(!prefs.minimized));

    // 键盘：/ 聚焦搜索；Esc 关闭模态/清搜索
    document.addEventListener('keydown', (e)=>{
      if (e.key === '/' && !e.metaKey && !e.ctrlKey){ e.preventDefault(); inputSearch.focus(); }
      if (e.key === 'Escape'){
        if ($('#gtt-modal').style.display==='flex') closeModal(); else { inputSearch.value=''; inputSearch.dispatchEvent(new Event('input')); }
      }
    });

    // 拖拽移动
    enableDrag($('#gtt-panel'), $('#gtt-drag'));

    // 应用最小化/隐藏/位置状态
    setMinimized(prefs.minimized, /*silent*/true);
    setHidden(prefs.hidden, /*silent*/true);
    applyPositionFromPrefs();
  }

  function applyPositionFromPrefs(){
    const panel = $('#gtt-panel'); if (!panel) return;
    if (prefs.pos){
      panel.style.left = prefs.pos.left + 'px';
      panel.style.top = prefs.pos.top + 'px';
      panel.style.right = 'auto';
    }
  }

  function enableDrag(panel, handle){
    let dragging=false, sx=0, sy=0, sl=0, st=0;
    handle.addEventListener('mousedown', (e)=>{
      dragging=true; sx=e.clientX; sy=e.clientY; const r = panel.getBoundingClientRect(); sl=r.left; st=r.top;
      panel.style.right = 'auto';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp, { once:true });
    });
    function onMove(e){ if (!dragging) return; const l = sl + (e.clientX - sx); const t = st + (e.clientY - sy); panel.style.left = Math.max(8, l) + 'px'; panel.style.top = Math.max(8, t) + 'px'; }
    function onUp(){ dragging=false; document.removeEventListener('mousemove', onMove); const r = panel.getBoundingClientRect(); prefs.pos = { left: Math.round(r.left), top: Math.round(r.top) }; savePrefs(); }
  }

  function setHidden(v, silent=false){
    const panel = $('#gtt-panel'); const fab = $('#gtt-fab');
    if (!panel || !fab) return;
    if (v){ panel.style.display='none'; fab.style.display='inline-flex'; }
    else { panel.style.display='flex'; fab.style.display='none'; }
    prefs.hidden = !!v; if (!silent) savePrefs();
  }

  function setMinimized(v, silent=false){
    const panel = $('#gtt-panel'); if (!panel) return;
    panel.classList.toggle('gtt-min', !!v);
    $('#gtt-btn-min').textContent = v ? '还原' : '最小化';
    prefs.minimized = !!v; if (!silent) savePrefs();
  }

  /** ================= 数据：mapping / 线性回退 ================= **/
  let LAST_MAPPING = null;
  let DOM_BY_SIG = new Map();  // 签名 -> 元素
  let DOM_BY_ID = new Map();   // messageId -> 元素
  let CURRENT_BRANCH_IDS = new Set();
  let CURRENT_BRANCH_SIGS = new Set();
  let CURRENT_BRANCH_LEAF_ID = null;
  let CURRENT_BRANCH_LEAF_SIG = null;
  let fetchCtl = { token: 0 };

  async function fetchMapping(){
    const myTok = ++fetchCtl.token;
    await ensureAuth();
    const cid = getConversationId(); if (!cid) return null;
    const {get:getUrls} = CONFIG.ENDPOINTS(cid);
    for (const u of getUrls){
      try{
        const r = await origFetch(u, { credentials:'include', headers: withAuthHeaders() });
        if (myTok !== fetchCtl.token) return null; // 过期
        if (r.ok){
          const j = await r.json();
          if (j?.mapping){ return j.mapping; }
        }
      }catch(_err){ }
    }
    return null;
  }

  function harvestLinearNodes(){
    const blocks = $$(CONFIG.SELECTORS.messageBlocks);
    const out = [];
    const ids = new Set();
    const sigs = new Set();
    DOM_BY_SIG = new Map();
    DOM_BY_ID = new Map();
    for (const el of blocks){
      const textEl = $(CONFIG.SELECTORS.messageText, el) || el;
      const raw = (textEl?.innerText || '').trim();
      const text = normalize(raw);
      if (!text) continue;
      let role = el.getAttribute('data-message-author-role');
      if (!role) role = el.querySelector('.markdown,.prose') ? 'assistant' : 'user';
      const messageId = el.getAttribute('data-message-id') || el.dataset?.messageId || $("[data-message-id]", el)?.getAttribute('data-message-id') || (el.id?.startsWith('conversation-turn-') ? el.id.split('conversation-turn-')[1] : null);
      const id = messageId ? messageId : ('lin-' + hash(text.slice(0,80)));
      const sig = makeSig(role, text);
      const rec = {id, role, text, sig, _el: el};
      out.push(rec);
      DOM_BY_SIG.set(sig, el);
      ids.add(id);
      sigs.add(sig);
      if (messageId) DOM_BY_ID.set(messageId, el);
    }
    CURRENT_BRANCH_IDS = ids;
    CURRENT_BRANCH_SIGS = sigs;
    if (out.length){
      const leaf = out[out.length - 1];
      CURRENT_BRANCH_LEAF_ID = leaf?.id || null;
      CURRENT_BRANCH_LEAF_SIG = leaf?.sig || null;
    }else{
      CURRENT_BRANCH_LEAF_ID = null;
      CURRENT_BRANCH_LEAF_SIG = null;
    }
    applyCurrentBranchHighlight();
    return out;
  }

  /** ================= 构树与渲染 ================= **/
  const preview = (t, n=CONFIG.PREVIEW_MAX_CHARS)=>{ const s=normalize(t); return s.length>n ? s.slice(0,n)+'…' : s; };

  // 识别“工具/系统”角色
  function isToolishRole(role){ return role === 'tool' || role === 'system' || role === 'function'; }
  function getRecText(rec){ const parts = rec?.message?.content?.parts ?? []; return Array.isArray(parts) ? parts.join('\n') : (typeof parts === 'string' ? parts : ''); }
  function isVisibleRec(rec){ if (!rec) return false; const role = rec?.message?.author?.role || 'assistant'; if (isToolishRole(role)) return false; const text = getRecText(rec); return !!normalize(text); }
  function visibleParentId(mapping, id){ let cur = id, guard = 0; while (guard++ < 4096){ const p = mapping[cur]?.parent; if (p == null) return null; const pr = mapping[p]; if (isVisibleRec(pr)) return p; cur = p; } return null; }
  function dedupBySig(ids, mapping){ const seen = new Set(); const out = []; for (const cid of ids){ const rec = mapping[cid]; if (!rec) continue; const role = rec?.message?.author?.role || 'assistant'; const text = normalize(getRecText(rec)); const sig = makeSig(role, text); if (!seen.has(sig)){ seen.add(sig); out.push(cid); } } return out; }

  function buildTreeFromMapping(mapping){
    const treeEl = $('#gtt-tree');
    if (!treeEl) return;
    const byId = mapping;
    const visibleIds = Object.keys(byId).filter(id => isVisibleRec(byId[id]));

    const parentMap = new Map();
    for (const vid of visibleIds){ parentMap.set(vid, visibleParentId(byId, vid)); }

    const childrenMap = new Map(visibleIds.map(id => [id, []]));
    for (const vid of visibleIds){ const p = parentMap.get(vid); if (p && childrenMap.has(p)) childrenMap.get(p).push(vid); }
    for (const [pid, arr] of childrenMap.entries()){ childrenMap.set(pid, dedupBySig(arr, byId)); }

    const roots = visibleIds.filter(id => parentMap.get(id) == null);

    function foldSameRoleChain(startId){
      let cur = startId;
      let rec = byId[cur];
      const role = rec?.message?.author?.role || 'assistant';
      let text = getRecText(rec);
      let guard = 0;
      const chainIds = [];
      const chainSigs = [];
      while (rec && guard++ < 4096){
        const curText = getRecText(rec);
        if (curText){
          chainIds.push(cur);
          chainSigs.push(makeSig(role, curText));
        }
        const kids = childrenMap.get(cur) || [];
        if (kids.length !== 1) break;
        const k = kids[0];
        const kRec = byId[k];
        const kRole = kRec?.message?.author?.role || 'assistant';
        const kText = getRecText(kRec);
        if (kRole === role && kText && text){
          text = (text + '\n' + kText).trim();
          cur = k;
          rec = kRec;
          continue;
        }
        break;
      }
      return { id: cur, role, text, ids: chainIds, sigs: chainSigs };
    }

    const toNode = (id) => {
      const folded = foldSameRoleChain(id);
      const curId = folded.id;
      const curRole = folded.role;
      const curText = folded.text;
      const kidIds = childrenMap.get(curId) || [];
      const childrenNodes = kidIds.map(toNode).filter(Boolean);
      const sig = makeSig(curRole, curText);
      const chainIds = (folded.ids && folded.ids.length) ? folded.ids : [curId];
      const chainSigs = (folded.sigs && folded.sigs.length) ? folded.sigs : [sig];
      return { id: curId, role: curRole, text: curText, sig, chainIds, chainSigs, children: childrenNodes };
    };

    const tree = roots.map(toNode).filter(Boolean);
    renderTreeGradually(treeEl, tree);
  }

  function buildTreeFromLinear(linear){
    const nodes=[]; for (let i=0;i<linear.length;i++){
      const cur=linear[i];
      if (cur.role==='user'){
        const nxt=linear[i+1];
        const pair={id:cur.id, role:'user', text:cur.text, sig:cur.sig, children:[]};
        if (nxt && nxt.role==='assistant'){ pair.children.push({id:nxt.id, role:'assistant', text:nxt.text, sig:nxt.sig, children:[]}); }
        nodes.push(pair);
      }else{ nodes.push({id:cur.id, role:'assistant', text:cur.text, sig:cur.sig, children:[]}); }
    }
    renderTreeGradually($('#gtt-tree'), nodes);
  }

  function renderTreeGradually(targetEl, treeData){
    targetEl.innerHTML = '';
    const stats = { total:0 };
    const container = document.createDocumentFragment();

    const queue = [];
    const pushList = (nodes, parent)=>{ for (const n of nodes){ queue.push({ node:n, parent }); } };

    const createItem = (node)=>{
      const item = document.createElement('div'); item.className = 'gtt-node'; item.dataset.nodeId = node.id; item.dataset.sig = node.sig; item.title = node.id + '\n\n' + (node.text||'');
      if (node.role) item.dataset.role = node.role;
      if (node.chainIds) item._chainIds = node.chainIds;
      if (node.chainSigs) item._chainSigs = node.chainSigs;
      const badge = document.createElement('span'); badge.className='badge'; badge.textContent = node.role==='user'? 'U' : (node.role||'·'); badge.setAttribute('aria-hidden', 'true');
      const textWrap = document.createElement('div'); textWrap.className = 'text';
      const head = document.createElement('div'); head.className = 'head';
      const title = document.createElement('span'); title.className = 'title'; title.textContent = node.role==='user' ? '用户' : '助手';
      head.appendChild(title);
      if (node.children?.length){
        const meta = document.createElement('span'); meta.className='meta'; meta.textContent = `(${node.children.length})`;
        head.appendChild(meta);
      }
      const pv = document.createElement('span'); pv.className='pv'; pv.textContent = preview(node.text);
      textWrap.append(head, pv);
      item.append(badge, textWrap);
      item.addEventListener('click', ()=>jumpTo(node));
      return item;
    };

    // 根容器
    const rootDiv = document.createElement('div');
    container.appendChild(rootDiv);

    // 将根节点入队
    pushList(treeData, rootDiv);

    const step = () => {
      let cnt = 0;
      while (cnt < CONFIG.RENDER_CHUNK && queue.length){
        const { node, parent } = queue.shift();
        const item = createItem(node);
        parent.appendChild(item);
        stats.total++;
        if (node.children?.length){
          const kids = document.createElement('div'); kids.className='gtt-children'; parent.appendChild(kids);
          pushList(node.children, kids);
        }
        cnt++;
      }
      if (queue.length){ rafIdle(step); } else { targetEl.appendChild(container); updateStats(stats.total); applyCurrentBranchHighlight(targetEl); }
    };
    step();
  }

  function applyCurrentBranchHighlight(rootEl){
    const treeRoot = rootEl || $('#gtt-tree');
    if (!treeRoot) return;

    const nodeEls = treeRoot.querySelectorAll('.gtt-node');
    const connectorEls = treeRoot.querySelectorAll('.gtt-children');
    nodeEls.forEach(el => { el.classList.remove('gtt-current', 'gtt-current-leaf'); });
    connectorEls.forEach(el => el.classList.remove('gtt-current-line'));

    const hasBranch = (CURRENT_BRANCH_IDS?.size || 0) > 0 || (CURRENT_BRANCH_SIGS?.size || 0) > 0;
    if (!hasBranch) return;

    nodeEls.forEach(el => {
      const id = el.dataset?.nodeId;
      const sig = el.dataset?.sig;
      const chainIds = Array.isArray(el._chainIds) ? el._chainIds : null;
      const chainSigs = Array.isArray(el._chainSigs) ? el._chainSigs : null;
      const matchesId = id && CURRENT_BRANCH_IDS.has(id);
      const matchesSig = sig && CURRENT_BRANCH_SIGS.has(sig);
      const matchesChainId = chainIds ? chainIds.some(cid => CURRENT_BRANCH_IDS.has(cid)) : false;
      const matchesChainSig = chainSigs ? chainSigs.some(cs => CURRENT_BRANCH_SIGS.has(cs)) : false;
      const isCurrent = matchesId || matchesSig || matchesChainId || matchesChainSig;
      if (!isCurrent) return;
      el.classList.add('gtt-current');
      const isLeaf = (
        (CURRENT_BRANCH_LEAF_ID && (id === CURRENT_BRANCH_LEAF_ID || (chainIds && chainIds.includes(CURRENT_BRANCH_LEAF_ID)))) ||
        (CURRENT_BRANCH_LEAF_SIG && (sig === CURRENT_BRANCH_LEAF_SIG || (chainSigs && chainSigs.includes(CURRENT_BRANCH_LEAF_SIG))))
      );
      if (isLeaf){
        el.classList.add('gtt-current-leaf');
      }
      const parent = el.parentElement;
      if (parent?.classList?.contains('gtt-children')){
        parent.classList.add('gtt-current-line');
      }
    });
  }

  function updateStats(total){ const el = $('#gtt-stats'); if (el) el.textContent = total ? `节点：${total}` : ''; }

  function toggleCollapseAll(){ $$('.gtt-children').forEach(el=>el.classList.toggle('gtt-hidden')); }

  /** ================= 跳转 ================= **/
  const SCROLLABLE_VALUES = new Set(['auto','scroll','overlay']);
  function findScrollContainer(el){
    const rootSel = CONFIG.SELECTORS?.scrollRoot;
    if (rootSel){
      const root = document.querySelector(rootSel);
      if (root && root.contains(el) && root.scrollHeight > root.clientHeight + 8){
        return root;
      }
    }
    let cur = el.parentElement;
    while (cur && cur !== document.body){
      const style = getComputedStyle(cur);
      if ((SCROLLABLE_VALUES.has(style.overflowY) || SCROLLABLE_VALUES.has(style.overflow)) && cur.scrollHeight > cur.clientHeight + 8){
        return cur;
      }
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollToEl(el){
    const container = findScrollContainer(el);
    if (container && container !== document.body && container !== document.documentElement){
      const rect = el.getBoundingClientRect();
      const parentRect = container.getBoundingClientRect();
      const offset = rect.top - parentRect.top + container.scrollTop - CONFIG.SCROLL_OFFSET;
      container.scrollTo({ top: offset, behavior: 'smooth' });
    }else{
      const offset = el.getBoundingClientRect().top + window.scrollY - CONFIG.SCROLL_OFFSET;
      window.scrollTo({ top: offset, behavior:'smooth' });
    }
    el.classList.add('gtt-highlight');
    setTimeout(()=>el.classList.remove('gtt-highlight'), CONFIG.HIGHLIGHT_MS);
  }

  function locateByText(text){
    const snippet = normalize(text).slice(0,120);
    if (!snippet) return null;
    const blocks = $$(CONFIG.SELECTORS.messageBlocks);
    let best=null, score=-1;
    for (const el of blocks){
      const textEl = $(CONFIG.SELECTORS.messageText, el) || el;
      const t = normalize(textEl?.innerText || '');
      const idx = t.indexOf(snippet);
      if (idx>=0){ const sc = 3000 - idx + Math.min(120, snippet.length); if (sc > score){ score=sc; best=el; } }
    }
    return best;
  }

  function openModal(text, reason){
    $('#gtt-md-body').innerHTML = renderMarkdownLite(text);
    $('#gtt-md-title').textContent = reason || '节点预览（未能定位到页面元素，已为你展示文本）';
    $('#gtt-modal').style.display = 'flex';
  }
  function closeModal(){ $('#gtt-modal').style.display='none'; $('#gtt-md-body').innerHTML=''; }

  async function jumpTo(node){
    // 1) 直接用 messageId 命中
    let target = DOM_BY_ID.get(node.id);
    if (target && target.isConnected) return scrollToEl(target);

    // 2) 用内容签名命中（修复：mapping.id 与 DOM hash 不一致时）
    const sig = node.sig || makeSig(node.role, node.text);
    target = DOM_BY_SIG.get(sig);
    if (target && target.isConnected) return scrollToEl(target);

    // 3) 文本回退匹配
    target = locateByText(node.text);
    if (target) return scrollToEl(target);

    // 4) 仍未定位，但不武断声明“未在该分支”
    openModal(node.text || '(无文本)', '节点预览（未能定位到页面元素，已为你展示文本）');
  }

  /** ================= 监听 & 路由感知 ================= **/
  const mo = new MutationObserver(debounce(()=>{ harvestLinearNodes(); }, CONFIG.OBS_DEBOUNCE_MS));

  function hookHistory(){
    const _push = history.pushState; const _replace = history.replaceState;
    function fire(){ window.dispatchEvent(new Event('gtt:locationchange')); }
    history.pushState = function(){ const r = _push.apply(this, arguments); fire(); return r; };
    history.replaceState = function(){ const r = _replace.apply(this, arguments); fire(); return r; };
    window.addEventListener('popstate', fire);
  }

  function boot(){
    ensureFab(); ensurePanel();
    rebuildTree();
    mo.observe(document.body, {childList:true, subtree:true});

    hookHistory();
    let last = location.pathname;
    const onLocChange = async ()=>{
      if (location.pathname !== last){ last = location.pathname; await rebuildTree({forceFetch:true, hard:true}); }
    };
    window.addEventListener('gtt:locationchange', onLocChange);
    window.addEventListener('popstate', onLocChange);

    // 快捷键 Alt+T 切隐藏；Alt+M 最小化
    document.addEventListener('keydown', (e)=>{
      if (!e.altKey) return;
      if (e.key === 't' || e.key === 'T'){ e.preventDefault(); setHidden(!prefs.hidden); }
      if (e.key === 'm' || e.key === 'M'){ e.preventDefault(); setMinimized(!prefs.minimized); }
    });
  }

  async function rebuildTree(opts={}){
    ensureFab(); ensurePanel();
    if (opts.hard){ LAST_MAPPING=null; }
    const linearNodes = harvestLinearNodes(); // 先收集一次，确保 DOM_BY_SIG/ID 准备就绪
    if (opts.forceFetch || !LAST_MAPPING){ LAST_MAPPING = await fetchMapping(); }
    if (LAST_MAPPING) buildTreeFromMapping(LAST_MAPPING); else buildTreeFromLinear(linearNodes);
  }

  // 初始等待 main 出现
  const t = setInterval(()=>{ if (document.querySelector('main')){ clearInterval(t); boot(); } }, 300);

})();
