// Forms: NAMA forms and the execution agreement as standalone documents, set up like the
// letters. Pick a form, fill in only the inputs that form uses (optionally starting from a
// client, project or library equipment), preview it, save it and download it as Word.
import { download, fileUrl, go, html, raw, readImage, shortDate, toast } from "../ui.js";
import * as db from "../store.js";
import { byName, byUpdated, loadAll, sortInverters, sortModules } from "../data.js";
import { setTitle } from "../app.js";
import { generate } from "../docgen/generate.js";
import { templateFor } from "../docgen/context.js";
import { inverterLabel, moduleLabel } from "../equipment_fields.js";
import { DEFAULTS, FORM_TYPES, fieldsFor, formTitle, fromClient, fromInverter, fromModule, fromProject,
         templateKeys, toProject } from "../forms/fields.js";
import { fit, renderPreview } from "../forms/preview.js";

const keyCache = new Map();
async function keysFor(type, values) {
  const name = templateFor(type, toProject(values));
  if (!keyCache.has(name)) {
    const res = await fetch("templates/" + name);
    if (!res.ok) throw new Error(`Template ${name} is missing (${res.status}).`);
    keyCache.set(name, await templateKeys(await res.arrayBuffer()));
  }
  return keyCache.get(name);
}

async function build(form, parties) {
  return generate(form.type, toProject(form.values, parties));
}

const nameOf = (f) => f.values?.client_name || "(no name)";

// ---- list --------------------------------------------------------------------------------

export async function list(main) {
  setTitle("Forms");
  const forms = byUpdated(await db.list("forms"));
  main.innerHTML = html`
<div class="head">
  <div><h1>Forms</h1><div class="muted">NAMA forms and execution agreements. Each one asks only for what that form needs.</div></div>
</div>
${newFormPanel()}
<div class="panel">
  <h2>Saved forms</h2>
  ${forms.length ? formsTable(forms) : html`<div class="empty">No forms yet. Start one above.</div>`}
</div>`;
}

/** "New form" buttons, one per form. Also used on the Documents page. */
export function newFormPanel() {
  return html`<div class="panel">
  <h2>New form</h2>
  ${Object.entries(FORM_TYPES).map(([type, t]) => html`
  <div class="doc"><div><b>${t.title}</b>${t.note ? html`<div class="small muted">${t.note}</div>` : ""}</div>
    <div class="btns"><a class="btn small primary" href="#/forms/new?type=${type}">Fill in</a></div></div>`)}
</div>`;
}

export function formsTable(forms) {
  return html`<table>
    <thead><tr><th>Client</th><th>Form</th><th>Updated</th></tr></thead>
    <tbody>${forms.map((f) => html`<tr><td><a href="#/forms/${f.id}">${nameOf(f)}</a></td>
      <td>${formTitle(f.type, f.values)}</td><td>${shortDate(f.updated_at)}</td></tr>`)}</tbody>
  </table>`;
}

// ---- one form ----------------------------------------------------------------------------

export async function route(main, { params, query }) {
  const rest = String(params.rest || "");
  const all = await loadAll();
  let form;
  if (rest === "new") {
    const type = FORM_TYPES[query.type] ? query.type : "initial";
    const project = query.project_id ? all.projects.find((p) => p.id === Number(query.project_id)) : null;
    const client = query.client_id ? all.client.get(Number(query.client_id)) : null;
    const def = (kind) => all.parties.find((x) => x.kind === kind && x.is_default)?.id;
    form = { type, values: { ...DEFAULTS, consultant_id: def("consultant"), contractor_id: def("contractor"),
                             ...fromClient(client), ...fromProject(project, all) } };
  } else {
    form = await db.get("forms", Number(rest));
    if (!form) { main.innerHTML = `<div class="panel empty">Form not found. <a href="#/forms">All forms</a></div>`; return; }
  }
  await render(main, form, all);
}

