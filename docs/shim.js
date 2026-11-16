/* Stand-in for the Claude dashboard runtime, so the same app.js runs as a plain web page.
   Provides the parts of `dash` that app.js uses: data, calc, draw, onData, params, colors. */
(() => {
  const FILES = ['schools', 'subject_entries', 'area_groups', 'national_subjects', 'la_boundaries'];
  const JSON_FILES = ['la_boundaries'];
  const store = {}, calcs = {}, draws = {}, listeners = [];
  let params = {}, failed = false, lastPlace = null;

  function runDraw(name) {
    const fn = draws[name];
    if (!fn) return;
    document.querySelectorAll(`[data-draw="${name}"]`).forEach((el) => {
      if (el.closest('[hidden]')) return;
      try { fn(el); } catch (err) { console.error('draw ' + name, err); }
    });
  }
  function run() {
    for (const id in calcs) delete calcs[id].value;
    listeners.forEach((fn) => { try { fn(); } catch (err) { console.error(err); } });
    Object.keys(draws).forEach(runDraw);
  }

  window.dash = {
    colors: ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'],
    data(id) {
      if (FILES.includes(id)) {
        if (store[id]) return { status: 'ok', data: store[id] };
        return { status: failed ? 'error' : 'loading', data: [] };
      }
      const c = calcs[id];
      if (!c) return { status: 'missing', data: null };
      const inputs = c.inputs.map((i) => dash.data(i));
      if (inputs.some((i) => i.status !== 'ok')) return { status: inputs.find((i) => i.status !== 'ok').status, data: null };
      if (!('value' in c)) c.value = c.fn(...inputs.map((i) => i.data));
      return { status: 'ok', data: c.value };
    },
    calc(id, def) { calcs[id] = def; },
    draw(name, fn) { if (fn) draws[name] = fn; else runDraw(name); },
    onData(fn) { listeners.push(fn); },
    params: () => ({ ...params }),
    setParams(next) { params = { ...params, ...next }; run(); },
    resetParams() { params = {}; run(); },
    setLink(name) {
      // Redraw only when the tab changes; filter changes have already been drawn.
      const place = String(name).split('--')[0];
      history.replaceState(null, '', '#' + name);
      if (place !== lastPlace) { lastPlace = place; run(); }
    },
    refresh() {},
  };

  // Empty CSV cells become null, as they do in the dashboard runtime.
  const clean = (row) => { for (const k in row) if (row[k] === '') row[k] = null; return row; };
  // The version changes whenever the data does, so browsers never reuse an old copy.
  const version = window.KX_DATA_VERSION ? '?v=' + window.KX_DATA_VERSION : '';
  const load = (id) => (JSON_FILES.includes(id) ? d3.json(`data/${id}.json${version}`) : d3.csv(`data/${id}.csv${version}`, clean));
  Promise.all(FILES.map((id) => load(id).then((rows) => { store[id] = rows; })))
    .catch((err) => { failed = true; console.error(err); })
    .then(run);

  let timer, width = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === width) return;
    width = window.innerWidth;
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  });
  window.addEventListener('DOMContentLoaded', run);
})();
