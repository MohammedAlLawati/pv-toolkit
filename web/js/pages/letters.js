// Letters: fill in a letter from a client / project, keep it, download it as Word.
// The wording is in js/letters/defaults.js; the letterhead comes from Settings.
import { download, go, html, shortDate, str, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, byUpdated, loadAll } from "../data.js";
import { setTitle } from "../app.js";
import { buildLetter } from "../letters/builder.js";
import { TEMPLATES } from "../letters/defaults.js";

const LANGS = { en: "English", ar: "Arabic" };
const AUDIENCE_FIELDS = {
  commercial: [["ClientName", "Company name", "wide"], ["CRNo", "C.R. No."], ["SignatoryName", "Authorised signatory"],
               ["SignatoryID", "Signatory ID No."]],
  residential: [["ClientName", "Homeowner", "wide"], ["CivilID", "Civil ID No."]],
};
const VALUE_KEYS = ["ClientName", "CRNo", "SignatoryName", "SignatoryID", "CivilID", "Location"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

const templateName = (key) => TEMPLATES[key]?.en.name || key;
const audienceOf = (key) => TEMPLATES[key]?.en.audience || "commercial";
const today = () => new Date().toISOString().slice(0, 10);

/** "2026-10-27" -> "27 October 2026" (English) or "27/10/2026" (Arabic). */
function letterDate(iso, lang) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return lang === "ar" ? `${d}/${m}/${y}` : `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// Browsers can refuse a download name in Arabic script, so a non-Latin name falls back to the date.
function fileName(letter) {
  const name = letter.values?.ClientName || "";
  const who = name.replace(/[^\w .,&()-]+/g, "").trim().slice(0, 60) || (name ? letter.date : "blank");
  return `NEDC capacity request - ${who}${letter.lang === "ar" ? " (AR)" : ""}.docx`;
}

async function downloadLetter(letter) {
  const values = { ...letter.values, points: letter.points || [], Date: letterDate(letter.date, letter.lang) };
  download(await buildLetter(letter.template, letter.lang, values), fileName(letter));
}

// ---- list --------------------------------------------------------------------------------

export async function list(main) {
  setTitle("Letters");
  const letters = byUpdated(await db.list("letters"));
  const head = await db.getFile("letterhead_top");
  main.innerHTML = html`
<div class="head">
  <div><h1>Letters</h1><div class="muted">Letters to NEDC on the company letterhead, as Word files.</div></div>
  <div class="actions"><a class="btn primary" href="#/letters/new">New letter</a></div>
</div>
${head ? "" : html`<div class="flash warn">No letterhead uploaded yet, so letters print on plain paper. <a href="#/settings">Upload it in Settings</a>.</div>`}
<div class="panel">
  ${letters.length ? html`<table>
    <thead><tr><th>Client</th><th>Letter</th><th>Language</th><th>Date</th></tr></thead>
    <tbody>${letters.map((l) => html`<tr><td><a href="#/letters/${l.id}">${l.values?.ClientName || "(no name)"}</a></td>
      <td>${templateName(l.template)}</td><td>${LANGS[l.lang]}</td><td>${shortDate(l.date)}</td></tr>`)}</tbody>
  </table>` : html`<div class="empty">No letters yet. Start one here, or from a client or project page.</div>`}
</div>
<div class="panel">
  <h2>Blank templates</h2>
  <p class="small muted">Every input left as a line, to fill in by hand.</p>
  ${Object.keys(TEMPLATES).map((key) => html`
  <div class="doc"><div><b>${templateName(key)}</b></div>
    <div class="btns">${Object.entries(LANGS).map(([lang, label]) => html`<button class="btn small" data-blank="${key}" data-lang="${lang}">${label}</button>`)}</div>
  </div>`)}
</div>`;
  for (const b of main.querySelectorAll("[data-blank]")) {
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { await downloadLetter({ template: b.dataset.blank, lang: b.dataset.lang, values: {}, points: [] }); }
      finally { b.disabled = false; }
    });
  }
}

// ---- one letter --------------------------------------------------------------------------

/** A new letter's values from the client / project it was started from. */
function prefill(all, query) {
  const project = query.project_id ? all.projects.find((p) => p.id === Number(query.project_id)) : null;
  const client = all.client.get(Number(query.client_id || project?.client_id)) || null;
  const template = query.template && TEMPLATES[query.template] ? query.template
    : client && !client.signatory_name ? "nedc_residential" : "nedc_commercial";
  const values = {};
  if (client) {
    values.ClientName = client.name;
    values[audienceOf(template) === "commercial" ? "CRNo" : "CivilID"] = client.id_no;
    values.SignatoryName = client.signatory_name;
    values.SignatoryID = client.signatory_id;
    values.Location = [client.village, client.wilaya, client.governorate].filter(Boolean).join(", ");
  }
  const points = project?.account_no ? [{ account_no: project.account_no, location: "" }] : [];
  return { template, lang: query.lang === "ar" ? "ar" : "en", date: today(), values, points,
           client_id: client?.id ?? null, project_id: project?.id ?? null };
}

export async function route(main, { params, query }) {
  const rest = String(params.rest || "");
  const all = await loadAll();
  let letter;
  if (rest === "new") letter = prefill(all, query);
  else {
    letter = await db.get("letters", Number(rest));
    if (!letter) { main.innerHTML = `<div class="panel empty">Letter not found.</div>`; return; }
  }
  form(main, letter, all);
}

function pointRow(p = {}) {
  return html`<tr><td class="muted"></td><td><input dir="auto" name="account_no" value="${p.account_no || ""}" inputmode="numeric"></td>
<td><input dir="auto" name="location" value="${p.location || ""}"></td></tr>`;
}

function form(main, letter, all) {
  const saved = Boolean(letter.id);
  const v = letter.values || {};
  const rows = [...(letter.points || [])];
  while (rows.length < 3) rows.push({});
  const client = all.client.get(letter.client_id);
  const project = all.projects.find((p) => p.id === letter.project_id);
  setTitle(saved ? `Letter: ${v.ClientName || "no name"}` : "New letter");

  const audienceFields = (aud) => AUDIENCE_FIELDS[aud].map(([k, label, cls]) =>
    html`<label class="${cls || ""}">${label} <input dir="auto" name="${k}" value="${v[k] || ""}"></label>`);

  main.innerHTML = html`
<div class="head">
  <div><h1>${saved ? v.ClientName || "Letter" : "New letter"}</h1>
    <div class="muted">${templateName(letter.template)}${client ? html` · <a href="#/clients/${client.id}">${client.name}</a>` : ""}${project ? html` · <a href="#/projects/${project.id}">${project.name}</a>` : ""}</div></div>
  <div class="actions"><button class="btn sun" id="download" type="button">Download Word</button></div>
</div>
<form id="letter-form" class="panel">
  <div class="fields">
    <label>Letter <select name="template">${Object.keys(TEMPLATES).map((k) => html`<option value="${k}" ${k === letter.template ? "selected" : ""}>${templateName(k)}</option>`)}</select></label>
    <label>Language <select name="lang">${Object.entries(LANGS).map(([k, label]) => html`<option value="${k}" ${k === letter.lang ? "selected" : ""}>${label}</option>`)}</select></label>
    <label>Date <input name="date" type="date" value="${letter.date || ""}"></label>
    <label>Client <select name="client_id"><option value="">—</option>${byName(all.clients).map((c) => html`<option value="${c.id}" ${c.id === letter.client_id ? "selected" : ""}>${c.name}</option>`)}</select>
      <span class="hint">Choosing one fills in the details below</span></label>
  </div>

  <h2 class="spaced-top">Client details</h2>
  <p class="small muted">Anything left blank prints as a line to fill in by hand.</p>
  <div class="fields" id="audience-fields">${audienceFields(audienceOf(letter.template))}</div>
  <div class="fields" style="margin-top:12px"><label class="wide">Premises location <input dir="auto" name="Location" value="${v.Location || ""}"></label></div>

  <h2 class="spaced-top">Electricity accounts</h2>
  <table class="points">
    <thead><tr><th>#</th><th>Account No.</th><th>Location / description</th></tr></thead>
    <tbody id="points">${rows.map(pointRow)}</tbody>
  </table>
  <p><button class="btn small" type="button" id="add-row">Add a row</button> <span class="small muted">Empty rows print as lines to fill in.</span></p>

  <div class="bar">
    <a class="btn" href="#/letters">Cancel</a>
    <button class="btn primary">Save letter</button>
  </div>
</form>
${saved ? html`<button class="btn danger small" id="delete" data-confirm="Delete this letter?">Delete letter</button>` : ""}`;

  const f = main.querySelector("#letter-form");
  const number = () => main.querySelectorAll("#points tr").forEach((tr, i) => { tr.firstElementChild.textContent = i + 1; });
  number();

  // Read the form back into a letter record.
  const collect = () => {
    const fd = new FormData(f);
    const rec = { ...letter, template: str(fd, "template"), lang: str(fd, "lang"), date: str(fd, "date"),
                  client_id: Number(str(fd, "client_id")) || null, values: { ...letter.values } };
    for (const k of VALUE_KEYS) if (fd.has(k)) rec.values[k] = str(fd, k);
    rec.points = [...main.querySelectorAll("#points tr")].map((tr) => ({
      account_no: tr.querySelector('[name="account_no"]').value.trim(),
      location: tr.querySelector('[name="location"]').value.trim(),
    })).filter((p) => p.account_no || p.location);
    return rec;
  };

  // Switching between commercial and residential swaps the client fields; changing the client refills them.
  f.template.addEventListener("change", () => form(main, collect(), all));
  f.client_id.addEventListener("change", () => {
    const fresh = prefill(all, { client_id: f.client_id.value, template: f.template.value });
    form(main, { ...collect(), values: fresh.values, client_id: fresh.client_id }, all);
  });
  main.querySelector("#add-row").addEventListener("click", () => {
    main.querySelector("#points").insertAdjacentHTML("beforeend", String(pointRow()));
    number();
  });
  main.querySelector("#download").addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await downloadLetter(collect()); } finally { e.target.disabled = false; }
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = await db.put("letters", collect());
    toast("Letter saved.");
    go(`#/letters/${id}`);
  });
  main.querySelector("#delete")?.addEventListener("click", async () => {
    await db.del("letters", letter.id);
    toast("Letter deleted.");
    go("#/letters");
  });
}
