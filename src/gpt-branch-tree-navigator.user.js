// ==UserScript==
// @name         GPT Branch Tree Navigator (Preview + Jump + Branch Switch) – TEST
// @namespace    jiaoling.tools.gpt.tree
// @version      1.3.1
// @description  树状分支 + 预览 + 一键跳转；跨分支自动切换（带鉴权）；支持最小化/隐藏与悬浮按钮恢复；快捷键 Alt+T / Alt+M；/ 聚焦搜索、Esc 关闭；拖拽移动面板；渐进式渲染；防抖监听；分支切换失败内嵌提示；修复：当前分支已渲染却被误判为“未在该分支”。
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
    AUTO_BRANCH_SWITCH_DEFAULT: true,
    FORCE_HARD_RELOAD_DEFAULT: false,
    LS_KEY: 'gtt_prefs_v3',
    RENDER_CHUNK: 120,           // 每批渲染多少个节点，避免长树卡顿
    RENDER_IDLE_MS: 12,          // 渲染批次之间的间隔
    OBS_DEBOUNCE_MS: 250,        // DOM 监听防抖
    REFRESH_DELAY_MS: 900,
    BRANCH_REFRESH_RETRIES: 4,
    SIG_TEXT_LEN: 200,           // 用于签名的前缀长度（文本）
    LOCATE_RETRIES: 5,           // 分支切换后重试定位次数
    LOCATE_RETRY_GAP_MS: 250,    // 每次重试间隔
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
      ],
      patch: `/backend-api/conversation/${cid}`
    })
  };

  /** ================= 样式 ================= **/
  const injectStyle = (css) => {
    try { GM_addStyle(css); } catch (_) {
      const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    }
  };

  injectStyle(`
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

    /* 最小化态：只显示标题栏 */
    #gtt-panel.gtt-min #gtt-body{display:none}

    /* 预览模态 */
    #gtt-modal{position:fixed;inset:0;z-index:1000000;background:rgba(0,0,0,.42);display:none;align-items:center;justify-content:center}
    #gtt-modal .card{max-width:880px;max-height:80vh;overflow:auto;background:var(--gtt-bg,#fff);border:1px solid var(--gtt-bd,#d0d7de);border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.25)}
    #gtt-modal .hd{display:flex;align-items:center;gap:8px;padding:10px;border-bottom:1px solid var(--gtt-bd,#d0d7de);background:var(--gtt-hd,#f6f8fa)}
    #gtt-modal .bd{padding:12px 16px;white-space:pre-wrap;font-size:14px;line-height:1.6}
    #gtt-modal .btn{border:1px solid var(--gtt-bd,#d0d7de);background:#fff;cursor:pointer;padding:4px 8px;border-radius:8px;font-size:12px}

    /* 悬浮恢复按钮（隐藏后出现） */
    #gtt-fab{
      position:fixed;right:12px;bottom:16px;z-index:999999;display:none;align-items:center;gap:8px;
      padding:8px 12px;border-radius:999px;border:1px solid var(--gtt-bd,#d0d7de);
      background:var(--gtt-bg,#fff);box-shadow:0 8px 28px rgba(0,0,0,.18);cursor:pointer
    }
    #gtt-fab .dot{width:8px;height:8px;border-radius:50%;background:#5865f2}
    #gtt-fab .txt{font-weight:600}

    /* 内嵌提示条 */
    #gtt-toast{position:fixed;right:16px;bottom:80px;z-index:1000001;display:none}
    #gtt-toast .msg{background:rgba(31,41,55,.96);color:#e5e7eb;padding:8px 12px;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18)}

    @media (prefers-color-scheme: dark){
      :root{--gtt-bg:#0b0e14;--gtt-hd:#0f131a;--gtt-bd:#2b3240;color-scheme:dark}
      #gtt-header .btn,#gtt-modal .btn,#gtt-fab{background:#0b0e14;color:#d1d7e0}
      .gtt-node:hover{background:rgba(120,152,255,.12)}
    }
  `);

  /** ================= 工具 ================= **/
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
  const log = (...a)=>console.debug('[GPT-Tree]', ...a);
  const logWarn = (...a)=>console.warn('[GPT-Tree]', ...a);
  const logError = (...a)=>console.error('[GPT-Tree]', ...a);
  const truncate = (s, len=200)=>{
    if (!s) return '';
    return s.length > len ? s.slice(0, len) + '…' : s;
  };
  const shortId = (id, len=8)=>{
    if (!id) return '(空)';
    return id.length > len ? id.slice(0, len) + '…' : id;
  };
  const hash = (s) => { let h=0; for (let i=0;i<s.length;i++) h=((h<<5)-h + s.charCodeAt(i))|0; return (h>>>0).toString(36); };
  const normalize = (s)=> (s||'').replace(/\u200b/g,'').replace(/\s+/g,' ').trim();
  const makeSig = (role, text)=> (role||'assistant') + '|' + hash(normalize(text).slice(0, CONFIG.SIG_TEXT_LEN));
  const getConversationId = () => (location.pathname.match(/\/c\/([a-z0-9-]{10,})/i)||[])[1]||null;
  const rafIdle = (fn, ms=CONFIG.RENDER_IDLE_MS) => setTimeout(fn, ms);
  const debounce = (fn, ms) => { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); } };

  /** ================= 状态持久化 ================= **/
  const defaults = {
    autoBranchSwitch: CONFIG.AUTO_BRANCH_SWITCH_DEFAULT,
    forceHardReload: CONFIG.FORCE_HARD_RELOAD_DEFAULT,
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
        if (auth && !LAST_AUTH){ LAST_AUTH = { Authorization: auth }; log('captured auth'); }
      }catch(_) {}
      const res = await origFetch(...args);
      try{
        const url = typeof input==='string' ? input : input?.url || '';
        if (/\/backend-api\/conversation\//.test(url)) {
          const clone = res.clone(); const json = await clone.json();
          if (json?.mapping) { LAST_RAW_JSON = json; LAST_MAPPING = json.mapping; buildTreeFromMapping(LAST_MAPPING); }
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
        if (j?.accessToken){ LAST_AUTH = { Authorization: `Bearer ${j.accessToken}` }; log('token via session'); return LAST_AUTH; }
      }
    }catch(_){ }
    return LAST_AUTH || {};
  }
  const withAuthHeaders = (extra={}) => ({ ...(LAST_AUTH||{}), ...extra });

  /** ================= 面板 + FAB + Toast ================= **/
  function ensureFab(){
    if ($('#gtt-fab')) return;
    const fab = document.createElement('div');
    fab.id = 'gtt-fab';
    fab.innerHTML = `<span class="dot"></span><span class="txt">GPT Tree</span>`;
    fab.addEventListener('click', ()=> setHidden(false));
    document.body.appendChild(fab);
  }

  function ensureToast(){
    if ($('#gtt-toast')) return;
    const t = document.createElement('div');
    t.id = 'gtt-toast';
    t.innerHTML = `<div class="msg" id="gtt-toast-msg"></div>`;
    document.body.appendChild(t);
  }
  function toast(txt, ms=2200){
    ensureToast();
    const el = $('#gtt-toast'); const msg = $('#gtt-toast-msg');
    msg.textContent = txt || '';
    el.style.display='block';
    clearTimeout(toast._t); toast._t=setTimeout(()=>{ el.style.display='none'; }, ms);
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
          <label><input type="checkbox" id="gtt-auto"> 允许切换分支</label>
          <label><input type="checkbox" id="gtt-hard"> 切分支后硬刷新兜底</label>
          <button class="btn" id="gtt-btn-openjson" title="调试：在新标签打开 mapping">调试</button>
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

    $('#gtt-btn-openjson').addEventListener('click', ()=>{
      if (!LAST_RAW_JSON) return alert('尚未获取 mapping');
      const blob = new Blob([JSON.stringify(LAST_RAW_JSON,null,2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank'); setTimeout(()=>URL.revokeObjectURL(url), 8000);
    });

    // 初始化偏好
    $('#gtt-auto').checked = prefs.autoBranchSwitch;
    $('#gtt-hard').checked = prefs.forceHardReload;
    $('#gtt-auto').addEventListener('change', e=>{ prefs.autoBranchSwitch = e.target.checked; savePrefs(); });
    $('#gtt-hard').addEventListener('change', e=>{ prefs.forceHardReload = e.target.checked; savePrefs(); });

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
  let LAST_MAPPING = null, LAST_LINEAR = [], LAST_RAW_JSON = null;
  let DOM_BY_SIG = new Map();  // 签名 -> 元素
  let DOM_BY_ID = new Map();   // messageId -> 元素
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
          if (j?.mapping){ LAST_RAW_JSON = j; return j.mapping; }
        }else{ log('GET mapping failed', u, r.status); }
      }catch(err){ log('GET mapping error', err); }
    }
    return null;
  }

  function getActiveNodeId(){
    const raw = LAST_RAW_JSON;
    if (!raw) return null;
    return raw.current_node
      || raw.current_node_id
      || raw.current_message
      || raw.current_leaf
      || raw?.conversation?.current_node
      || raw?.conversation?.current_message
      || null;
  }

  function isActiveBranch(targetId){
    if (!targetId) return false;
    const active = getActiveNodeId();
    if (!active) return false;
    if (active === targetId) return true;
    let cur = active;
    let guard = 0;
    while (cur && LAST_MAPPING && LAST_MAPPING[cur] && guard++ < 4096){
      cur = LAST_MAPPING[cur].parent;
      if (cur === targetId) return true;
    }
    return false;
  }

  function harvestLinearNodes(){
    const blocks = $$(CONFIG.SELECTORS.messageBlocks);
    const out = [];
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
      if (messageId) DOM_BY_ID.set(messageId, el);
    }
    LAST_LINEAR = out;
    return out;
  }

  /** ================= 构树与渲染 ================= **/
  const nodeText = (p)=> Array.isArray(p) ? p.join('\n') : (typeof p==='string' ? p : '');
  const preview = (t, n=CONFIG.PREVIEW_MAX_CHARS)=>{ const s=normalize(t); return s.length>n ? s.slice(0,n)+'…' : s; };

  // 识别“工具/系统”角色
  function isToolishRole(role){ return role === 'tool' || role === 'system' || role === 'function'; }
  function getRecText(rec){ const parts = rec?.message?.content?.parts ?? []; return Array.isArray(parts) ? parts.join('\n') : (typeof parts === 'string' ? parts : ''); }
  function isVisibleRec(rec){ if (!rec) return false; const role = rec?.message?.author?.role || 'assistant'; if (isToolishRole(role)) return false; const text = getRecText(rec); return !!normalize(text); }
  function visibleParentId(mapping, id){ let cur = id, guard = 0; while (guard++ < 4096){ const p = mapping[cur]?.parent; if (p == null) return null; const pr = mapping[p]; if (isVisibleRec(pr)) return p; cur = p; } return null; }
  function dedupBySig(ids, mapping){ const seen = new Set(); const out = []; for (const cid of ids){ const rec = mapping[cid]; if (!rec) continue; const role = rec?.message?.author?.role || 'assistant'; const text = normalize(getRecText(rec)); const sig = makeSig(role, text); if (!seen.has(sig)){ seen.add(sig); out.push(cid); } } return out; }

  function buildTreeFromMapping(mapping){
    const byId = mapping;
    const visibleIds = Object.keys(byId).filter(id => isVisibleRec(byId[id]));

    const parentMap = new Map();
    for (const vid of visibleIds){ parentMap.set(vid, visibleParentId(byId, vid)); }

    const childrenMap = new Map(visibleIds.map(id => [id, []]));
    for (const vid of visibleIds){ const p = parentMap.get(vid); if (p && childrenMap.has(p)) childrenMap.get(p).push(vid); }
    for (const [pid, arr] of childrenMap.entries()){ childrenMap.set(pid, dedupBySig(arr, byId)); }

    const roots = visibleIds.filter(id => parentMap.get(id) == null);

    function foldSameRoleChain(startId){
      let cur = startId; let rec = byId[cur]; let role = rec?.message?.author?.role || 'assistant'; let text = getRecText(rec); let guard = 0;
      while (guard++ < 4096){
        const kids = childrenMap.get(cur) || [];
        if (kids.length !== 1) break;
        const k = kids[0]; const kRec = byId[k]; const kRole = kRec?.message?.author?.role || 'assistant'; const kText = getRecText(kRec);
        if (kRole === role && kText && text){ text = (text + '\n' + kText).trim(); cur = k; } else { break; }
      }
      return { id: cur, role, text };
    }

    const toNode = (id) => {
      const folded = foldSameRoleChain(id); const curId = folded.id; const curRole = folded.role; const curText = folded.text;
      const kidIds = childrenMap.get(curId) || [];
      const childrenNodes = kidIds.map(toNode).filter(Boolean);
      const sig = makeSig(curRole, curText);
      return { id: curId, role: curRole, text: curText, sig, children: childrenNodes };
    };

    const tree = roots.map(toNode).filter(Boolean);
    renderTreeGradually($('#gtt-tree'), tree);
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
      const badge = document.createElement('span'); badge.className='badge'; badge.textContent = node.role==='user'? 'U' : (node.role||'·');
      const title = document.createElement('span'); title.textContent = node.role==='user' ? '用户' : '助手';
      const meta = document.createElement('span'); meta.className='meta'; meta.textContent = node.children?.length ? `(${node.children.length})` : '';
      const pv = document.createElement('span'); pv.className='pv'; pv.textContent = preview(node.text);
      item.append(badge,title,meta,pv); item.addEventListener('click', ()=>jumpTo(node));
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
      if (queue.length){ rafIdle(step); } else { targetEl.appendChild(container); updateStats(stats.total); }
    };
    step();
  }

  function updateStats(total){ const el = $('#gtt-stats'); if (el) el.textContent = total ? `节点：${total}` : ''; }

  function toggleCollapseAll(){ $$('.gtt-children').forEach(el=>el.classList.toggle('gtt-hidden')); }

  /** ================= 跳转 & 分支切换 ================= **/
  function scrollToEl(el){ const offset = el.getBoundingClientRect().top + window.scrollY - CONFIG.SCROLL_OFFSET; window.scrollTo({top: offset, behavior:'smooth'}); el.classList.add('gtt-highlight'); setTimeout(()=>el.classList.remove('gtt-highlight'), CONFIG.HIGHLIGHT_MS); }

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
    $('#gtt-md-body').textContent = normalize(text) || '(空)';
    $('#gtt-md-title').textContent = reason || '节点预览（未能定位到页面元素，已为你展示文本）';
    $('#gtt-modal').style.display = 'flex';
  }
  function closeModal(){ $('#gtt-modal').style.display='none'; $('#gtt-md-body').textContent=''; }

  function deepestLeafId(startId){ if (!LAST_MAPPING || !startId) return startId; let cur = startId, lastGood = startId, guard=0; while (guard++ < 4096){ const rec = LAST_MAPPING[cur]; if (!rec || !rec.children || rec.children.length===0) break; const children = rec.children.filter(id=>!!LAST_MAPPING[id]); const kidsWithMsg = children.filter(id=>{ const m = LAST_MAPPING[id]?.message?.content?.parts; const text = nodeText(m); return normalize(text); }); const pickAssistant = (ids)=> ids.find(id => (LAST_MAPPING[id]?.message?.author?.role||'')==='assistant'); let next = pickAssistant(kidsWithMsg) || kidsWithMsg[0] || pickAssistant(children) || children[0]; if (!next) break; lastGood = next; cur = next; } return lastGood; }

  async function trySwitchBranch(nodeId){
    const cid = getConversationId();
    if (!cid) return false;

    await ensureAuth();
    const url = CONFIG.ENDPOINTS(cid).patch;
    const targetId = deepestLeafId(nodeId) || nodeId;

    const payloads = [
      { current_node: targetId },
      { current_message: targetId },
      { conversation_id: cid, current_node: targetId },
      { conversation_id: cid, current_message: targetId },
      { current_node: { message_id: targetId } }
    ];

    let patched = false;
    let lastStatus = null;
    let lastText = '';
    let failureReason = '';

    for (const payload of payloads){
      try{
        const res = await origFetch(url, {
          method: 'PATCH',
          credentials: 'include',
          headers: withAuthHeaders({'content-type':'application/json'}),
          body: JSON.stringify(payload)
        });
        lastStatus = res.status;
        log('尝试 PATCH 分支 ->', res.status, 'payload keys=', Object.keys(payload));
        if (!res.ok){
          try{ lastText = await res.text(); }catch(_){ }
          failureReason = `接口返回 ${res.status}${lastText ? `：${truncate(lastText, 300)}` : ''}`;
          continue;
        }
        patched = true;
        break;
      }catch(err){
        failureReason = err?.message || String(err);
        log('PATCH error', err);
      }
    }

    if (!patched){
      if (!failureReason){
        failureReason = lastStatus ? `接口返回 ${lastStatus}${lastText ? `：${truncate(lastText, 300)}` : ''}` : '未知错误';
      }
      log('分支切换 PATCH 失败，status=', lastStatus, 'body=', lastText);
      logError('分支切换失败：', failureReason);
      return false;
    }

    let refreshed = false;
    let gotMapping = false;
    let lastActiveId = null;
    let hasTargetInMapping = false;
    let fetchFailedCount = 0;
    for (let i=0;i<CONFIG.BRANCH_REFRESH_RETRIES;i++){
      await sleep(CONFIG.REFRESH_DELAY_MS);
      const mapping = await fetchMapping();
      if (mapping){
        gotMapping = true;
        LAST_MAPPING = mapping;
        harvestLinearNodes();
        const activeId = getActiveNodeId();
        if (activeId) lastActiveId = activeId;
        if (mapping[targetId]) hasTargetInMapping = true;
        const activeHit = isActiveBranch(targetId);
        log('刷新 mapping 第', i + 1, '次 -> 当前节点', shortId(activeId), '命中目标分支=', activeHit);
        if (activeHit){
          refreshed = true;
          break;
        }
      }else{
        fetchFailedCount++;
        logWarn('刷新 mapping 失败，重试中（第', i + 1, '次）');
      }
    }

    if (!refreshed){
      harvestLinearNodes();
      const parts = [];
      if (!gotMapping){
        parts.push('无法从接口获取最新分支信息');
      }else{
        if (!hasTargetInMapping){
          parts.push('刷新后的 mapping 中找不到目标节点');
        }
        if (lastActiveId){
          parts.push(`接口返回的当前节点为 ${shortId(lastActiveId)}`);
        }
      }
      if (fetchFailedCount){
        parts.push(`有 ${fetchFailedCount} 次刷新请求失败`);
      }
      const reason = parts.join('，') || '接口虽返回成功但未能确认分支切换';
      logError('分支切换后未能确认成功：' + reason);
      if (prefs.forceHardReload){
        logWarn('已启用强制刷新，页面即将重新载入。');
        location.reload();
      }
      return false;
    }

    return true;
  }

  async function reHarvestAndLocate(node){
    for (let i=0;i<CONFIG.LOCATE_RETRIES;i++){
      await sleep(CONFIG.LOCATE_RETRY_GAP_MS);
      harvestLinearNodes();
      const byId = DOM_BY_ID.get(node.id);
      if (byId && byId.isConnected) return byId;
      const bySig = DOM_BY_SIG.get(node.sig || makeSig(node.role, node.text));
      if (bySig && bySig.isConnected) return bySig;
      const byText = locateByText(node.text);
      if (byText) return byText;
    }
    logWarn('未能在页面定位到目标节点，ID=', shortId(node.id), '文本片段=', truncate(node.text, 80));
    return null;
  }

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

    // 4) 尝试切换分支后再定位
    if (prefs.autoBranchSwitch && LAST_MAPPING && node.id && !String(node.id).startsWith('lin-')){
      const ok = await trySwitchBranch(node.id);
      if (ok){
        const tgt = await reHarvestAndLocate(node);
        if (tgt) return scrollToEl(tgt);
        if (prefs.forceHardReload) return; // 交给硬刷新
      }
      // 分支切换失败或未找到
      openModal(node.text || '(无文本)', '节点预览（分支切换未成功或定位失败，已为你展示文本）');
      toast('未能自动切换到该分支，已显示预览。');
      return;
    }

    // 5) 仍未定位，但不武断声明“未在该分支”
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
    if (opts.hard){ LAST_MAPPING=null; LAST_LINEAR=[]; LAST_RAW_JSON=null; }
    harvestLinearNodes(); // 先收集一次，确保 DOM_BY_SIG/ID 准备就绪
    if (opts.forceFetch || !LAST_MAPPING){ LAST_MAPPING = await fetchMapping(); }
    if (LAST_MAPPING) buildTreeFromMapping(LAST_MAPPING); else buildTreeFromLinear(harvestLinearNodes());
  }

  // 初始等待 main 出现
  const t = setInterval(()=>{ if (document.querySelector('main')){ clearInterval(t); boot(); } }, 300);

})();