function input(f, v) {
  const val = v[f.key] ?? "";
  const hint = f.hint ? html`<span class="hint">${f.hint}</span>` : "";
  const cls = f.wide ? "wide" : "";
  switch (f.kind) {
    case "select":
      return html`<label class="${cls}">${f.label} <select name="${f.key}">${f.options.map((o) => html`<option value="${o.v}" ${String(val) === String(o.v) ? "selected" : ""}>${o.label}</option>`)}</select>${hint}</label>`;
    case "check":
      return html`<label class="check ${cls}"><input type="checkbox" name="${f.key}" ${val ? "checked" : ""}> ${f.label}</label>`;
    case "party":
      return html`<label class="${cls}">${f.label} <select name="${f.key}" data-party="${f.party}"></select>
        <span class="hint"><a href="#/parties/new?kind=${f.party}">Add one</a></span></label>`;
    case "image":
      return html`<label class="${cls}">${f.label} <input type="file" name="${f.key}" accept="image/*">${hint}
        <span id="img-${f.key}"></span></label>`;
    default:
      return html`<label class="${cls}">${f.label} <input dir="auto" name="${f.key}" value="${val}" ${f.kind === "number" ? raw('inputmode="decimal"') : ""} ${f.kind === "date" ? raw('type="date"') : ""}>${hint}</label>`;
  }
}

