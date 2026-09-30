/*
 * UI regression diff — paste into the browser console on the running app.
 *
 * Records every element's computed style (47 properties) and box geometry for a
 * fixed list of views, then compares a later run against it. It is how the
 * Tailwind conversion was proven identical (18 views × 12 widths, plus opened
 * pickers and popovers). A screenshot comparison would have missed most of it.
 *
 *   await UIDiff.run('base')            // record, before a change
 *   await UIDiff.run('diff')            // compare, after it
 *   await UIDiff.run('diff', ['home'])  // only some views
 *
 * Baselines live in this origin's IndexedDB, so record and compare on the same
 * host:port. To compare against an older commit, serve that commit's frontend on
 * the same port (a `git worktree` + `npx vite --port 3333`), record, then switch
 * back. Set `localStorage.__W = 'w375:'` before a run to key baselines by width.
 *
 * Before trusting a result:
 * - Run 'base' then 'diff' with NO change. Anything not "identical" is noise
 *   (hover state, a slow load) and must be fixed first. Park the mouse off the
 *   nav; transitions are disabled by the harness itself.
 * - Confirm the change is actually live. A Vite dev server started before a
 *   PostCSS/Tailwind config existed serves stale CSS and diffs "identical".
 * - Views that only exist when opened (pickers, popovers) need their own
 *   states — the resting page cannot show them.
 *
 * Views find their controls by visible text or role, never by class, so the
 * same states work on markup before and after a restyle. Clicks here open
 * pickers and run the free local read-through; nothing spends or persists
 * beyond that. Use a development database.
 */
