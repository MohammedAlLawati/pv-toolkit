// Documents: every piece of paperwork in one place. NAMA forms and execution agreements
// (pages/forms.js) and NEDC letters (pages/letters.js), each filled in on its own, not tied to
// a project. The offer deck has its own section.
import { html, shortDate } from "../ui.js";
import * as db from "../store.js";
import { byUpdated } from "../data.js";
import { TEMPLATES } from "../letters/defaults.js";
import { formsTable, newFormPanel } from "./forms.js";
import { setTitle } from "../app.js";

const LANGS = { en: "English", ar: "Arabic" };
const templateName = (key) => TEMPLATES[key]?.en.name || key;

export async function documents(main) {
  setTitle("Documents");
  const forms = byUpdated(await db.list("forms")).slice(0, 8);
  const letters = byUpdated(await db.list("letters")).slice(0, 8);
  const head = await db.getFile("letterhead_top");

  main.innerHTML = html`
<div class="head">
  <div><h1>Documents</h1><div class="muted">NAMA forms, execution agreements and NEDC letters. Pick one, fill in what it asks for, preview it and download it.</div></div>
</div>

<div class="grid2">
  <div>
    ${newFormPanel()}
    <div class="panel">
      <div class="panel-head"><h2>Recent forms</h2><a class="small" href="#/forms">All forms</a></div>
      ${forms.length ? formsTable(forms) : html`<div class="empty">No forms yet.</div>`}
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>NEDC letters</h2><a class="btn small primary" href="#/letters/new">New letter</a></div>
    ${head ? "" : html`<div class="flash warn">No letterhead uploaded yet, so letters print on plain paper. <a href="#/settings">Upload it in Settings</a>.</div>`}
    ${letters.length ? html`<table>
      <thead><tr><th>Client</th><th>Letter</th><th>Date</th></tr></thead>
      <tbody>${letters.map((l) => html`<tr><td><a href="#/letters/${l.id}">${l.values?.ClientName || "(no name)"}</a></td>
        <td>${templateName(l.template)} · ${LANGS[l.lang]}</td><td>${shortDate(l.date)}</td></tr>`)}</tbody>
    </table>` : html`<div class="empty">No letters yet.</div>`}
    <p class="spaced-top"><a class="btn" href="#/letters">All letters and blank templates</a></p>
  </div>
</div>`;
}
