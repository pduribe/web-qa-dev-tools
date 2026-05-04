(function GA4_SectionScanner_TwoHits_EPAction(){
  if (window.__GA4SS__ && typeof window.__GA4SS__.destroy === 'function') { try{ window.__GA4SS__.destroy(); }catch(e){} }
  const API = {}; window.__GA4SS__ = API;

  /* ==== CONFIG ==== */
  const GA_HOSTS = ['analytics.google.com','google-analytics.com'];
  const GA_PATH  = '/g/collect';
  const WAIT_MS  = 1500;
  const MAX_CTAS = 400;
  const CTA_SEL  = 'a[href], button, [role="button"], .cta, [data-cta], [data-analytics]';

  // GA4 filters
  const REQUIRE_TID = 'G-J4F3Q27YH0'; // '' to disable
  const LIMIT_TO_EVENTS = new Set(['select_content','promotion_click']); // Set() to allow any
  const REQUIRE_SAME_PAGE = true;
  const ACCEPT_EP_PAGE_URL = true;
  const REQUIRE_PROMO_SEMANTIC = false;
  const REQUIRE_TWO_EVENTS = true;

  /* ==== STATE ==== */
  let running = false, suppressNav = false, pickMode = false, hoverBox = null;
  const hits = [], results = [];
  let dupMap = new Map(); // promoId -> indices[]
  let dupSet = new Set(); // indices that are duplicates

  /* ==== HELPERS ==== */
  const norm = s => (s || '').toLowerCase().trim();
  const decodeParam = v => { try { return decodeURIComponent(v); } catch { return v; } };

  function isGA4(url){
    try{
      const u = new URL(url, location.origin);
      return GA_HOSTS.some(h => u.hostname.includes(h)) &&
             u.pathname.startsWith(GA_PATH) &&
             u.searchParams.get('v') === '2';
    } catch {
      return false;
    }
  }

  function parseQ(url){
    try { return Object.fromEntries(new URL(url).searchParams.entries()); }
    catch { return {}; }
  }

  const nonEmpty = v => v != null && String(v).trim() !== '';

  function describe(el){
    if (!el) return '';
    const tag = el.tagName?.toLowerCase?.() || 'elem';
    const id  = el.id ? `#${el.id}` : '';
    const cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\s+/).join('.')
      : '';
    return `${tag}${id}${cls}`.trim() || tag;
  }

  function getHref(el){
    const a = el.closest?.('a[href]') || (el.tagName === 'A' ? el : null);
    return a ? (a.href || a.getAttribute('href') || '') : '';
  }

  function getText(el){
    return (el.getAttribute?.('aria-label') || el.textContent || el.title || '')
      .trim()
      .replace(/\s+/g,' ')
      .slice(0,160);
  }

  /* ==== PROMO HELPERS ==== */
  function getPromoCarrier(el){
    const a = el.closest?.('a[href]') || (el.tagName === 'A' ? el : null);
    return a || el;
  }

  function getPromoFromNode(node){
    if (!(node instanceof HTMLElement)) return '';
    const cand = [
      node.getAttribute('data-promo_id'),
      node.getAttribute('data-promo-id'),
      node.getAttribute('data-promoid'),
      node.getAttribute('data-promoId'),
    ].find(v => v != null && String(v).trim() !== '');
    return (cand || '').trim();
  }

  function hasPromoImpressionTrue(node){
    return !!(
      node instanceof HTMLElement &&
      node.getAttribute('data-promo_impression') === 'true'
    );
  }

  function findPromoImpression(node){
    if (!(node instanceof HTMLElement)) {
      return { found: false, source: 'none', sourceEl: null };
    }

    // 1) self
    if (hasPromoImpressionTrue(node)) {
      return { found: true, source: 'self', sourceEl: node };
    }

    // 2) direct parent only
    const parent = node.parentElement;
    if (hasPromoImpressionTrue(parent)) {
      return { found: true, source: 'direct-parent', sourceEl: parent };
    }

    // 3) nested div only
    const childMatch = node.querySelector('div[data-promo_impression="true"]');
    if (childMatch) {
      return { found: true, source: 'child-div', sourceEl: childMatch };
    }

    return { found: false, source: 'none', sourceEl: null };
  }

  function getPromoInfo(el){
    const start = getPromoCarrier(el);
    const impression = findPromoImpression(start);

    // 1) check start node
    let promoId = getPromoFromNode(start);
    if (promoId) {
      return {
        promoId,
        source: 'self',
        sourceEl: start,
        promoImpressionFound: impression.found,
        promoImpressionSource: impression.source,
        promoImpressionEl: impression.sourceEl
      };
    }

    // 2) check nearest ancestor with any promo attr
    const carrier = start.closest?.('[data-promo_id],[data-promo-id],[data-promoid],[data-promoId]');
    if (carrier) {
      promoId = getPromoFromNode(carrier);
      if (promoId) {
        const ancestorImpression = findPromoImpression(carrier);
        return {
          promoId,
          source: 'ancestor',
          sourceEl: carrier,
          promoImpressionFound: ancestorImpression.found || impression.found,
          promoImpressionSource: ancestorImpression.found ? ancestorImpression.source : impression.source,
          promoImpressionEl: ancestorImpression.found ? ancestorImpression.sourceEl : impression.sourceEl
        };
      }
    }

    return {
      promoId: '',
      source: 'none',
      sourceEl: null,
      promoImpressionFound: impression.found,
      promoImpressionSource: impression.source,
      promoImpressionEl: impression.sourceEl
    };
  }

  function samePage(o){
    if (!REQUIRE_SAME_PAGE) return true;
    const hereKey = (u) => {
      try{
        const x = new URL(u);
        return x.origin + x.pathname.replace(/\/$/,'');
      } catch {
        return '';
      }
    };
    const cur = hereKey(location.href);
    const dl  = hereKey(decodeParam(o.q.dl || ''));
    const epu = hereKey(decodeParam(o.q['ep.page_url'] || ''));
    return (dl && dl === cur) || (ACCEPT_EP_PAGE_URL && epu && epu === cur);
  }

  function passesPromoSemantic(o){
    if (!REQUIRE_PROMO_SEMANTIC) return true;
    const enOK = o.q.en === 'promotion_click';
    const epOK = norm(o.q['ep.event_name']) === 'promotion_click';
    return enOK || epOK;
  }

  /* ==== UI ==== */
  const ui = document.createElement('div');
  ui.id = 'ga4ss-panel';
  ui.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;width:980px;max-height:66vh;overflow:auto;background:#111;color:#eee;border:1px solid #444;border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.35);font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial';
  ui.innerHTML = `
    <div style="padding:10px 12px;display:flex;gap:8px;align-items:center;border-bottom:1px solid #2a2a2a;flex-wrap:wrap">
      <strong style="font-size:13px;">GA4 CTA Scan — 2 hits & one has <code>ep.action</code> + flag duplicate <code>data-promo_id</code> + validate <code>data-promo_impression="true"</code></strong>
      <input id="ga4ss-in" placeholder=".your-container" style="flex:1;min-width:220px;background:#222;color:#eee;border:1px solid #555;border-radius:6px;padding:6px 8px">
      <button id="ga4ss-discover" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:6px;padding:6px 10px;cursor:pointer">Discover</button>
      <button id="ga4ss-pick" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:6px;padding:6px 10px;cursor:pointer">Pick</button>
      <button id="ga4ss-run" style="background:#3b7cff;color:#fff;border:1px solid #2463ff;border-radius:6px;padding:6px 12px;cursor:pointer">Run</button>
      <button id="ga4ss-csv" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:6px;padding:6px 10px;cursor:pointer">CSV</button>
      <button id="ga4ss-close" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:6px;padding:6px 10px;cursor:pointer">✕</button>
      <div id="ga4ss-status" style="width:100%;opacity:.85;margin-top:6px">Enter a container, discover, or pick.</div>
      <div id="ga4ss-bar" style="width:100%;height:6px;background:#222;border-radius:4px;overflow:hidden;margin:6px 0"><div class="fill" style="height:100%;width:0;background:#3b7cff;transition:width .2s linear"></div></div>
      <div id="ga4ss-total" style="opacity:.8"></div>
    </div>
    <div id="ga4ss-list" style="max-height:240px;overflow:auto;display:none;border-bottom:1px solid #2a2a2a"></div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#1b1b1b">
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">#</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">Element</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">Text</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">Promo ID</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">Promo Source</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">Href</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">Result</th>
        <th style="text-align:left;padding:6px;border-bottom:1px solid #333;">Notes</th>
      </tr></thead>
      <tbody id="ga4ss-rows"></tbody>
    </table>
  `;
  document.documentElement.appendChild(ui);

  const $ = s => ui.querySelector(s);
  const inputEl  = $('#ga4ss-in');
  const listEl   = $('#ga4ss-list');
  const rowsEl   = $('#ga4ss-rows');
  const statusEl = $('#ga4ss-status');
  const barFill  = $('#ga4ss-bar .fill');
  const totalEl  = $('#ga4ss-total');

  /* ==== Network instrumentation (restorable) ==== */
  const restore = {
    fetch: window.fetch,
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    beacon: navigator.sendBeacon
  };

  function pushHit(url){
    if (url && isGA4(url)) hits.push({ t: performance.now(), url });
  }

  window.fetch = function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    pushHit(url);
    return restore.fetch.apply(this, arguments);
  };

  XMLHttpRequest.prototype.open = function(method, url){
    this.__ga4ss_url = url;
    return restore.open.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body){
    try{
      if (this.__ga4ss_url) this.addEventListener('loadstart', () => pushHit(this.__ga4ss_url));
    } catch {}
    return restore.send.apply(this, arguments);
  };

  if (restore.beacon) {
    navigator.sendBeacon = function(url, data){
      pushHit(url);
      return restore.beacon.call(navigator, url, data);
    };
  }

  /* ==== Nav suppression ==== */
  function navBlock(e){
    if (!suppressNav) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && !a.target) e.preventDefault();
  }
  document.addEventListener('click', navBlock, true);

  /* ==== Discover Containers ==== */
  function discoverContainers(){
    const candSel = ['section','main','header','footer','aside','div[id]','div[class]','[data-module]','[data-section]','[data-component]','[data-cta-container]'].join(',');
    const all = Array.from(document.querySelectorAll(candSel));
    const seen = new Set();
    const items = [];

    for (const el of all){
      if (!(el instanceof HTMLElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 60) continue;
      const ctas = el.querySelectorAll(CTA_SEL);
      if (!ctas.length) continue;
      const key = describe(el);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ el, key, count: ctas.length, area: Math.round(r.width * r.height) });
    }

    items.sort((a,b) => (b.count - a.count) || (b.area - a.area));
    listEl.style.display = '';
    listEl.innerHTML = items.slice(0,80).map((o,i) => `
      <div data-idx="${i}" style="display:flex;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid #222;">
        <div style="min-width:40px;opacity:.8">${o.count}</div>
        <code style="flex:1">${o.key}</code>
        <button data-pick="${i}" style="background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:6px;padding:4px 8px;cursor:pointer">Use</button>
      </div>`).join('') || `<div style="padding:10px 12px;opacity:.8">No container candidates with CTAs found.</div>`;

    listEl.onclick = (e) => {
      const btn = e.target.closest && e.target.closest('[data-pick]');
      if (!btn) return;
      const idx = Number(btn.getAttribute('data-pick'));
      const chosen = items[idx];
      if (!chosen) return;
      inputEl.value = chosen.key;
      listEl.style.display = 'none';
      listEl.innerHTML = '';
      statusEl.textContent = `Selected container: ${inputEl.value}`;
    };

    statusEl.textContent = `Found ${items.length} container candidates. Click "Use" to select.`;
  }

  /* ==== Pick on Page ==== */
  function ensureHoverBox(){
    if (hoverBox) return hoverBox;
    hoverBox = document.createElement('div');
    hoverBox.style.cssText = 'position:absolute;pointer-events:none;border:2px dashed #00d084;background:rgba(0,208,132,.08);z-index:2147483646';
    document.body.appendChild(hoverBox);
    return hoverBox;
  }

  function candidateFromTarget(t){
    if (!(t instanceof HTMLElement)) return null;
    let el = t;
    for (let i = 0; i < 6 && el && el !== document.body && el !== document.documentElement; i++){
      const tag = el.tagName.toLowerCase();
      const hasId = !!el.id;
      const hasClass = (typeof el.className === 'string' && !!el.className.trim());
      const hasData = [...el.attributes].some(a => a.name.startsWith('data-'));
      if (['section','main','aside','header','footer'].includes(tag) || hasId || hasClass || hasData) break;
      el = el.parentElement;
    }
    return el || t;
  }

  function moveHandler(e){
    if (!pickMode) return;
    const el = candidateFromTarget(e.target);
    if (!el) return;
    const r = el.getBoundingClientRect();
    ensureHoverBox();
    Object.assign(hoverBox.style, {
      display: 'block',
      left: (window.scrollX + r.left) + 'px',
      top: (window.scrollY + r.top) + 'px',
      width: r.width + 'px',
      height: r.height + 'px'
    });
  }

  function pickHandler(e){
    if (!pickMode) return;
    e.preventDefault();
    e.stopPropagation();
    const el = candidateFromTarget(e.target);
    const key = describe(el);
    inputEl.value = key;
    stopPicker(`Selected container: ${key}`);
    listEl.style.display = 'none';
    listEl.innerHTML = '';
  }

  function keyHandler(e){
    if (e.key === 'Escape') stopPicker('Picker OFF');
  }

  function startPicker(){
    if (pickMode) return;
    pickMode = true;
    ensureHoverBox();
    statusEl.textContent = 'Picker ON: move to a section and click to select (Esc to cancel).';
    document.addEventListener('mousemove', moveHandler, true);
    document.addEventListener('click', pickHandler, true);
    document.addEventListener('keydown', keyHandler, true);
  }

  function stopPicker(msg = 'Picker OFF'){
    pickMode = false;
    statusEl.textContent = msg;
    document.removeEventListener('mousemove', moveHandler, true);
    document.removeEventListener('click', pickHandler, true);
    document.removeEventListener('keydown', keyHandler, true);
    if (hoverBox) hoverBox.style.display = 'none';
  }

  /* ==== Progress ==== */
  function setTotal(n){
    totalEl.textContent = n ? `Scanning 0 / ${n}` : '';
    barFill.style.width = '0%';
  }

  function updateProgress(i, total){
    totalEl.textContent = `Scanning ${i} / ${total}`;
    barFill.style.width = Math.min(100, Math.round(i * 100 / total)) + '%';
  }

  function computePromoDuplicates(ctas){
    dupMap = new Map();
    dupSet = new Set();

    ctas.forEach((el, idx0) => {
      const { promoId } = getPromoInfo(el);
      if (!promoId) return;
      const idx = idx0 + 1;
      if (!dupMap.has(promoId)) dupMap.set(promoId, []);
      dupMap.get(promoId).push(idx);
    });

    for (const [promoId, idxs] of dupMap.entries()){
      if (idxs.length >= 2) idxs.forEach(i => dupSet.add(i));
    }

    const dupGroups = [...dupMap.entries()].filter(([_, idxs]) => idxs.length >= 2);
    return {
      groups: dupGroups.map(([promoId, idxs]) => ({ promoId, idxs })),
      groupCount: dupGroups.length,
      ctaCount: dupSet.size
    };
  }

  /* ==== Run ==== */
  async function runScan(){
    if (running) return;

    const sel = (inputEl.value || '').trim();
    if (!sel){
      statusEl.textContent = 'Enter or pick a container first.';
      return;
    }

    const containers = Array.from(document.querySelectorAll(sel));
    if (!containers.length){
      statusEl.textContent = `No containers match "${sel}".`;
      return;
    }

    const ctas = Array.from(new Set(
      containers.flatMap(c => Array.from(c.querySelectorAll(CTA_SEL)))
    )).slice(0, MAX_CTAS);

    if (!ctas.length){
      statusEl.textContent = `No CTAs found within "${sel}".`;
      return;
    }

    stopPicker();
    rowsEl.innerHTML = '';
    results.length = 0;

    const dupInfo = computePromoDuplicates(ctas);
    const dupSummary = dupInfo.groupCount
      ? `⚠ ${dupInfo.groupCount} duplicate promo_id group(s) across ${dupInfo.ctaCount} CTA(s).`
      : `No duplicate promo_id values found.`;

    statusEl.textContent = `Scanning ${ctas.length} CTAs… ${dupSummary}`;
    setTotal(ctas.length);

    running = true;
    suppressNav = true;

    let i = 0;
    for (const el of ctas){
      i++;
      updateProgress(i - 1, ctas.length);

      const elemDesc = describe(el);
      const text = getText(el);
      const href = getHref(el);

      const promo = getPromoInfo(el);
      const promoId = promo.promoId;
      const promoSource =
        promo.source === 'self' ? 'self' :
        promo.source === 'ancestor' ? ('ancestor:' + describe(promo.sourceEl)) :
        'none';

      const promoImpressionStatus = promo.promoImpressionFound
        ? `true (${promo.promoImpressionSource}:${describe(promo.promoImpressionEl)})`
        : 'missing';

      const isDup = dupSet.has(i);

      const prevOutline = el.style.outline;
      el.style.outline = isDup ? '3px solid #ffb020' : '2px solid #4caf50';

      const startT = performance.now();
      const startIdx = hits.length;

      el.dispatchEvent(new MouseEvent('click', { view: window, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, WAIT_MS));

      const windowHits = hits.slice(startIdx)
        .filter(h => h.t >= startT - 5 && h.t <= startT + WAIT_MS + 200)
        .filter(h => isGA4(h.url))
        .map(h => ({ h, q: parseQ(h.url) }))
        .filter(o => !REQUIRE_TID || o.q.tid === REQUIRE_TID)
        .filter(o => !REQUIRE_SAME_PAGE || samePage(o))
        .filter(o => passesPromoSemantic(o))
        .filter(o => LIMIT_TO_EVENTS.size === 0 || LIMIT_TO_EVENTS.has(o.q.en));

        let gaPass = false, gaNote = '';

        if (!REQUIRE_TWO_EVENTS || windowHits.length >= 2) {
          for (const { q } of windowHits){
            const ep_action = (q['ep.action'] ?? q['ep%252Eaction'] ?? '').trim();
            if (nonEmpty(ep_action)){
              gaPass = true;
              gaNote = `${windowHits.length} event(s); ep.action="${ep_action}"`;
              break;
            }
          }
          if (!gaPass) gaNote = `${windowHits.length} event(s); none had a non-empty ep.action.`;
        } else {
          gaNote = `Only ${windowHits.length} GA4 hit(s); expected 2.`;
        }
  
        const promoImpressionPass = promo.promoImpressionFound === true;
  
        const pass = gaPass && promoImpressionPass;
  
        let notes = `promo_impression=${promoImpressionStatus} · ${gaNote}`;
        if (!promoImpressionPass) {
          notes = `INVALID promo_impression placement/missing · ${notes}`;
        }
        
      if (isDup){
        const idxs = (promoId && dupMap.get(promoId)) ? dupMap.get(promoId) : [];
        notes = `DUP promo_id="${promoId}" (CTAs: ${idxs.join(', ')}) · promo_impression=${promoImpressionStatus} · ${gaNote}`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${i}</td>
        <td title="${elemDesc}" style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${elemDesc}</td>
        <td title="${text}" style="max-width:230px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${text || '(no text)'}</td>
        <td title="${promoId}" style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isDup ? 'color:#ffb020;font-weight:700;' : ''}">${promoId || ''}${isDup ? ' (DUP)' : ''}</td>
        <td title="${promoSource}" style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.9">${promoSource}</td>
        <td title="${href}" style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${href || ''}</td>
        <td style="color:${pass ? '#5bd06b' : '#ff6b6b'}"><strong>${pass ? 'OK' : 'MISS'}</strong></td>
        <td>${notes}</td>`;
      rowsEl.appendChild(tr);

      results.push({
        index: i,
        element: elemDesc,
        text,
        promo_id: promoId,
        promo_source: promoSource,
        promo_impression: promoImpressionStatus,
        href,
        duplicate_promo_id: isDup ? 'YES' : 'NO',
        result: pass ? 'OK' : 'MISS',
        notes
      });

      el.style.outline = prevOutline || '';
      updateProgress(i, ctas.length);
    }

    suppressNav = false;
    running = false;
    statusEl.textContent = `Done. Tested ${results.length} CTAs within "${sel}". ${dupSummary}`;
  }

  /* ==== CSV ==== */
  function exportCSV(){
    const header = 'index,element,text,promo_id,promo_source,promo_impression,duplicate_promo_id,href,result,notes\n';
    const csv = header + results.map(r =>
      [
        r.index,
        r.element.replaceAll('"','""'),
        (r.text || '').replaceAll('"','""'),
        (r.promo_id || '').replaceAll('"','""'),
        (r.promo_source || '').replaceAll('"','""'),
        (r.promo_impression || '').replaceAll('"','""'),
        r.duplicate_promo_id,
        (r.href || '').replaceAll('"','""'),
        r.result,
        (r.notes || '').replaceAll('"','""')
      ].map(x => `"${x}"`).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type:'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ga4_twohits_epaction_dupe_promoid_parent_promimpression.csv';
    a.click();
  }

  /* ==== Wire + Cleanup ==== */
  $('#ga4ss-discover').onclick = discoverContainers;
  $('#ga4ss-pick').onclick = startPicker;
  $('#ga4ss-run').onclick = runScan;
  $('#ga4ss-csv').onclick = exportCSV;
  $('#ga4ss-close').onclick = () => API.destroy();

  function cleanupPicker(){
    document.removeEventListener('mousemove', moveHandler, true);
    document.removeEventListener('click', pickHandler, true);
    document.removeEventListener('keydown', keyHandler, true);
    if (hoverBox && hoverBox.parentNode) hoverBox.parentNode.removeChild(hoverBox);
    hoverBox = null;
    pickMode = false;
  }

  API.destroy = function destroy(){
    try{
      cleanupPicker();
      document.removeEventListener('click', navBlock, true);
      suppressNav = false;

      window.fetch = restore.fetch;
      XMLHttpRequest.prototype.open = restore.open;
      XMLHttpRequest.prototype.send = restore.send;
      if (navigator.sendBeacon && restore.beacon) navigator.sendBeacon = restore.beacon;

      if (ui && ui.parentNode) ui.parentNode.removeChild(ui);
    } catch(e){
      console.warn('[GA4SS] destroy error', e);
    }
    delete window.__GA4SS__;
    console.log('%cGA4 scanner destroyed','color:#ff6b6b');
  };

  console.log('%cGA4 CTA Scanner (two hits + ep.action + dupe promo_id + promo_impression validation) ready','background:#111;color:#5bd06b;padding:4px;border-radius:4px');
})();
