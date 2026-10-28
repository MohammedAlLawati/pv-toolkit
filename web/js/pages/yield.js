// Yield simulation pages: the overview, one project's simulation, and its printable report.
import { chk, esc, fileUrl, float, g, go, html, num, raw, sel, shortDate, toast } from "../ui.js";
import * as db from "../store.js";
import { byUpdated, loadAll, projectCheck } from "../data.js";
import { blocked, fails, unknown, warnings } from "../sizing/engine.js";
import { pill } from "./sizing.js";
import { MONTHS, MOUNT_U, SETTINGS, mountFor, settingsWithDefaults, simulate, systemFrom } from "../yield/model.js";
import { PVGIS_SITE, distanceKm, pack, parseWeather, pvgisTmyUrl } from "../yield/weather.js";
import { setTitle } from "../app.js";

const weatherId = (pid) => `weather_${pid}`;
const latLon = (la, lo) => `${num(Math.abs(la), 4)}° ${la < 0 ? "S" : "N"}, ${num(Math.abs(lo), 4)}° ${lo < 0 ? "W" : "E"}`;
const FAR_KM = 15;

/** The stored weather year for a project, or null. */
export async function loadWeather(pid) {
  const f = await db.getFile(weatherId(pid));
  if (!f) return null;
  try { return JSON.parse(await f.blob.text()); } catch { return null; }
}

async function saveWeather(pid, w) {
  const blob = new Blob([JSON.stringify(pack(w))], { type: "application/json" });
  await db.putFileAs(weatherId(pid), blob, w.name || "weather.json", { kind: "weather", lat: w.lat, lon: w.lon, source: w.source });
}

/** Saved settings for a project, with the mounting guessed from the project the first time. */
function settingsOf(p) {
  const saved = p.yield_settings || {};
  return settingsWithDefaults({ mount: mountFor(p), ...saved });
}

function readSettings(form) {
  const fd = new FormData(form);
  const out = {};
  for (const s of SETTINGS) {
    if (s.type === "bool") out[s.key] = fd.get(s.key) === "yes";
    else if (s.type === "choice") out[s.key] = String(fd.get(s.key) || s.def);
    else out[s.key] = float(fd, s.key);
  }
  return out;
}

// ---- overview ----------------------------------------------------------------------------

export async function index(main) {
  setTitle("Yield simulation");
  const all = await loadAll();
  const files = new Set((await db.list("files")).filter((f) => f.kind === "weather").map((f) => f.id));
  const rows = byUpdated(all.projects).map(all.full);
  main.innerHTML = html`
<div class="head">
  <div><h1>Yield simulation &amp; reports</h1><div class="muted">Hour-by-hour energy for a typical year from PVGIS weather, with a loss diagram and a PVsyst-style report.</div></div>
</div>
<div class="panel">
  ${rows.length ? html`<table>
    <thead><tr><th>Project</th><th class="r">DC kWp</th><th>Weather</th><th class="r">Energy (kWh/yr)</th><th class="r">kWh/kWp</th><th class="r">PR</th><th>Rules</th></tr></thead>
    <tbody>${rows.map((p) => {
      const y = p.yield_result;
      return html`<tr>
      <td><a href="#/projects/${p.id}/yield">${p.name}</a><div class="small muted">${p.client?.name}</div></td>
      <td class="r num">${num(p.module && p.module_count ? (p.module.wp * p.module_count) / 1000 : null)}</td>
      <td>${files.has(weatherId(p.id)) ? html`<span class="pill ok">Loaded</span>` : html`<span class="pill">None</span>`}</td>
      <td class="r num">${y ? num(y.e_grid, 0) : "—"}</td><td class="r num">${y ? num(y.specific, 0) : "—"}</td>
      <td class="r num">${y?.pr ? num(y.pr * 100, 1) + " %" : "—"}</td><td>${pill(projectCheck(p, all))}</td></tr>`;
    })}</tbody>
  </table>` : html`<div class="empty">No projects yet. <a href="#/projects/new">Create one</a>.</div>`}
</div>`;
}

// ---- charts (inline SVG) -----------------------------------------------------------------