async function render(main, form, all) {
  const saved = Boolean(form.id);
  const v = form.values || {};
  const fields = fieldsFor(await keysFor(form.type, v));
  const groups = [...new Set(fields.map((f) => f.group))];
  const hasModule = fields.some((f) => f.key.startsWith("module_"));
  const hasInverter = fields.some((f) => f.key.startsWith("inverter_"));
  setTitle(saved ? `${FORM_TYPES[form.type].short}: ${nameOf(form)}` : `New ${FORM_TYPES[form.type].short}`);

  main.innerHTML = html`
<div class="head">
  <div><h1>${saved ? nameOf(form) : "New form"}</h1><div class="muted" id="form-title">${formTitle(form.type, v)}</div></div>
  <div class="actions"><button class="btn" id="preview-btn" type="button">Preview</button><button class="btn sun" id="download" type="button">Download Word</button></div>
</div>
<form id="form" class="panel">
  <div class="fields">
    <label>Form <select name="type">${Object.entries(FORM_TYPES).map(([k, t]) => html`<option value="${k}" ${k === form.type ? "selected" : ""}>${t.title}</option>`)}</select></label>
    <label>Fill from a client <select id="from-client"><option value="">—</option>${byName(all.clients).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></label>
    <label>Fill from a project <select id="from-project"><option value="">—</option>${byName(all.projects).map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></label>
    ${hasModule ? html`<label>Module from the library <select id="from-module"><option value="">—</option>${sortModules(all.modules).map((m) => html`<option value="${m.id}">${moduleLabel(m)}</option>`)}</select></label>` : ""}
    ${hasInverter ? html`<label>Inverter from the library <select id="from-inverter"><option value="">—</option>${sortInverters(all.inverters).map((i) => html`<option value="${i.id}">${inverterLabel(i)}</option>`)}</select></label>` : ""}
  </div>
  <p class="small muted">Only what this form uses is asked for. Anything left blank stays empty in the document, to fill in by hand.</p>
  ${groups.map((g) => html`<h2 class="spaced-top">${g}</h2>
  <div class="fields">${fields.filter((f) => f.group === g).map((f) => input(f, v))}</div>`)}
  <div class="bar">
    <a class="btn" href="#/forms">Cancel</a>
    <button class="btn primary">Save form</button>
  </div>
</form>
<div class="panel">
  <div class="panel-head"><h2>Preview</h2><span class="small muted" id="preview-note"></span></div>
  <div id="preview" class="preview-area"><div class="empty">Press Preview to see the filled form.</div></div>
</div>
${saved ? html`<button class="btn danger small" id="delete" data-confirm="Delete this form?">Delete form</button>` : ""}`;

  const f = main.querySelector("#form");
  for (const s of f.querySelectorAll("select[data-party]")) {
    const kind = s.dataset.party;
    const key = s.name;
    s.innerHTML = String(html`<option value="">None</option>${byName(all.parties.filter((x) => x.kind === kind)).map((x) =>
      html`<option value="${x.id}" ${x.id === Number(v[key]) ? "selected" : ""}>${x.name}</option>`)}`);
  }
  const layout = fields.find((x) => x.kind === "image");
  if (layout && v[layout.key]) {
    const rec = await db.getFile(v[layout.key]);
    if (rec) main.querySelector(`#img-${layout.key}`).innerHTML = String(html`<img class="stamp-preview" src="${fileUrl(rec)}" alt="">
      <span class="check"><input type="checkbox" name="remove_${layout.key}"> Remove</span>`);
  }

  // Read the inputs back into the form record (pictures are handled on save).
  const collect = () => {
    const values = { ...form.values };
    for (const fld of fields) {
      const el = f.elements[fld.key];
      if (!el || fld.kind === "image") continue;
      values[fld.key] = fld.kind === "check" ? el.checked : el.value.trim();
    }
    return { ...form, type: f.elements.type.value, values };
  };
  const refill = (extra) => render(main, { ...collect(), values: { ...collect().values, ...extra } }, all);

  f.elements.type.addEventListener("change", () => render(main, collect(), all));
  main.querySelector("#from-client").addEventListener("change", (e) => e.target.value && refill(fromClient(all.client.get(Number(e.target.value)))));
  main.querySelector("#from-project").addEventListener("change", (e) => e.target.value && refill(fromProject(all.projects.find((p) => p.id === Number(e.target.value)), all)));
  main.querySelector("#from-module")?.addEventListener("change", (e) => e.target.value && refill(fromModule(all.module.get(Number(e.target.value)))));
  main.querySelector("#from-inverter")?.addEventListener("change", (e) => e.target.value && refill(fromInverter(all.inverter.get(Number(e.target.value)))));
  // The New Connection form switches between its above / below 11 kW templates with the AC capacity.
  f.addEventListener("input", () => { main.querySelector("#form-title").textContent = formTitle(f.elements.type.value, collect().values); });

  const busy = async (btn, fn) => {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Working…";
    try { await fn(); } catch (err) { console.error(err); toast("Couldn't make the form: " + err.message, "error"); }
    finally { btn.disabled = false; btn.textContent = label; }
  };
  const area = main.querySelector("#preview");
  const showPreview = async () => {
    const out = await build(collect(), all.parties);
    await renderPreview(out.blob, area);
    main.querySelector("#preview-note").textContent = "The Word file is the final version; the preview can differ slightly.";
    return out;
  };
  main.querySelector("#preview-btn").addEventListener("click", (e) => busy(e.target, async () => {
    await showPreview();
    area.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
  main.querySelector("#download").addEventListener("click", (e) => busy(e.target, async () => {
    const { blob, filename } = await build(collect(), all.parties);
    download(blob, filename);
  }));
  const onResize = () => (document.body.contains(area) ? fit(area) : window.removeEventListener("resize", onResize));
  window.addEventListener("resize", onResize);

  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rec = collect();
    if (layout) {
      const file = f.elements[layout.key]?.files?.[0];
      const remove = f.elements[`remove_${layout.key}`]?.checked;
      if (file || remove) {
        await db.delFile(rec.values[layout.key]);
        rec.values[layout.key] = null;
      }
      if (file) {
        const img = await readImage(file);
        rec.values[layout.key] = await db.putFile(img.blob, file.name, { width: img.width, height: img.height, kind: "layout" });
      }
    }
    const id = await db.put("forms", rec);
    toast("Form saved.");
    go(`#/forms/${id}`);
  });
  main.querySelector("#delete")?.addEventListener("click", async () => {
    await db.delFile(form.values?.layout_file_id);
    await db.del("forms", form.id);
    toast("Form deleted.");
    go("#/forms");
  });

  if (saved) busy(main.querySelector("#preview-btn"), showPreview);
}
