// Small progressive enhancements. Every page also works without JavaScript.
(function () {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;

  // Ask before destructive actions: <form data-confirm="...">
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) { e.preventDefault(); return; }
    // slow actions: show progress on the button  <button data-busy="Reading…">
    const btn = e.target.querySelector('button[data-busy]');
    if (btn) { btn.textContent = btn.dataset.busy; btn.classList.add('busy'); setTimeout(() => (btn.disabled = true), 0); }
  });

  // Live system summary on the project form
  const form = document.getElementById('project-form');
  if (form) {
    const $ = (n) => form.querySelector(`[name="${n}"]`);
    const out = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    const fmt = (v, dp = 2) => (v === null || isNaN(v)) ? '—' :
      Number(v.toFixed(dp)).toLocaleString('en-US', { maximumFractionDigits: dp });

    function update() {
      const mod = $('module_id').selectedOptions[0];
      const inv = $('inverter_id').selectedOptions[0];
      const wp = parseFloat(mod?.dataset.wp || '');
      const kw = parseFloat(inv?.dataset.kw || '');
      const n = parseInt($('module_count').value || '', 10);
      const q = parseInt($('inverter_qty').value || '', 10);
      const dc = (wp && n) ? wp * n / 1000 : null;
      const ac = (kw && q) ? kw * q : null;
      out('live-dc', dc === null ? '—' : fmt(dc) + ' kWp');
      out('live-ac', ac === null ? '—' : fmt(ac) + ' kW');
      out('live-ratio', (dc && ac) ? fmt(dc / ac) : '—');
      out('live-form', ac === null ? '—' : (ac > 11 ? 'Above 11 kW form' : '11 kW and below form'));
      const strings = parseInt($('strings').value || '', 10);
      const per = document.getElementById('live-per-string');
      if (per) per.textContent = (n && strings) ?
        (n % strings ? `${n} modules don't split evenly into ${strings} strings` : `${n / strings} modules per string`) : '';
      // keep the phase / transformer answers in step with the chosen inverter
      if (inv && inv.dataset.phases && document.activeElement === $('inverter_id')) {
        const ph = form.querySelector(`[name="phases"][value="${inv.dataset.phases}"]`);
        if (ph) ph.checked = true;
        const tr = form.querySelector(`[name="internal_transformer"][value="${inv.dataset.trafo === '1' ? 'yes' : 'no'}"]`);
        if (tr) tr.checked = true;
      }
    }
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  }

  // Re-run the rules check while the sizing form is edited
  const sizing = document.getElementById('sizing-form');
  if (sizing) {
    const box = document.getElementById('sizing-results');
    const state = document.getElementById('preview-state');
    let timer = null, seq = 0;
    const run = async () => {
      const mine = ++seq;
      box.classList.add('stale');
      try {
        const res = await fetch(sizing.dataset.preview, { method: 'POST', body: new FormData(sizing), headers: { 'X-CSRF-Token': csrf } });
        if (!res.ok) throw new Error(res.status);
        const html = await res.text();
        if (mine === seq) { box.innerHTML = html; state.textContent = 'Not saved yet'; }
      } catch (err) {
        if (mine === seq) state.textContent = 'Live check unavailable; save to check';
      } finally {
        if (mine === seq) box.classList.remove('stale');
      }
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(run, 350); };
    sizing.addEventListener('input', later);
    sizing.addEventListener('change', later);
  }

  // Add a contractor / consultant from inside the project form
  document.querySelectorAll('[data-quickadd]').forEach((btn) => {
    const kind = btn.dataset.quickadd;
    const box = document.getElementById('qa-' + kind);
    const select = document.querySelector(`select[name="${kind}_id"]`);
    btn.addEventListener('click', () => box.classList.toggle('open'));
    box.querySelector('[data-save]').addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('kind', kind);
      ['name', 'phone', 'engineer'].forEach((k) => fd.append(k, box.querySelector(`[data-f="${k}"]`).value));
      const res = await fetch('/parties/quick', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': csrf } });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'Could not save'); return; }
      const opt = new Option(data.name, data.id, true, true);
      select.add(opt);
      box.classList.remove('open');
      box.querySelectorAll('input').forEach((i) => (i.value = ''));
    });
  });
})();