/** Monthly energy bars. One series, so no legend; each bar has a hover title. */
function monthlyChart(monthly, unit = "kWh") {
  const W = 640, H = 220, L = 52, B = 26, T = 12, R = 8;
  const max = Math.max(...monthly.map((m) => m.e_grid), 1);
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const bw = (W - L - R) / 12;
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return raw(`<svg class="ychart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Energy injected into the grid each month">
  ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${esc(num(v, 0))}</text>`).join("")}
  ${monthly.map((m, i) => {
    const x = L + i * bw + 2, w = bw - 4, h = Math.max(0, y(0) - y(m.e_grid));
    const r = Math.min(4, w / 2, h);
    return `<g class="bar-g"><title>${esc(m.month)}: ${esc(num(m.e_grid, 0))} ${unit}</title>
      <rect x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}" class="hit"/>
      <path class="barm" d="M${x},${y(0)} V${y(0) - h + r} q0,-${r} ${r},-${r} H${x + w - r} q${r},0 ${r},${r} V${y(0)} Z"/>
      <text x="${L + i * bw + bw / 2}" y="${H - 8}" class="tick" text-anchor="middle">${esc(m.month)}</text></g>`;
  }).join("")}
  <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="axis"/>
</svg>`);
}

function niceStep(x) {
  const p = 10 ** Math.floor(Math.log10(x || 1));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/** The loss diagram as rows: milestones in bold, each loss with its % and a bar for its size. */
function lossTable(losses) {
  const big = Math.max(...losses.filter((l) => l.pct !== undefined).map((l) => Math.abs(l.pct)), 1);
  return html`<table class="losses">
    <tbody>${losses.map((l) => {
      if (l.pct === undefined) {
        const unit = l.kind.endsWith("irr") ? "kWh/m²" : "kWh";
        return html`<tr class="milestone"><td colspan="2">${l.label}</td><td class="r num">${num(l.value, 0)} ${unit}</td></tr>`;
      }
      const gain = l.pct > 0;
      return html`<tr><td class="r num ${gain ? "gain" : ""}">${l.pct > 0 ? "+" : ""}${num(l.pct, 2)} %</td>
        <td>${l.label}<div class="lbar ${gain ? "gain" : ""}" style="width:${Math.max(0.5, (Math.abs(l.pct) / big) * 100).toFixed(1)}%"></div></td><td></td></tr>`;
    })}</tbody></table>`;
}

function monthlyTable(r) {
  const y = r.year;
  return html`<table class="monthly">
  <thead><tr><th></th><th class="r">GlobHor<div class="small muted">kWh/m²</div></th><th class="r">DiffHor<div class="small muted">kWh/m²</div></th>
    <th class="r">T amb<div class="small muted">°C</div></th><th class="r">GlobInc<div class="small muted">kWh/m²</div></th><th class="r">GlobEff<div class="small muted">kWh/m²</div></th>
    <th class="r">E array<div class="small muted">kWh</div></th><th class="r">E grid<div class="small muted">kWh</div></th><th class="r">PR</th></tr></thead>
  <tbody>${r.monthly.map((m) => html`<tr><td>${m.month}</td><td class="r num">${num(m.ghi, 1)}</td><td class="r num">${num(m.dhi, 1)}</td><td class="r num">${num(m.tamb, 1)}</td>
    <td class="r num">${num(m.poa, 1)}</td><td class="r num">${num(m.eff, 1)}</td><td class="r num">${num(m.e_array, 0)}</td><td class="r num">${num(m.e_grid, 0)}</td><td class="r num">${m.pr ? num(m.pr * 100, 1) + " %" : "—"}</td></tr>`)}
  <tr class="total"><td>Year</td><td class="r num">${num(y.ghi, 1)}</td><td class="r num">${num(y.dhi, 1)}</td><td class="r num">${num(y.tamb, 1)}</td>
    <td class="r num">${num(y.poa, 1)}</td><td class="r num">${num(y.eff, 1)}</td><td class="r num">${num(y.e_array, 0)}</td><td class="r num">${num(y.e_grid, 0)}</td><td class="r num">${num(y.pr * 100, 1)} %</td></tr></tbody>
