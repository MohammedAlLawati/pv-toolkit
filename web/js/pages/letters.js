// Placeholder until the letters page lands (the letter builder is in js/letters/).
import { html } from "../ui.js";
import { setTitle } from "../app.js";

export async function list(main) {
  setTitle("Letters");
  main.innerHTML = html`<div class="head"><div><h1>Letters</h1><div class="muted">Letters to NEDC and others on your letterhead.</div></div></div>
<div class="panel empty">The letters page is being added next.</div>`;
}
export const route = list;
