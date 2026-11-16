/* KS4 Equity Explorer: drawing code.
   Runs inside the Claude "Data" dashboard type, which provides `d3` (v7) and `dash`.
   Static words live in index.html; this file only draws what the data decides. */
(() => {
  // ------------------------------------------------------------ config
  // a = comparison group, b = the group of interest; gap = a minus b.
  const CMP = {
    dis: { topic: 'Disadvantage', a: 'Not disadvantaged', b: 'Disadvantaged', ka: 'nondis', kb: 'dis' },
    sex: { topic: 'Sex', a: 'Girls', b: 'Boys', ka: 'girls', kb: 'boys' },
    eal: { topic: 'First language', a: 'English first language', b: 'EAL', ka: 'noneal', kb: 'eal' },
    sen: { topic: 'SEND', a: 'No SEND', b: 'SEND', ka: null, kb: null },
  };
  const DEFAULTS = { cmp: 'dis', stype: 'State mainstream', subject: 'Computer Science', band: 'pct_dis', sx: 'pct_dis', sy: 'uptake' };
  const NUMERIC = {
    schools: ['cohort', 'pct_girls', 'pct_dis', 'pct_eal', 'pct_sen', 'pct_ehcp', 'a8', 'a8_boys', 'n_boys', 'a8_girls', 'n_girls',
      'a8_dis', 'n_dis', 'a8_nondis', 'n_nondis', 'a8_eal', 'n_eal', 'a8_noneal', 'n_noneal', 'idaci'],
    subject_entries: ['entries', 'graded', 'points', 'n4', 'n7'],
    area_groups: ['pupils', 'a8'],
    national_subjects: ['cohort', 'entries', 'n4', 'n7'],
  };
  const AXIS_LABEL = {
    pct_dis: '% disadvantaged pupils', pct_eal: '% EAL pupils', pct_sen: '% pupils with SEND', pct_girls: '% girls',
    a8: 'Attainment 8 (whole school)', cohort: 'KS4 cohort size', uptake: 'Uptake (% of cohort)', grade: 'Average grade',
  };
  const f1 = d3.format('.1f'), f0 = d3.format(',.0f');
  const num = (v) => (v === '' || v == null ? NaN : +v);
  const params = () => ({ ...DEFAULTS, ...dash.params() });
  const C = (i) => dash.colors[i % dash.colors.length];

  // ------------------------------------------------------------ data access
  const typedCache = new Map();
  function get(id) {
    const d = dash.data(id);
    if (d.status !== 'ok') return { ok: false, status: d.status, rows: [] };
    if (!NUMERIC[id]) return { ok: true, rows: d.data };
    const hit = typedCache.get(id);
    if (hit && (hit.src === d.data || hit.len === d.data.length)) return { ok: true, rows: hit.rows };
    const cols = NUMERIC[id];
    const rows = d.data.map((r) => {
      const o = { ...r };
      for (const k of cols) o[k] = num(r[k]);
      if ('urn' in o) o.urn = String(o.urn);
      return o;
    });
    typedCache.set(id, { src: d.data, len: d.data.length, rows });
    return { ok: true, rows };
  }
  const derived = new Map();
  function memo(key, basis, make) {
    const hit = derived.get(key);
    if (hit && hit.basis === basis) return hit.value;
    const value = make();
    derived.set(key, { basis, value });
    return value;
  }
  const bySubject = (entries) => memo('bySubject', entries, () => d3.group(entries, (e) => e.subject));
  const schoolsOfType = (schools, stype) => memo('type:' + stype, schools, () => (stype === 'All' ? schools : schools.filter((s) => s.type === stype)));
  const latestYear = (rows) => memo('latest:' + rows.length, rows, () => d3.max(rows, (r) => r.year));
  const isVocational = (subject) => /\(vocational\)$/.test(subject);

  // ------------------------------------------------------------ calculations (shown to readers in Sources)
  dash.calc('national_latest', {
    title: 'England by pupil group, latest year',
    description: 'Average Attainment 8 and pupil numbers for each pupil group in state-funded schools, latest year.',
    inputs: ['area_groups'],
    fn: (area_groups) => {
      const national = area_groups.filter((r) => r.level === 'National');
      const year = national.reduce((m, r) => (r.year > m ? r.year : m), '');
      return national.filter((r) => r.year === year)
        .map((r) => ({ group: r.group, topic: r.topic, year: r.year, pupils: +r.pupils, a8: +r.a8 }));
    },
  });
  dash.calc('national_gaps', {
    title: 'Attainment 8 gaps between pupil groups, England',
    description: 'Gap in average Attainment 8 between each pair of pupil groups: group a minus group b.',
    inputs: ['national_latest'],
    fn: (national_latest) => {
      const pairs = [['dis', 'Not disadvantaged', 'Disadvantaged'], ['sex', 'Girls', 'Boys'],
        ['eal', 'English first language', 'EAL'], ['sen', 'No SEND', 'SEND']];
      const rows = Array.isArray(national_latest) ? national_latest : [];
      const find = (g) => rows.find((r) => r.group === g);
      return pairs.map(([cmp, a, b]) => {
        const ra = find(a), rb = find(b);
        if (!ra || !rb) return null;
        return { cmp, year: ra.year, group_a: a, group_b: b, a8_a: ra.a8, a8_b: rb.a8, pupils_a: ra.pupils, pupils_b: rb.pupils,
          gap: Math.round((ra.a8 - rb.a8) * 10) / 10 };
      }).filter(Boolean);
    },
  });
  dash.calc('subject_summary', {
    title: 'Offer, uptake and grades for the chosen subject',
    description: 'For the chosen subject and school type: schools entering pupils, entries as a share of the KS4 cohort, and grades.',
    inputs: ['schools', 'subject_entries'],
    fn: (schools, subject_entries) => {
      const p = dash.params();
      const subject = p.subject || 'Computer Science', stype = p.stype || 'State mainstream';
      const cohortOf = new Map();
      let nSchools = 0, cohort = 0;
      for (const s of schools) {
        if (stype !== 'All' && s.type !== stype) continue;
        const c = +s.cohort || 0;
        cohortOf.set(String(s.urn), c);
        nSchools += 1;
        cohort += c;
      }
      let offering = 0, offeringCohort = 0, entries = 0, graded = 0, points = 0, n4 = 0, vocational = false;
      for (const e of subject_entries) {
        if (e.subject !== subject) continue;
        const c = cohortOf.get(String(e.urn));
        if (c === undefined) continue;
        offering += 1;
        offeringCohort += c;
        entries += +e.entries || 0;
        graded += +e.graded || 0;
        points += +e.points || 0;
        n4 += +e.n4 || 0;
        if (e.qual === 'Vocational') vocational = true;
      }
      const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
      return [{
        subject, school_type: stype, schools: nSchools, offering, offer_pct: r1((100 * offering) / nSchools),
        cohort, entries, uptake_pct: r1((100 * entries) / cohort), uptake_offering_pct: r1((100 * entries) / offeringCohort),
        avg_grade: vocational || !graded ? null : r1(points / graded), pass_pct: graded ? r1((100 * n4) / graded) : null,
      }];
    },
  });

  // ------------------------------------------------------------ small helpers
  function text(name, sources, fn) {
    dash.draw(name, (el) => {
      const d = {};
      for (const s of sources) {
        const r = s in NUMERIC ? get(s) : (() => { const x = dash.data(s); return { ok: x.status === 'ok', rows: x.data }; })();
        if (!r.ok) { el.textContent = '—'; return; }
        d[s] = r.rows;
      }
      const v = fn(d, el);
      el.textContent = v == null || v === '' ? '—' : v;
    });
  }
  function chart(name, sources, fn) {
    dash.draw(name, (el) => {
      const d = {};
      let bad = null;
      for (const s of sources) { const r = get(s); if (!r.ok) bad = r.status; d[s] = r.rows; }
      el.replaceChildren();
      if (bad) { el.textContent = bad === 'error' ? 'Failed to load' : '—'; return; }
      fn(el, d);
      if (!el.firstChild) el.textContent = 'No data for this selection';
    });
  }
  function legend(el, items) {
    const box = document.createElement('div');
    box.className = 'kx-legend';
    for (const it of items) {
      const k = document.createElement('span');
      k.className = 'kx-key';
      const sw = document.createElement('span');
      sw.className = 'kx-swatch';
      sw.style.background = it.color;
      const lab = document.createElement('span');
      lab.textContent = it.name;
      k.append(sw, lab);
      box.append(k);
    }
    el.append(box);
  }
  function tipFor(el) {
    const t = document.createElement('div');
    t.className = 'kx-tip';
    t.hidden = true;
    el.append(t);
    return {
      show(event, title, lines) {
        t.replaceChildren();
        const h = document.createElement('div');
        h.className = 'kx-tip-title';
        h.textContent = title;
        t.append(h);
        for (const line of lines) {
          const row = document.createElement('div');
          row.className = 'kx-tip-sub';
          row.textContent = line;
          t.append(row);
        }
        t.hidden = false;
        const box = el.getBoundingClientRect();
        const x = event.clientX - box.left, y = event.clientY - box.top;
        const w = t.offsetWidth, hh = t.offsetHeight;
        let lx = x + 14;
        if (lx + w > box.width) lx = x - 14 - w;
        if (lx < 0) lx = 0;
        let ly = y - hh - 10;
        if (ly < 0) ly = y + 16;
        t.style.left = lx + 'px';
        t.style.top = ly + 'px';
      },
      hide() { t.hidden = true; },
    };
  }
  function svgIn(el, height, label) {
    const W = Math.max(260, el.clientWidth || 600);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${height}`)
      .attr('role', 'img').attr('aria-label', label);
    return { svg, W };
  }
  function textWidth(svg, strings) {
    const t = svg.append('text').attr('opacity', 0);
    let w = 0;
    for (const s of strings) { t.text(s); w = Math.max(w, t.node().getComputedTextLength() || String(s).length * 6.5); }
    t.remove();
    return Math.ceil(w);
  }
  function gridY(g, y, iw, ticks, fmt) {
    g.append('g').attr('class', 'kx-gridline').call(d3.axisLeft(y).ticks(ticks).tickSize(-iw).tickFormat(fmt || null))
      .call((s) => s.selectAll('.tick text').attr('x', -6));
  }
  function ols(pts) {
    const n = pts.length;
    if (n < 3) return null;
    const mx = d3.mean(pts, (p) => p.x), my = d3.mean(pts, (p) => p.y);
    let sxy = 0, sxx = 0, syy = 0;
    for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
    if (!sxx || !syy) return null;
    const slope = sxy / sxx;
    return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy) };
  }

  // ------------------------------------------------------------ chart forms
  function lineChart(el, { years, series, fmt, label }) {
    legend(el, series);
    const H = 260;
    const { svg, W } = svgIn(el, H, label);
    const narrow = W < 480; // the legend carries the names when there is no room for them at the line ends
    const ends = series.map((s) => (narrow ? '' : s.name + ' ') + fmt(s.values[s.values.length - 1].y));
    const all = series.flatMap((s) => s.values.map((v) => v.y));
    const lo = d3.min(all), hi = d3.max(all), pad = (hi - lo) * 0.15 || 1;
    const y = d3.scaleLinear().domain([Math.max(0, lo - pad), hi + pad]).nice(5);
    const m = { t: 10, r: Math.min(textWidth(svg, ends) + 12, W * 0.38), b: 26, l: textWidth(svg, y.ticks(5).map(fmt)) + 10 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    y.range([ih, 0]);
    const x = d3.scalePoint().domain(years).range([0, iw]).padding(0.1);
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    gridY(g, y, iw, 5, fmt);
    const step = Math.ceil(years.length / Math.max(2, Math.floor(iw / 62)));
    g.append('g').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickValues(years.filter((_, i) => (years.length - 1 - i) % step === 0)).tickSizeOuter(0));
    const line = d3.line().x((d) => x(d.x)).y((d) => y(d.y));
    const endY = series.map((s) => y(s.values[s.values.length - 1].y));
    if (series.length === 2 && Math.abs(endY[0] - endY[1]) < 14) {
      const mid = (endY[0] + endY[1]) / 2, up = endY[0] <= endY[1] ? 0 : 1;
      endY[up] = mid - 7; endY[1 - up] = mid + 7;
    }
    series.forEach((s, i) => {
      g.append('path').attr('d', line(s.values)).attr('fill', 'none').style('stroke', s.color).attr('stroke-width', 2);
      const last = s.values[s.values.length - 1];
      g.append('circle').attr('cx', x(last.x)).attr('cy', y(last.y)).attr('r', 4).style('fill', s.color)
        .style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
      g.append('text').attr('class', 'kx-strong').attr('x', x(last.x) + 9).attr('y', endY[i]).attr('dy', '0.32em').text(ends[i]);
    });
    const tip = tipFor(el);
    const rule = g.append('line').attr('class', 'kx-ref').attr('y1', 0).attr('y2', ih).attr('visibility', 'hidden');
    g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointermove', (event) => {
        const [px] = d3.pointer(event);
        const yr = d3.least(years, (v) => Math.abs(x(v) - px));
        rule.attr('x1', x(yr)).attr('x2', x(yr)).attr('visibility', 'visible');
        tip.show(event, yr, series.map((s) => { const v = s.values.find((d) => d.x === yr); return `${s.name}: ${v ? fmt(v.y) : 'n/a'}`; }));
      })
      .on('pointerleave', () => { rule.attr('visibility', 'hidden'); tip.hide(); });
  }

  function dumbbell(el, { rows, names, fmt, label }) {
    legend(el, [{ name: names[0], color: C(0) }, { name: names[1], color: C(1) }]);
    const rowH = 26, H = rows.length * rowH + 28;
    const { svg, W } = svgIn(el, H, label);
    const m = { t: 4, r: 34, b: 24, l: Math.min(textWidth(svg, rows.map((r) => r.label)) + 10, W * 0.45) };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = rows.flatMap((r) => [r.a, r.b]);
    const pad = (d3.max(vals) - d3.min(vals)) * 0.18 || 1;
    const x = d3.scaleLinear().domain([d3.min(vals) - pad, d3.max(vals) + pad]).range([0, iw]);
    const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([0, ih]).padding(0.2);
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    g.append('g').attr('class', 'kx-gridline').attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(iw / 70))).tickSize(-ih).tickFormat(fmt))
      .call((s) => s.selectAll('.tick text').attr('dy', '1.1em'));
    const tip = tipFor(el);
    const row = g.selectAll('g.row').data(rows).join('g').attr('class', 'row')
      .attr('transform', (d) => `translate(0,${y(d.label) + y.bandwidth() / 2})`);
    row.append('text').attr('class', 'kx-strong').attr('x', -10).attr('dy', '0.32em').attr('text-anchor', 'end').text((d) => d.label);
    row.append('line').attr('x1', (d) => x(d.a)).attr('x2', (d) => x(d.b)).style('stroke', 'var(--cds-chart-axis, var(--color-border-line))').attr('stroke-width', 2);
    row.append('circle').attr('cx', (d) => x(d.a)).attr('r', 5).style('fill', C(0)).style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
    row.append('circle').attr('cx', (d) => x(d.b)).attr('r', 5).style('fill', C(1)).style('stroke', 'var(--color-panel)').attr('stroke-width', 2);
    row.append('text').attr('x', (d) => x(Math.max(d.a, d.b)) + 10).attr('dy', '0.32em').text((d) => fmt(Math.max(d.a, d.b)));
    row.append('text').attr('x', (d) => x(Math.min(d.a, d.b)) - 10).attr('dy', '0.32em').attr('text-anchor', 'end')
      .text((d) => (x(Math.min(d.a, d.b)) > 34 ? fmt(Math.min(d.a, d.b)) : ''));
    row.append('rect').attr('x', -m.l).attr('y', -rowH / 2).attr('width', W).attr('height', rowH).attr('fill', 'transparent')
      .on('pointermove', (event, d) => tip.show(event, d.label, [`${names[0]}: ${fmt(d.a)}`, `${names[1]}: ${fmt(d.b)}`, `Gap: ${fmt(d.a - d.b)}`]))
      .on('pointerleave', () => tip.hide());
  }

  function scatter(el, { pts, xLabel, yLabel, diagonal, trend, xfmt, yfmt, label }) {
    if (!pts.length) return;
    const H = Math.min(420, Math.max(300, (el.clientWidth || 600) * 0.75));
    const { svg, W } = svgIn(el, H, label);
    let xd = d3.extent(pts, (p) => p.x), yd = d3.extent(pts, (p) => p.y);
    if (diagonal) { xd = yd = [Math.min(xd[0], yd[0]), Math.max(xd[1], yd[1])]; }
    const x = d3.scaleLinear().domain(xd).nice(), y = d3.scaleLinear().domain(yd).nice();
    const m = { t: 22, r: 12, b: 40, l: textWidth(svg, y.ticks(6).map(yfmt)) + 12 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    x.range([0, iw]); y.range([ih, 0]);
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    gridY(g, y, iw, 6, yfmt);
    g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(iw / 70))).tickFormat(xfmt).tickSizeOuter(0));
    svg.append('text').attr('x', m.l + iw / 2).attr('y', H - 6).attr('text-anchor', 'middle').text(xLabel);
    svg.append('text').attr('x', 0).attr('y', 12).text(yLabel);
    if (diagonal) {
      g.append('line').attr('class', 'kx-ref').attr('x1', x(xd[0])).attr('y1', y(xd[0])).attr('x2', x(x.domain()[1])).attr('y2', y(x.domain()[1]));
    }
    g.append('g').selectAll('circle').data(pts).join('circle').attr('cx', (p) => x(p.x)).attr('cy', (p) => y(p.y))
      .attr('r', pts.length > 1500 ? 2.2 : 3).style('fill', C(0)).attr('fill-opacity', pts.length > 1500 ? 0.4 : 0.55);
    if (trend) {
      const fit = ols(pts);
      if (fit) {
        const [x0, x1] = x.domain();
        const clampY = (v) => Math.max(y.domain()[0], Math.min(y.domain()[1], v));
        g.append('line').attr('x1', x(x0)).attr('x2', x(x1)).attr('y1', y(clampY(fit.intercept + fit.slope * x0)))
          .attr('y2', y(clampY(fit.intercept + fit.slope * x1))).style('stroke', C(1)).attr('stroke-width', 2);
        svg.append('text').attr('class', 'kx-strong').attr('x', W - m.r).attr('y', 12).attr('text-anchor', 'end')
          .text(`Linear fit, r = ${d3.format('.2f')(fit.r)} (${f0(pts.length)} schools)`);
      }
    }
    const tip = tipFor(el);
    const delaunay = d3.Delaunay.from(pts, (p) => x(p.x), (p) => y(p.y));
    const ring = g.append('circle').attr('r', 6).attr('fill', 'none').style('stroke', 'var(--color-fg)').attr('stroke-width', 2).attr('visibility', 'hidden');
    g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent')
      .on('pointermove', (event) => {
        const [px, py] = d3.pointer(event);
        const p = pts[delaunay.find(px, py)];
        if (!p || Math.hypot(x(p.x) - px, y(p.y) - py) > 30) { ring.attr('visibility', 'hidden'); tip.hide(); return; }
        ring.attr('cx', x(p.x)).attr('cy', y(p.y)).attr('visibility', 'visible');
        tip.show(event, p.name, [p.sub, ...p.lines]);
      })
      .on('pointerleave', () => { ring.attr('visibility', 'hidden'); tip.hide(); });
  }

  function histogram(el, { values, fmt, label, unit }) {
    if (!values.length) return;
    const H = 300;
    const { svg, W } = svgIn(el, H, label);
    const lo = d3.quantile(values, 0.005), hi = d3.quantile(values, 0.995);
    const x = d3.scaleLinear().domain([Math.min(lo, 0), Math.max(hi, 0)]).nice();
    const bins = d3.bin().domain(x.domain()).thresholds(x.ticks(28))(values.filter((v) => v >= x.domain()[0] && v <= x.domain()[1]));
    const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length)]).nice(4);
    const m = { t: 30, r: 10, b: 40, l: textWidth(svg, y.ticks(4).map(f0)) + 12 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    x.range([0, iw]); y.range([ih, 0]);
    const g = svg.append('g').attr('transform', `translate(${m.l},${m.t})`);
    gridY(g, y, iw, 4, f0);
    g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(Math.max(3, Math.floor(iw / 60))).tickSizeOuter(0));
    svg.append('text').attr('x', m.l + iw / 2).attr('y', H - 6).attr('text-anchor', 'middle').text(unit);
    const tip = tipFor(el);
    g.append('g').selectAll('rect').data(bins).join('rect')
      .attr('x', (b) => x(b.x0) + 1).attr('width', (b) => Math.max(1, x(b.x1) - x(b.x0) - 2))
      .attr('y', (b) => y(b.length)).attr('height', (b) => ih - y(b.length)).style('fill', C(0))
      .on('pointermove', (event, b) => tip.show(event, `${f0(b.length)} schools`, [`Gap of ${fmt(b.x0)} to ${fmt(b.x1)} points`]))
      .on('pointerleave', () => tip.hide());
    g.append('line').attr('class', 'kx-ref').attr('x1', x(0)).attr('x2', x(0)).attr('y1', 0).attr('y2', ih);
    const med = d3.median(values);
    g.append('line').attr('x1', x(med)).attr('x2', x(med)).attr('y1', -8).attr('y2', ih).style('stroke', 'var(--color-fg)').attr('stroke-width', 1.5);
    const right = x(med) < iw * 0.6;
    g.append('text').attr('class', 'kx-strong').attr('x', x(med) + (right ? 6 : -6)).attr('y', -12).attr('text-anchor', right ? 'start' : 'end')
      .text(`Median school ${fmt(med)}`);
  }

  function hbar(el, { rows, fmt, label, suffix }) {
    rows = rows.filter((r) => Number.isFinite(r.value));
    if (!rows.length) return;
    const rowH = 26, H = rows.length * rowH + 6;
    const { svg, W } = svgIn(el, H, label);
    const valW = textWidth(svg, rows.map((r) => fmt(r.value) + (suffix || ''))) + 8;
    const m = { l: Math.min(textWidth(svg, rows.map((r) => r.label)) + 10, W * 0.5), r: valW };
    const iw = W - m.l - m.r;
    const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => r.value) || 1]).range([0, iw]);
    const y = d3.scaleBand().domain(rows.map((r) => r.label)).range([0, H - 6]).padding(0.25);
    const g = svg.append('g').attr('transform', `translate(${m.l},0)`);
    const tip = tipFor(el);
    const row = g.selectAll('g').data(rows).join('g').attr('transform', (d) => `translate(0,${y(d.label)})`);
    row.append('text').attr('x', -8).attr('y', y.bandwidth() / 2).attr('dy', '0.32em').attr('text-anchor', 'end').text((d) => d.label);
    row.append('rect').attr('width', (d) => Math.max(1, x(d.value))).attr('height', y.bandwidth()).attr('rx', 3)
      .style('fill', (d) => (d.muted ? 'var(--cds-chart-muted, var(--color-fg-muted))' : C(0)));
    row.append('text').attr('class', 'kx-strong').attr('x', (d) => x(d.value) + 6).attr('y', y.bandwidth() / 2).attr('dy', '0.32em')
      .text((d) => fmt(d.value) + (suffix || ''));
    row.append('rect').attr('x', -m.l).attr('width', W).attr('height', y.step()).attr('fill', 'transparent')
      .on('pointermove', (event, d) => tip.show(event, d.label, d.lines || []))
      .on('pointerleave', () => tip.hide());
  }

  // ------------------------------------------------------------ headline words and tiles
  const gapRow = (rows, cmp) => rows.find((r) => r.cmp === cmp);
  const latestGroup = (rows, g) => rows.find((r) => r.group === g);
  text('t-year', ['national_gaps'], (d) => gapRow(d.national_gaps, 'dis')?.year);
  text('t-dis', ['national_latest'], (d) => { const r = latestGroup(d.national_latest, 'Disadvantaged'); return r && f1(r.a8); });
  text('t-nondis', ['national_latest'], (d) => { const r = latestGroup(d.national_latest, 'Not disadvantaged'); return r && f1(r.a8); });
  text('t-disgap', ['national_gaps'], (d) => { const r = gapRow(d.national_gaps, 'dis'); return r && f1(r.gap); });
  text('t-sexgap', ['national_gaps'], (d) => { const r = gapRow(d.national_gaps, 'sex'); return r && f1(r.gap); });

  for (const n of ['lab-a', 'lab-a2']) dash.draw(n, (el) => { el.textContent = CMP[params().cmp].a; });
  for (const n of ['lab-b', 'lab-b2']) dash.draw(n, (el) => { el.textContent = CMP[params().cmp].b; });
  const gapTile = (name, field, fmt) => text(name, ['national_gaps'], (d, el) => {
    const cmp = params().cmp;
    el.dataset.where = 'cmp=' + cmp;
    const r = gapRow(d.national_gaps, cmp);
    return r && fmt(r[field]);
  });
  gapTile('kpi-a', 'a8_a', f1);
  gapTile('kpi-b', 'a8_b', f1);
  gapTile('kpi-a-n', 'pupils_a', f0);
  gapTile('kpi-b-n', 'pupils_b', f0);
  gapTile('kpi-gap', 'gap', f1);
  text('kpi-ehcp', ['national_latest'], (d) => { const r = latestGroup(d.national_latest, 'EHC plan'); return r && f1(r.a8); });
  text('kpi-support', ['national_latest'], (d) => { const r = latestGroup(d.national_latest, 'SEN support'); return r && f1(r.a8); });

  // ------------------------------------------------------------ gaps page
  chart('gap-trend', ['area_groups'], (el, d) => {
    const c = CMP[params().cmp];
    const nat = d.area_groups.filter((r) => r.level === 'National' && r.topic === c.topic);
    const years = [...new Set(nat.map((r) => r.year))].sort();
    const series = [c.a, c.b].map((name, i) => ({
      name, color: C(i), values: nat.filter((r) => r.group === name).sort((p, q) => d3.ascending(p.year, q.year)).map((r) => ({ x: r.year, y: r.a8 })),
    })).filter((s) => s.values.length);
    if (series.length) lineChart(el, { years, series, fmt: f1, label: `Average Attainment 8 for ${c.a} and ${c.b}, England, by year` });
  });

  chart('gap-regions', ['area_groups'], (el, d) => {
    const c = CMP[params().cmp];
    const year = latestYear(d.area_groups);
    const reg = d.area_groups.filter((r) => r.level === 'Region' && r.year === year && r.topic === c.topic);
    const rows = d3.rollups(reg, (v) => ({ a: v.find((r) => r.group === c.a)?.a8, b: v.find((r) => r.group === c.b)?.a8 }), (r) => r.area)
      .map(([label, v]) => ({ label, ...v })).filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b))
      .sort((p, q) => d3.descending(Math.abs(p.a - p.b), Math.abs(q.a - q.b)));
    if (rows.length) dumbbell(el, { rows, names: [c.a, c.b], fmt: f1, label: `Average Attainment 8 for ${c.a} and ${c.b} in each region, ${year}` });
  });

  chart('gap-scatter', ['schools'], (el, d) => {
    const p = params(), c = CMP[p.cmp];
    const schools = schoolsOfType(d.schools, p.stype);
    if (p.cmp === 'sen') {
      const pts = schools.filter((s) => Number.isFinite(s.pct_sen) && Number.isFinite(s.a8))
        .map((s) => ({ x: s.pct_sen, y: s.a8, name: s.name, sub: s.la, lines: [`SEND: ${f1(s.pct_sen)}% of pupils`, `Attainment 8: ${f1(s.a8)}`] }));
      scatter(el, { pts, xLabel: '% of pupils with SEND', yLabel: 'Attainment 8', trend: true, xfmt: f0, yfmt: f0,
        label: 'Each school: Attainment 8 against share of pupils with SEND' });
      return;
    }
    const pts = schools.filter((s) => Number.isFinite(s['a8_' + c.ka]) && Number.isFinite(s['a8_' + c.kb]))
      .map((s) => ({ x: s['a8_' + c.ka], y: s['a8_' + c.kb], name: s.name, sub: s.la,
        lines: [`${c.a}: ${f1(s['a8_' + c.ka])} (${f0(s['n_' + c.ka])} pupils)`, `${c.b}: ${f1(s['a8_' + c.kb])} (${f0(s['n_' + c.kb])} pupils)`,
          `Gap: ${f1(s['a8_' + c.ka] - s['a8_' + c.kb])}`] }));
    scatter(el, { pts, xLabel: `${c.a}: Attainment 8`, yLabel: `${c.b}: Attainment 8`, diagonal: true, xfmt: f0, yfmt: f0,
      label: `Each school: Attainment 8 of ${c.b} against ${c.a}` });
  });

  chart('gap-hist', ['schools'], (el, d) => {
    const p = params(), c = CMP[p.cmp];
    if (p.cmp === 'sen') return;
    const values = schoolsOfType(d.schools, p.stype).map((s) => s['a8_' + c.ka] - s['a8_' + c.kb]).filter(Number.isFinite).sort(d3.ascending);
    histogram(el, { values, fmt: f1, unit: `${c.a} minus ${c.b}, Attainment 8 points`, label: `Distribution of the school-level gap between ${c.a} and ${c.b}` });
  });

  // ------------------------------------------------------------ subject page
  dash.draw('subject-select', (sel) => {
    const e = get('subject_entries');
    const current = params().subject;
    const subjects = e.ok ? [...bySubject(e.rows).keys()].sort(d3.ascending) : [current];
    const groups = [['GCSE', subjects.filter((s) => !isVocational(s))], ['Vocational and technical awards', subjects.filter(isVocational)]];
    sel.replaceChildren(...groups.filter(([, list]) => list.length).map(([name, list]) => {
      const og = document.createElement('optgroup');
      og.label = name;
      og.append(...list.map((s) => new Option(s, s)));
      return og;
    }));
    sel.value = current;
    sel.onchange = () => dash.setParams({ subject: sel.value });
  });

  const summary = (name, field, fmt) => text(name, ['subject_summary'], (d) => { const v = d.subject_summary[0]?.[field]; return v == null ? null : fmt(v); });
  summary('kpi-offer', 'offer_pct', f1);
  summary('kpi-offering', 'offering', f0);
  summary('kpi-schools', 'schools', f0);
  summary('kpi-uptake', 'uptake_pct', f1);
  summary('kpi-entries', 'entries', f0);
  summary('kpi-cohort', 'cohort', f0);
  summary('kpi-uptake-offer', 'uptake_offering_pct', f1);
  summary('kpi-grade', 'avg_grade', f1);
  summary('kpi-pass', 'pass_pct', f1);

  chart('subj-groups', ['national_subjects'], (el, d) => {
    const subject = params().subject;
    const all = d.national_subjects.filter((r) => r.subject === subject);
    if (!all.length) return;
    const year = d3.max(all, (r) => r.year);
    const find = (g) => all.find((r) => r.year === year && r.group === g);
    const order = [['All pupils'], ['Girls', 'Boys'], ['Not disadvantaged', 'Disadvantaged'], ['English first language', 'EAL'], ['No SEND', 'SEND']];
    const rows = [];
    order.forEach((groups, block) => groups.forEach((g) => { const r = find(g); if (r) rows.push({ ...r, block }); }));
    const voc = isVocational(subject);
    const cols = [
      { title: 'Uptake %', short: 'Uptake %', v: (r) => (100 * r.entries) / r.cohort },
      { title: voc ? 'Level 2 pass %' : 'Grade 4+ %', short: voc ? 'L2 %' : '4+ %', v: (r) => (100 * r.n4) / r.entries },
      { title: 'Grade 7+ %', short: '7+ %', v: (r) => (voc ? NaN : (100 * r.n7) / r.entries) },
    ].filter((c) => rows.some((r) => Number.isFinite(c.v(r))));
    const rowH = 24, blockGap = 10, top = 22;
    const yOf = (i) => top + i * rowH + rows[i].block * blockGap;
    const H = yOf(rows.length - 1) + rowH + 4;
    const { svg, W } = svgIn(el, H, `${subject}: uptake and grades by pupil group, England, ${year}`);
    const labelW = Math.min(textWidth(svg, rows.map((r) => r.group)) + 10, W * 0.4);
    const gutter = 14, colW = (W - labelW - gutter * (cols.length - 1)) / cols.length;
    const tip = tipFor(el);
    rows.forEach((r, i) => svg.append('text').attr('class', 'kx-strong').attr('x', labelW - 8).attr('y', yOf(i) + rowH / 2).attr('dy', '0.32em')
      .attr('text-anchor', 'end').text(r.group));
    cols.forEach((c, j) => {
      const x0 = labelW + j * (colW + gutter);
      const valW = textWidth(svg, rows.map((r) => f1(c.v(r)))) + 8;
      const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => c.v(r)) || 1]).range([0, Math.max(10, colW - valW)]);
      svg.append('text').attr('x', x0).attr('y', 12).text(colW < 92 ? c.short : c.title);
      rows.forEach((r, i) => {
        const v = c.v(r);
        if (!Number.isFinite(v)) return;
        svg.append('rect').attr('x', x0).attr('y', yOf(i) + 4).attr('width', Math.max(1, x(v))).attr('height', rowH - 8).attr('rx', 3)
          .style('fill', r.group === 'All pupils' ? 'var(--cds-chart-muted, var(--color-fg-muted))' : C(0));
        svg.append('text').attr('class', 'kx-strong').attr('x', x0 + x(v) + 5).attr('y', yOf(i) + rowH / 2).attr('dy', '0.32em').text(f1(v));
      });
    });
    rows.forEach((r, i) => svg.append('rect').attr('x', 0).attr('y', yOf(i)).attr('width', W).attr('height', rowH).attr('fill', 'transparent')
      .on('pointermove', (event) => tip.show(event, `${r.group}, ${year}`, [`${f0(r.entries)} entries from ${f0(r.cohort)} pupils`,
        ...cols.map((c) => `${c.title.replace(' %', '')}: ${f1(c.v(r))}%`)]))
      .on('pointerleave', () => tip.hide()));
  });

  chart('subj-trend', ['national_subjects'], (el, d) => {
    const p = params(), c = CMP[p.cmp];
    const rows = d.national_subjects.filter((r) => r.subject === p.subject && r.topic === c.topic && r.cohort > 0);
    const years = [...new Set(rows.map((r) => r.year))].sort();
    const series = [c.a, c.b].map((name, i) => ({
      name, color: C(i), values: rows.filter((r) => r.group === name).sort((x, y) => d3.ascending(x.year, y.year))
        .map((r) => ({ x: r.year, y: (100 * r.entries) / r.cohort })),
    })).filter((s) => s.values.length);
    if (series.length) lineChart(el, { years, series, fmt: f1, label: `${p.subject}: uptake by ${c.a} and ${c.b}, England, by year` });
  });

  const BAND_ORDER = {
    sex_policy: ['Boys', 'Girls', 'Mixed'],
    admission: ['Selective', 'Non-selective', 'Non-selective (selective area)'],
    idaci: ['1', '2', '3', '4', '5'],
    ofsted: ['Outstanding', 'Good', 'Requires improvement', 'Inadequate'],
  };
  const BAND_LABEL = { 'Non-selective (selective area)': 'Non-sel., selective area', '1': '1 least deprived', '5': '5 most deprived' };
  function bandRows(schools, entries, p) {
    const key = p.band, list = schoolsOfType(schools, p.stype);
    return memo(`bands:${key}:${p.stype}:${p.subject}`, schools, () => {
      const subj = new Map((bySubject(entries).get(p.subject) || []).map((e) => [e.urn, e]));
      let bandOf, order;
      if (key.startsWith('pct_')) {
        const vals = list.map((s) => s[key]).filter(Number.isFinite).sort(d3.ascending);
        if (vals.length < 10) return [];
        const cuts = [0.2, 0.4, 0.6, 0.8].map((q) => d3.quantile(vals, q));
        const names = ['Lowest', '2nd', 'Middle', '4th', 'Highest'];
        order = names.map((n, i) => `${n} (${i === 0 ? '≤' + f0(cuts[0]) : i === 4 ? '>' + f0(cuts[3]) : f0(cuts[i - 1]) + '–' + f0(cuts[i])}%)`);
        bandOf = (s) => (Number.isFinite(s[key]) ? order[d3.bisectLeft(cuts, s[key])] : null);
      } else {
        const raw = (s) => (key === 'idaci' ? (Number.isFinite(s.idaci) ? String(s.idaci) : '') : s[key] || '');
        order = (BAND_ORDER[key] || [...new Set(list.map(raw))].filter(Boolean).sort(d3.ascending)).map((v) => BAND_LABEL[v] || v);
        bandOf = (s) => { const v = raw(s); return v ? BAND_LABEL[v] || v : null; };
      }
      const acc = new Map(order.map((label) => [label, { label, schools: 0, offering: 0, cohort: 0, entries: 0, graded: 0, points: 0, n4: 0 }]));
      for (const s of list) {
        const a = acc.get(bandOf(s));
        if (!a) continue;
        a.schools += 1;
        a.cohort += s.cohort || 0;
        const e = subj.get(s.urn);
        if (!e) continue;
        a.offering += 1;
        a.entries += e.entries; a.graded += e.graded; a.points += e.points || 0; a.n4 += e.n4;
      }
      return [...acc.values()].filter((a) => a.schools > 0);
    });
  }
  const bandChart = (name, value, fmt, suffix, lines) => chart(name, ['schools', 'subject_entries'], (el, d) => {
    const p = params();
    const voc = isVocational(p.subject);
    const rows = bandRows(d.schools, d.subject_entries, p).map((a) => ({ label: a.label, value: value(a, voc), lines: lines(a) }));
    hbar(el, { rows, fmt, suffix: typeof suffix === 'function' ? suffix(voc) : suffix, label: `${p.subject} by school group` });
  });
  bandChart('band-offer', (a) => (100 * a.offering) / a.schools, f1, '%', (a) => [`${f0(a.offering)} of ${f0(a.schools)} schools`]);
  bandChart('band-uptake', (a) => (100 * a.entries) / a.cohort, f1, '%', (a) => [`${f0(a.entries)} entries, ${f0(a.cohort)} pupils`]);
  bandChart('band-grade', (a, voc) => (a.graded ? (voc ? (100 * a.n4) / a.graded : a.points / a.graded) : NaN), f1, (voc) => (voc ? '%' : ''),
    (a) => [`${f0(a.graded)} graded entries`, `${f1((100 * a.n4) / a.graded)}% at grade 4+ or level 2 pass`]);

  chart('subj-scatter', ['schools', 'subject_entries'], (el, d) => {
    const p = params();
    const voc = isVocational(p.subject);
    const subj = new Map((bySubject(d.subject_entries).get(p.subject) || []).map((e) => [e.urn, e]));
    const gradeLabel = voc ? 'Level 2 pass %' : 'Average grade';
    const pts = [];
    for (const s of schoolsOfType(d.schools, p.stype)) {
      const e = subj.get(s.urn);
      if (!e || !Number.isFinite(s[p.sx]) || !s.cohort) continue;
      const uptake = (100 * e.entries) / s.cohort;
      const grade = e.graded ? (voc ? (100 * e.n4) / e.graded : e.points / e.graded) : NaN;
      const y = p.sy === 'grade' ? grade : Math.min(uptake, 100);
      if (!Number.isFinite(y)) continue;
      pts.push({ x: s[p.sx], y, name: s.name, sub: s.la,
        lines: [`${AXIS_LABEL[p.sx]}: ${f1(s[p.sx])}`, `Entries: ${f0(e.entries)} of ${f0(s.cohort)} pupils (${f1(uptake)}%)`,
          `${gradeLabel}: ${Number.isFinite(grade) ? f1(grade) : 'n/a'}`] });
    }
    scatter(el, { pts, xLabel: AXIS_LABEL[p.sx], yLabel: p.sy === 'grade' ? gradeLabel : AXIS_LABEL.uptake, trend: true, xfmt: f0,
      yfmt: p.sy === 'grade' && !voc ? f1 : f0, label: `${p.subject}: each school, ${AXIS_LABEL[p.sy]} against ${AXIS_LABEL[p.sx]}` });
  });

  // ------------------------------------------------------------ school finder
  const root = document.getElementById('dash-root') || document;
  const all = (sel) => root.querySelectorAll(sel);
  const PAGE_SIZE = 40;
  const TEXT_COLS = new Set(['name', 'la', 'type']);
  const finder = { query: '', la: '', type: '', sort: 'cohort', dir: -1, page: 0 };
  // Every school with the values the table shows, so any column can be sorted.
  function finderRows(schools, entries, subject) {
    return memo('finder:' + subject, schools, () => {
      const subj = new Map((bySubject(entries).get(subject) || []).map((r) => [r.urn, r]));
      const voc = isVocational(subject);
      return schools.map((r) => {
        const x = subj.get(r.urn);
        return {
          urn: r.urn, name: r.name, la: r.la, type: r.type, cohort: r.cohort, pct_dis: r.pct_dis, a8: r.a8,
          gap_dis: r.a8_nondis - r.a8_dis, gap_sex: r.a8_girls - r.a8_boys,
          entries: x ? x.entries : 0, uptake: x && r.cohort ? (100 * x.entries) / r.cohort : NaN,
          grade: x && x.graded && !voc ? x.points / x.graded : NaN,
          hay: `${r.name} ${r.la} ${r.postcode || ''} ${r.urn}`.toLowerCase(),
        };
      });
    });
  }
  dash.draw('la-select', (sel) => {
    const s = get('schools');
    const las = s.ok ? memo('las', s.rows, () => [...new Set(s.rows.map((r) => r.la))].filter(Boolean).sort(d3.ascending)) : [];
    sel.replaceChildren(new Option('All local authorities', ''), ...las.map((la) => new Option(la, la)));
    sel.value = finder.la;
    sel.onchange = () => { finder.la = sel.value; finderChanged(true); };
  });
  function finderView() {
    const s = get('schools'), e = get('subject_entries');
    if (!s.ok || !e.ok) return null;
    const q = finder.query.trim().toLowerCase();
    const key = finder.sort, dir = finder.dir, isText = TEXT_COLS.has(key);
    const blank = (v) => (isText ? !v : !Number.isFinite(v));
    const hits = finderRows(s.rows, e.rows, params().subject).filter((r) => (!finder.la || r.la === finder.la) && (!finder.type || r.type === finder.type) && (!q || r.hay.includes(q))).sort((a, b) => {
      const ba = blank(a[key]), bb = blank(b[key]);
      if (ba || bb) return ba - bb || d3.descending(a.cohort, b.cohort); // blanks last, whichever way the sort runs
      return dir * (isText ? a[key].localeCompare(b[key]) : a[key] - b[key]) || d3.descending(a.cohort, b.cohort);
    });
    const pages = Math.max(1, Math.ceil(hits.length / PAGE_SIZE));
    finder.page = Math.min(Math.max(0, finder.page), pages - 1);
    return { hits, pages, from: finder.page * PAGE_SIZE };
  }
  dash.draw('school-rows', (tbody) => {
    const view = finderView();
    tbody.replaceChildren();
    if (!view) return;
    const cell = (v, cls) => { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = v; return td; };
    const n1 = (v) => (Number.isFinite(v) ? f1(v) : '');
    for (const r of view.hits.slice(view.from, view.from + PAGE_SIZE)) {
      const tr = document.createElement('tr');
      tr.dataset.key = r.urn;
      tr.append(cell(r.name), cell(r.la), cell(r.type), cell(f0(r.cohort), 'kx-num'), cell(n1(r.pct_dis), 'kx-num'), cell(n1(r.a8), 'kx-num'),
        cell(n1(r.gap_dis), 'kx-num'), cell(n1(r.gap_sex), 'kx-num'), cell(f0(r.entries), 'kx-num'), cell(n1(r.uptake), 'kx-num'), cell(n1(r.grade), 'kx-num'));
      tbody.append(tr);
    }
  });
  dash.draw('school-count', (el) => {
    const view = finderView();
    if (!view) { el.textContent = '—'; return; }
    const n = view.hits.length;
    el.textContent = n ? `${f0(view.from + 1)} to ${f0(Math.min(n, view.from + PAGE_SIZE))} of ${f0(n)} schools` : 'No schools match';
  });
  function finderChanged(resetPage) {
    if (resetPage) finder.page = 0;
    dash.draw('school-rows');
    dash.draw('school-count');
    syncFinder();
  }
  function syncFinder() {
    const view = finderView();
    all('.kx-sort').forEach((b) => {
      const on = b.dataset.sort === finder.sort;
      b.closest('th').setAttribute('aria-sort', on ? (finder.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    all('.kx-prev').forEach((b) => { b.disabled = !view || finder.page === 0; });
    all('.kx-next').forEach((b) => { b.disabled = !view || finder.page >= view.pages - 1; });
  }

  // ------------------------------------------------------------ controls and tabs (listen and set state only)
  const bind = (sel, name) => all(sel).forEach((el) => el.addEventListener('change', () => dash.setParams({ [name]: el.value })));
  bind('.kx-cmp', 'cmp');
  bind('.kx-stype', 'stype');
  bind('#band-select', 'band');
  bind('#sx-select', 'sx');
  bind('#sy-select', 'sy');
  all('#school-search').forEach((el) => el.addEventListener('input', () => { finder.query = el.value; finderChanged(true); }));
  all('.kx-sort').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.sort;
    if (finder.sort === key) finder.dir = -finder.dir;
    else { finder.sort = key; finder.dir = TEXT_COLS.has(key) ? 1 : -1; } // numbers start highest first
    finderChanged(true);
  }));
  all('#type-select').forEach((el) => el.addEventListener('change', () => { finder.type = el.value; finderChanged(true); }));
  all('.kx-prev').forEach((b) => b.addEventListener('click', () => { finder.page -= 1; finderChanged(false); }));
  all('.kx-next').forEach((b) => b.addEventListener('click', () => { finder.page += 1; finderChanged(false); }));

  function showPage(name, link) {
    let found = false;
    all('[data-page]').forEach((sec) => { const on = sec.dataset.page === name; sec.hidden = !on; found = found || on; });
    if (!found) return showPage('gaps', false);
    all('.kx-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    if (link) dash.setLink(name);
  }
  all('.kx-tab').forEach((t) => t.addEventListener('click', () => showPage(t.dataset.tab, true)));
  const start = (location.hash || '').replace('#', '');
  if (['subject', 'schools'].includes(start)) showPage(start, false);

  dash.onData(() => {
    const p = params();
    const set = (sel, v) => all(sel).forEach((el) => { if (document.activeElement !== el) el.value = v; });
    set('.kx-cmp', p.cmp);
    set('.kx-stype', p.stype);
    set('#band-select', p.band);
    set('#sx-select', p.sx);
    set('#sy-select', p.sy);
    all('[data-only]').forEach((el) => { el.hidden = (el.dataset.only === 'sen') !== (p.cmp === 'sen'); });
    syncFinder();
  });
})();