</table>`;
}

function tiles(r) {
  const y = r.year;
  return html`<div class="summary">
  <div><span>Energy to the grid</span><b>${num(y.e_grid / 1000, 1)} MWh/yr</b></div>
  <div><span>Specific yield</span><b>${num(y.specific, 0)} kWh/kWp/yr</b></div>
  <div><span>Performance ratio</span><b>${num(y.pr * 100, 1)} %</b></div>
  <div><span>DC / AC</span><b>${num(y.dc_kwp)} kWp / ${num(y.ac_kw)} kW <small class="muted">(${num(y.ratio)})</small></b></div>
</div>`;
}

// ---- one project -------------------------------------------------------------------------

async function context(pid) {
  const all = await loadAll();
  const raw0 = all.projects.find((x) => x.id === pid);
  if (!raw0) return null;
  const p = all.full(raw0);
  const check = projectCheck(p, all);
  const { system, missing } = systemFrom(p, check);
  return { all, raw: raw0, p, check, system, missing, weather: await loadWeather(pid) };
}

function weatherPanel(p, w, others) {
  const hasSite = Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
  const far = w && hasSite && Number.isFinite(w.lat) ? distanceKm(p.latitude, p.longitude, w.lat, w.lon) : null;
  const tmin = w ? Math.min(...w.tamb) : null, tmax = w ? Math.max(...w.tamb) : null;
  return html`<div class="panel">
  <div class="panel-head"><h2>Weather: typical year</h2>${w ? html`<span class="pill ok">Loaded</span>` : html`<span class="pill warn">Needed</span>`}</div>
  ${w ? html`<dl class="kv">
    <dt>File</dt><dd>${w.name || "—"} · ${w.source}</dd>
    <dt>Location</dt><dd>${num(w.lat, 4)}, ${num(w.lon, 4)}${far !== null ? html` · <span class="${far > FAR_KM ? "err-text" : ""}">${num(far, 1)} km from the site</span>` : ""}</dd>
    <dt>Horizontal irradiation</dt><dd>${num(w.ghi.reduce((a, b) => a + b, 0) / 1000, 0)} kWh/m² per year</dd>
    <dt>Air temperature</dt><dd>${num(tmin, 1)} to ${num(tmax, 1)} °C over the typical year <span class="small muted">(the record low for the string check will be lower)</span></dd>
  </dl>
  ${far !== null && far > FAR_KM ? html`<div class="flash warn">This weather file is for a place ${num(far, 0)} km from the project's coordinates. Download the file for the site.</div>` : ""}` : ""}
  <div class="steps small">
    ${hasSite ? html`<div><b>1.</b> <a class="btn small" href="${pvgisTmyUrl(p.latitude, p.longitude)}" target="_blank" rel="noopener">Download the PVGIS typical year</a>
      for ${num(p.latitude, 4)}, ${num(p.longitude, 4)}. <span class="muted">It saves a .json file. PVGIS doesn't let web pages fetch it directly, so the file comes back in step 2.</span></div>`
      : html`<div class="flash warn">Add the site's latitude and longitude to the project first (<a href="#/projects/${p.id}/edit">edit the project</a>).</div>`}
    <div><b>${hasSite ? "2." : ""}</b> <label class="btn small">${w ? "Replace with a file…" : "Choose the file…"}<input type="file" id="wfile" accept=".json,.csv,.epw,application/json,text/csv" hidden></label>
      <span class="muted">or drop it on this box. PVGIS JSON or CSV, or an EPW file (e.g. from <a href="${PVGIS_SITE}" target="_blank" rel="noopener">the PVGIS site</a> or Meteonorm).</span></div>
    ${others.length ? html`<div><b>or</b> use the weather of another project:
      <select id="wcopy"><option value="">Choose…</option>${others.map((o) => html`<option value="${o.id}">${o.name}${o.km !== null ? ` (${num(o.km, 1)} km away)` : ""}</option>`)}</select></div>` : ""}
  </div>
</div>`;
}

function settingsForm(cfg, system) {
  const groups = [...new Set(SETTINGS.map((s) => s.group))];
  return html`<form id="yform" class="panel">
  <h2>Losses and settings</h2>
  ${groups.map((gname) => html`<h3 class="spaced">${gname}</h3><div class="fields one">
    ${SETTINGS.filter((s) => s.group === gname).map((s) => {
      if (s.type === "bool") return html`<label class="check"><input type="checkbox" name="${s.key}" value="yes" ${chk(cfg[s.key])} ${s.key === "bifacial" && !(system?.bifaciality > 0) ? "disabled" : ""}> ${s.label}${s.hint ? html`<span class="hint">${s.hint}${s.key === "bifacial" ? ` (this module: ${system?.bifaciality ? g(system.bifaciality) : "none"})` : ""}</span>` : ""}</label>`;
      if (s.type === "choice") return html`<label>${s.label}<select name="${s.key}">${Object.entries(s.choices).map(([k, c]) => html`<option value="${k}" ${sel(cfg[s.key] === k)}>${c.label} · Uc ${c.uc}</option>`)}</select></label>`;
      const ph = s.key === "inv_eff_pct" && system ? g(system.inv_eff * 100) : s.key === "uc" ? g(MOUNT_U[cfg.mount].uc)
        : s.key === "dc_ohmic_pct" && system?.dc_drop_pct !== null && system?.dc_drop_pct !== undefined ? g(system.dc_drop_pct)
        : s.key === "ac_ohmic_pct" && system?.ac_drop_pct !== null && system?.ac_drop_pct !== undefined ? g(system.ac_drop_pct) : "";
      return html`<label>${s.label}${s.unit ? ` (${s.unit})` : ""}<input name="${s.key}" value="${g(cfg[s.key])}" placeholder="${ph}" inputmode="decimal">${s.hint ? html`<span class="hint">${s.hint}</span>` : ""}</label>`;
    })}</div>`)}
  <div class="bar"><button type="button" class="btn" id="yreset">Defaults</button><button class="btn primary">Save and use for the offer</button></div>
</form>`;
}

function resultsHtml(r, ctx) {
  if (!r) return html`<div class="empty">${ctx.missing.length ? html`Still needed: ${ctx.missing.join(", ")}. <a href="#/projects/${ctx.p.id}/sizing">Sizing</a> · <a href="#/projects/${ctx.p.id}/edit">Edit the project</a>`
    : "Load the weather to run the simulation."}</div>`;
  return html`${tiles(r)}
  <h3>Energy to the grid each month (kWh)</h3>
  ${monthlyChart(r.monthly)}
  ${monthlyTable(r)}
  <h3 class="spaced">Loss diagram</h3>
  ${lossTable(r.losses)}
  ${r.notes.map((n) => html`<div class="note small">${n}</div>`)}
  <p class="small muted spaced-top">Hottest cell over the year: ${num(r.hottest_cell, 1)} °C. Sky IAM ${num(r.used.iam_sky, 3)}, ground IAM ${num(r.used.iam_ground, 3)}.
  Expect results within a few percent of PVsyst for simple systems; use PVsyst for anything a bank or utility will scrutinise.</p>`;
}

export async function project(main, { params }) {
  const ctx = await context(params.id);
  if (!ctx) { main.innerHTML = `<div class="panel empty">Project not found.</div>`; return; }
  const { p, all } = ctx;
  setTitle("Yield · " + p.name);
  let cfg = settingsOf(p);
  const run = (c) => (ctx.weather && ctx.system ? simulate(ctx.weather, ctx.system, c) : null);
  let result = run(cfg);

  const files = (await db.list("files")).filter((f) => f.kind === "weather" && f.id !== weatherId(p.id));
  const others = files.map((f) => {
    const op = all.projects.find((x) => weatherId(x.id) === f.id);
    if (!op) return null;
    const km = Number.isFinite(p.latitude) && Number.isFinite(f.lat) ? distanceKm(p.latitude, p.longitude, f.lat, f.lon) : null;
    return { id: op.id, name: op.name, km };
  }).filter(Boolean).sort((a, b) => (a.km ?? 1e9) - (b.km ?? 1e9));

  const isBlocked = blocked(ctx.check);
  const sysLine = ctx.system
    ? `${p.module_count} × ${p.module.make} ${p.module.model} · ${p.inverter_qty} × ${p.inverter.model} · tilt ${g(p.tilt_deg)}°, azimuth ${g(p.azimuth_deg)}° (180 = south)`
    : "";
  main.innerHTML = html`
<div class="head">
  <div><h1>Yield simulation</h1><div class="muted"><a href="#/projects/${p.id}">${p.name}</a> · ${p.client?.name}</div></div>
  <div class="actions">
    <a class="btn" href="#/projects/${p.id}/sizing">Sizing</a>
    ${isBlocked || !result ? html`<span class="btn disabled" title="${!result ? "Run the simulation first" : "A hard rule fails or can't be checked"}">Report (PDF)</span>`
      : html`<a class="btn primary" href="#/projects/${p.id}/yield/report">Report (PDF)</a>`}
  </div>
</div>
<div class="panel"><div class="panel-head"><h2>System ${pill(ctx.check)}</h2><span class="small muted">${sysLine}</span></div>
  ${isBlocked ? html`<div class="flash ${fails(ctx.check).length ? "error" : "warn"}">The report is blocked: ${fails(ctx.check).length ? `${fails(ctx.check).length} hard rule(s) fail (${fails(ctx.check).map((c) => c.label).join("; ")})` : `${unknown(ctx.check).length} rule(s) can't be checked yet`}. Fix it on the <a href="#/projects/${p.id}/sizing">sizing page</a>. The simulation still runs.</div>` : ""}
</div>
<div id="wpanel">${weatherPanel(p, ctx.weather, others)}</div>
<div class="grid-sizing">
  ${settingsForm(cfg, ctx.system)}
  <div class="panel">
    <div class="panel-head"><h2>Results</h2><span class="small muted" id="ystate">${p.yield_result ? `Saved ${shortDate(p.yield_result.run_at)}` : "Not saved yet"}</span></div>
    <div id="yresults">${resultsHtml(result, ctx)}</div>
  </div>
</div>`;

  const box = main.querySelector("#yresults"), state = main.querySelector("#ystate");
  const form = main.querySelector("#yform");
  let timer = null;
  const live = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      cfg = settingsWithDefaults(readSettings(form));
      result = run(cfg);
      box.innerHTML = resultsHtml(result, ctx);
      state.textContent = "Not saved yet";
    }, 120);
  };
  form.addEventListener("input", live);
  form.addEventListener("change", live);
  main.querySelector("#yreset").addEventListener("click", () => {
    for (const s of SETTINGS) {
      const el = form.elements[s.key];
      if (!el) continue;
      if (s.type === "bool") el.checked = !!s.def;
      else if (s.type === "choice") el.value = mountFor(p);
      else el.value = g(s.def);
    }
    live();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    cfg = settingsWithDefaults(readSettings(form));
    result = run(cfg);
    const rec = { ...ctx.raw, yield_settings: readSettings(form) };
    if (result) {
      rec.monthly_kwh = result.monthly.map((m) => Math.round(m.e_grid));
      rec.annual_gen_kwh = rec.monthly_kwh.reduce((a, b) => a + b, 0);
      rec.yield_result = { run_at: new Date().toISOString(), e_grid: result.year.e_grid, specific: result.year.specific, pr: result.year.pr,
                           weather: ctx.weather.source, dc_kwp: result.year.dc_kwp };
    }
    await db.put("projects", rec);
    toast(result ? `Saved. The project's generation is now ${num(rec.annual_gen_kwh, 0)} kWh/yr, month by month, for the offer deck.` : "Settings saved. Load the weather to run the simulation.");
    go(`#/projects/${p.id}/yield`);
  });

  // weather: file, drop, or copy from another project
  const useText = async (text, name) => {
    let w;
    try { w = parseWeather(text, name); } catch (err) { toast(err.message, "error"); return; }
    await saveWeather(p.id, w);
    toast(`Weather loaded: ${w.source}.`);
    go(`#/projects/${p.id}/yield`);
  };
  const wpanel = main.querySelector("#wpanel");
  wpanel.addEventListener("change", async (e) => {
    if (e.target.id === "wfile" && e.target.files[0]) { const f = e.target.files[0]; await useText(await f.text(), f.name); }
    if (e.target.id === "wcopy" && e.target.value) {
      const w = await loadWeather(Number(e.target.value));
      if (w) { await saveWeather(p.id, w); toast("Weather copied."); go(`#/projects/${p.id}/yield`); }
    }
  });
  wpanel.addEventListener("dragover", (e) => { e.preventDefault(); wpanel.classList.add("drop"); });
  wpanel.addEventListener("dragleave", () => wpanel.classList.remove("drop"));
  wpanel.addEventListener("drop", async (e) => {
    e.preventDefault(); wpanel.classList.remove("drop");
    const f = e.dataTransfer.files[0];
    if (f) await useText(await f.text(), f.name);
  });
}