window.UIDiff = (() => {
  const PROPS = ['display', 'position', 'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily',
    'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform', 'textDecorationLine', 'whiteSpace',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom',
    'marginLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderTopStyle',
    'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderTopLeftRadius', 'borderBottomRightRadius',
    'boxShadow', 'gap', 'gridTemplateColumns', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
    'opacity', 'overflowX', 'overflowY', 'cursor', 'zIndex', 'objectFit', 'listStyleType', 'outlineStyle'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const snap = () => {
    const out = {};
    const walk = (el, path) => {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out[path] = PROPS.map((p) => cs[p]).join('|') + '#'
        + [r.x + scrollX, r.y + scrollY, r.width, r.height].map(Math.round).join(',');
      [...el.children].forEach((c, i) => walk(c, path + '/' + c.tagName + i));
    };
    walk(document.body, 'BODY');
    return out;
  };

  // Wait until the DOM has been quiet for `quiet` ms — a fixed delay let slow
  // views be snapshotted half-loaded and reported as differences.
  const settle = async (quiet = 600, max = 6000) => {
    let last = Date.now();
    const mo = new MutationObserver(() => { last = Date.now(); });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const start = Date.now();
    while (Date.now() - last < quiet && Date.now() - start < max) await sleep(100);
    mo.disconnect();
  };

  const click = (sel, text) => {
    const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim().startsWith(text));
    if (b) b.click();
    return !!b;
  };
  const nav = async (page) => { click('header nav button', page); await settle(); };
  const tab = (label) => click('main [role=tab]', label);

  const STATES = [
    ['home', () => nav('Home')],
    ['plan-parking', async () => { await nav('Plan'); tab('Parking lot'); }],
    ['plan-companies', async () => { await nav('Plan'); tab('Companies'); }],
    ['plan-campaigns', async () => { await nav('Plan'); tab('Campaigns'); }],
    ['plan-calendar', async () => { await nav('Plan'); tab('Calendar'); }],
    ['plan-training', async () => { await nav('Plan'); tab('Training'); }],
    ['create-plan', async () => { await nav('Create'); tab('Plan'); }],
    ['create-script', async () => { await nav('Create'); tab('Script'); }],
    ['create-segments', async () => { await nav('Create'); tab('Segments'); }],
    ['create-render', async () => { await nav('Create'); tab('Render'); }],
    ['create-edit', async () => { await nav('Create'); tab('Edit'); }],
    ['create-publish', async () => { await nav('Create'); tab('Publish'); }],
    ['cast-characters', async () => { await nav('Cast'); tab('Characters'); }],
    ['cast-presenters', async () => { await nav('Cast'); tab('Presenters'); }],
    ['cast-you', async () => { await nav('Cast'); tab('You'); }],
    ['cast-collaborators', async () => { await nav('Cast'); tab('Collaborators'); }],
    ['library', () => nav('Library')],
    ['settings', () => nav('Settings')],
    // Opened states: these components do not exist at rest. The names they
    // click are this workspace's data; adjust to whatever the dev database holds.
    ['open-cast-avatar-picker', async () => { await nav('Cast'); tab('Characters'); await settle(); click('main button', 'Ailsa Kitchen 1'); }],
    ['open-segments-cast-picker', async () => { await nav('Create'); tab('Segments'); await settle(); click('main button', 'Jingles the Jester'); }],
    ['open-template-picker', async () => {
      await nav('Plan'); tab('Campaigns'); await settle();
      [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'New')?.click();
      await settle(); click('button', 'A Template');
    }],
    ['open-calendar-add', async () => {
      await nav('Plan'); tab('Calendar'); await settle();
      document.querySelector('button[aria-label^="Put a production on"]')?.click();
    }],
    ['open-readthrough', async () => {
      await nav('Create'); tab('Segments'); await settle(); click('main button', 'Read aloud');
      const t = Date.now();
      while (!document.body.innerText.includes('spoken') && Date.now() - t < 20000) await sleep(250);
    }],
  ];

  const db = () => new Promise((res, rej) => {
    const q = indexedDB.open('uidiff', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('s');
    q.onsuccess = () => res(q.result);
    q.onerror = rej;
  });
  const put = async (k, v) => {
    const d = await db();
    await new Promise((res, rej) => {
      const t = d.transaction('s', 'readwrite');
      t.objectStore('s').put(v, k);
      t.oncomplete = res;
      t.onerror = rej;
    });
  };
  const get = async (k) => {
    const d = await db();
    return new Promise((res, rej) => {
      const q = d.transaction('s').objectStore('s').get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = rej;
    });
  };

  const run = async (mode, only) => {
    scrollTo(0, 0);
    if (!document.getElementById('__uidiff_notrans')) {
      const st = document.createElement('style');
      st.id = '__uidiff_notrans';
      st.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
      document.head.appendChild(st);
    }
    const report = {};
    for (const [name, go] of STATES) {
      if (only && !only.includes(name)) continue;
      await go();
      await settle();
      const now = snap();
      const key = (localStorage.__W || '') + name;
      if (mode === 'base') { await put(key, now); report[name] = `${Object.keys(now).length} elements`; continue; }
      const base = await get(key);
      if (!base) { report[name] = 'no baseline'; continue; }
      const diffs = [];
      for (const k of new Set([...Object.keys(base), ...Object.keys(now)])) {
        if (base[k] === now[k]) continue;
        if (!base[k] || !now[k]) { diffs.push({ k, change: base[k] ? 'removed' : 'added' }); continue; }
        const [bp, br] = base[k].split('#');
        const [np, nr] = now[k].split('#');
        const bv = bp.split('|');
        const nv = np.split('|');
        const props = PROPS.map((p, i) => (bv[i] !== nv[i] ? `${p}: ${bv[i]} -> ${nv[i]}` : null)).filter(Boolean);
        diffs.push({ k, props, rect: br !== nr ? `${br} -> ${nr}` : undefined });
      }
      // Elements whose own style changed first; pure knock-on moves after.
      report[name] = diffs.length
        ? { count: diffs.length, first: diffs.filter((d) => d.props?.length).slice(0, 8).concat(diffs.filter((d) => !d.props?.length).slice(0, 3)) }
        : 'identical';
    }
    return report;
  };

  return { run, snap };
})();
