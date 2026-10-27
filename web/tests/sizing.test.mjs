// The JavaScript engine must give exactly the results of the Python engine it was ported from.
// Fixture: web/tests/fixtures/sizing_cases.json (made from app/sizing/engine.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check, recommend, designFrom } from "../js/sizing/engine.js";
import { syncMpptSummary } from "../js/equipment_fields.js";
import { SUNGROW_MENA } from "../js/seed_data.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/sizing_cases.json", import.meta.url)));
const invs = SUNGROW_MENA.map((v, i) => syncMpptSummary({ ...v, id: i + 1 }));
const byId = Object.fromEntries(invs.map((v) => [v.id, v]));

const close = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : a === b);

test("rules check matches the Python engine", () => {
  for (const c of fx.cases) {
    const d = designFrom({ phases: 3, ...c.d }, fx.modules[c.m], byId[c.inv]);
    const r = check(d, fx.settings[c.s]);
    const ctx = `${fx.modules[c.m].model} / ${byId[c.inv].model} / ${JSON.stringify(c.d)} / s${c.s}`;
    assert.deepEqual(r.checks.map((k) => [k.key, k.status, k.detail, k.value, k.limit]), c.r.checks, ctx);
    assert.deepEqual(r.string_range, c.r.range, ctx);
    assert.deepEqual(r.groups.map((g) => [g.count, g.strings, g.mppts.map((m) => m.strings), g.overflow]), c.r.groups, ctx);
    assert.deepEqual(r.notes, c.r.notes, ctx);
    for (const [k, v] of Object.entries(c.r.cables)) assert.ok(close(r.cables[k], v), `${ctx} cable ${k}`);
  }
});

test("recommendations match the Python engine", () => {
  for (const c of fx.recs) {
    const base = designFrom({ phases: 3, inverter_qty: 1, module_count: 1, strings: 1 }, fx.modules[c.m], null);
    const got = recommend(base, invs, fx.settings[0], c.kind, c.t).map((o) => [o.inverter.id, o.inverter_qty, o.modules_per_string, o.strings]);
    assert.deepEqual(got, c.r, `${fx.modules[c.m].model} ${c.kind} ${c.t}`);
  }
});