// ---- report --------------------------------------------------------------------------------

export async function report(main, { params }) {
  const ctx = await context(params.id);
  if (!ctx) { main.innerHTML = `<div class="panel empty">Project not found.</div>`; return; }
  const { p, check } = ctx;
  setTitle("Yield report · " + p.name);
  const back = `#/projects/${p.id}/yield`;
  if (blocked(check)) {
    main.innerHTML = html`<div class="panel"><h2>The report is blocked</h2>
      <p>${fails(check).length ? "These hard rules fail:" : "These rules can't be checked yet:"}</p>
      <ul>${[...fails(check), ...unknown(check)].map((c) => html`<li><b>${c.label}</b> <span class="small muted">${c.detail}</span></li>`)}</ul>
      <p><a class="btn primary" href="#/projects/${p.id}/sizing">Open sizing</a> <a class="btn" href="${back}">Back</a></p></div>`;
    return;
  }
  if (!ctx.weather || !ctx.system) { main.innerHTML = html`<div class="panel empty">Run the simulation first. <a href="${back}">Yield simulation</a></div>`; return; }
  const cfg = settingsOf(p);
  const r = simulate(ctx.weather, ctx.system, cfg);
  const top = await db.getFile("letterhead_top");
  const topUrl = top ? fileUrl(top) : null;
  const y = r.year, w = ctx.weather, s = ctx.system;
  const warn = warnings(check);
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const header = (n) => html`<div class="rp-head">${topUrl ? html`<img src="${topUrl}" alt="">` : ""}<div><b>${p.name}</b> · ${p.client?.name || ""}</div><div class="muted">PV yield report · ${today} · page ${n} of 3</div></div>`;
  const val = (k) => (cfg[k] === null || cfg[k] === undefined ? "" : g(cfg[k]));

  main.innerHTML = html`
<div class="head no-print">
  <div><h1>Yield report</h1><div class="muted"><a href="${back}">${p.name}</a></div></div>
  <div class="actions"><a class="btn" href="${back}">Back</a><button class="btn primary" id="print">Print / save as PDF</button></div>
</div>
<p class="small muted no-print">In the print dialog choose "Save as PDF", A4, and turn off headers and footers.</p>
<div class="report">
  <section class="rp-page">
    ${header(1)}
    <h1 class="rp-title">Grid-connected PV system: simulation results</h1>
    <table class="rp-kv"><tbody>
      <tr><th>Project</th><td>${p.name}</td><th>Client</th><td>${p.client?.name || "—"}</td></tr>
      <tr><th>Site</th><td>${latLon(p.latitude, p.longitude)}${w.elevation ? `, ${num(w.elevation, 0)} m` : ""}</td><th>Weather data</th><td>${w.source}</td></tr>
    </tbody></table>
    <h2>System</h2>
    <table class="rp-kv"><tbody>
      <tr><th>PV modules</th><td>${s.modules} × ${p.module.make} ${p.module.model} (${g(s.module_wp)} Wp)</td><th>DC capacity</th><td>${num(y.dc_kwp)} kWp</td></tr>
      <tr><th>Inverters</th><td>${s.inverters} × ${p.inverter.make} ${p.inverter.model} (${g(s.inverter_kw)} kW)</td><th>AC capacity</th><td>${num(y.ac_kw)} kW (DC/AC ${num(y.ratio)})</td></tr>
      <tr><th>Strings</th><td>${p.strings || "—"} × ${check.modules_per_string || "—"} modules</td><th>Orientation</th><td>tilt ${g(s.tilt)}°, azimuth ${g(s.azimuth)}° (180 = south)</td></tr>
      <tr><th>Mounting</th><td>${MOUNT_U[cfg.mount].label}</td><th>Rules check</th><td>${warn.length ? `passes, ${warn.length} warning(s)` : "every rule passes"}</td></tr>
    </tbody></table>
    <h2>Main results</h2>
    ${tiles(r)}
    <h2>Energy to the grid each month (kWh)</h2>
    ${monthlyChart(r.monthly)}
  </section>
  <section class="rp-page">
    ${header(2)}
    <h2>Balances and main results</h2>
    ${monthlyTable(r)}
    <p class="small muted">GlobHor: horizontal global irradiation. DiffHor: horizontal diffuse. T amb: average air temperature. GlobInc: global incident on the plane.
      GlobEff: effective, after shading, IAM and soiling${r.used.bifacial_factor ? ", plus the bifacial rear side" : ""}. E array: DC energy at the inverter input. E grid: energy injected into the grid. PR: E grid ÷ (GlobInc × DC kWp).</p>
    <h2>Loss parameters</h2>
    <table class="rp-kv small"><tbody>
      <tr><th>Albedo</th><td>${val("albedo")}</td><th>Near shading</th><td>${val("shading_pct")} %</td></tr>
      <tr><th>IAM (ASHRAE b0)</th><td>${val("iam_b0")}</td><th>Soiling</th><td>${val("soiling_pct")} %</td></tr>
      <tr><th>Thermal Uc / Uv</th><td>${g(r.used.uc)} W/m²K / ${g(r.used.uv)} W/m²K/(m/s)</td><th>Temperature coefficient (Pmax)</th><td>${g(s.gamma * 100)} %/°C</td></tr>
      <tr><th>Low irradiance (200 W/m²)</th><td>${val("low_light_pct")} %</td><th>Quality / LID / mismatch</th><td>${val("quality_pct")} / ${val("lid_pct")} / ${val("mismatch_pct")} %</td></tr>
      <tr><th>DC wiring at STC</th><td>${g(r.used.dc_ohmic_pct)} %</td><th>Inverter efficiency (European)</th><td>${num(r.used.inv_eff_pct, 2)} %</td></tr>
      <tr><th>AC wiring at rated power</th><td>${g(r.used.ac_ohmic_pct)} %</td><th>Transformer / unavailability</th><td>${val("transformer_pct")} / ${val("availability_pct")} %</td></tr>
    </tbody></table>
  </section>
  <section class="rp-page">
    ${header(3)}
    <h2>Loss diagram over the year</h2>
    ${lossTable(r.losses)}
    ${warn.length ? html`<h2>Design warnings</h2><ul class="small">${warn.map((c) => html`<li><b>${c.label}</b>: ${c.detail}</li>`)}</ul>` : ""}
    ${r.notes.map((n) => html`<p class="small">${n}</p>`)}
    <h2>Method</h2>
    <p class="small">Hour-by-hour simulation of a typical meteorological year. Sun position from the NOAA equations; sky diffuse on the plane from the Perez (1990) model;
      ground reflection from the albedo. Incidence-angle losses by the ASHRAE model. Cell temperature by the PVsyst thermal model; module power from the STC rating,
      a low-irradiance curve and the datasheet's Pmax temperature coefficient. Inverter by the PVWatts efficiency curve, clipped at rated AC power. Wiring losses scale with the square of the current.</p>
    <p class="small muted">Results are estimates for a typical year and are expected within a few percent of PVsyst for simple systems. Actual production varies from year to year with the weather.</p>
  </section>
</div>`;
  main.querySelector("#print").addEventListener("click", () => window.print());
}
