// Stringing calculator: agrees with the sizing engine, and its suggested layouts pass the hard rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUNGROW_MENA, JINKO_MODULES } from "../js/seed_data.js";
import { syncMpptSummary } from "../js/equipment_fields.js";
import { defaults } from "../js/sizing/rules.js";
import { check, designFrom, blocked, moduleValues, stringRange, temperatures } from "../js/sizing/engine.js";
import { checkLayout, fillLayout, lengthCheck, mpptCapacity, splitModules, stringLimits } from "../js/sizing/stringing.js";

const s = defaults();
const invs = SUNGROW_MENA.map((v, i) => syncMpptSummary({ ...v, id: i + 1 }));
const byModel = (m) => invs.find((v) => v.model === m);

test("string length range matches the sizing engine", () => {
  for (const m of JINKO_MODULES) for (const inv of invs) for (const hv of [false, true]) {
    const d = { t_min_c: 2, t_max_c: 52, hv_connectors: hv };
    const lim = stringLimits(m, inv, d, s);
    const mv = moduleValues(m, temperatures(d, s, m), s);
    assert.deepEqual(lim.range, stringRange(m, inv, mv, s, hv), `${m.model} / ${inv.model} hv=${hv}`);
    if (lim.range) {
      assert.notEqual(lengthCheck(lim.range[0], lim, s).status, "fail");
      assert.notEqual(lengthCheck(lim.range[1], lim, s).status, "fail");
      assert.equal(lengthCheck(lim.range[1] + 1, lim, s).status, "fail");
    }
  }
});

test("a single-length suggestion passes the project rules check", () => {
  const m = JINKO_MODULES.find((x) => x.model.startsWith("JKM620"));
  for (const model of ["SG10RT-P2", "SG50CX-P2", "SG125CX-P2", "SG150CX"]) {
    const inv = byModel(model);
    const lim = stringLimits(m, inv, {}, s), caps = mpptCapacity(inv, lim, s);
    const f = fillLayout(lim, caps, 10000, { maxLengths: 1 });
    assert.ok(f, model);
    const res = checkLayout(m, inv, lim, caps, f.rows, s);
    assert.notEqual(res.status, "fail", model);
    const layout = f.rows.map((r) => r.strings).join("/");
    const r = check(designFrom({ phases: 3, inverter_qty: 1, module_count: f.modules, strings: f.strings, mppt_layout: layout }, m, inv), s);
    assert.ok(!r.checks.some((c) => c.status === "fail" && !["dc_power", "dcac_band"].includes(c.key)), `${model}: ${JSON.stringify(r.checks.filter((c) => c.status === "fail"))}`);
    assert.ok(!blocked(r) || r.checks.some((c) => c.status === "fail"), model);
  }
});

test("two string lengths on separate MPPTs reach an exact module count", () => {
  const m = JINKO_MODULES.find((x) => x.model.startsWith("JKM710"));
  const inv = byModel("SG50CX-P2");
  const lim = stringLimits(m, inv, {}, s), caps = mpptCapacity(inv, lim, s);
  const f = fillLayout(lim, caps, 50);
  assert.equal(f.modules, 50);
  assert.deepEqual(f.rows.map((r) => [r.strings, r.length]), [[1, 17], [1, 17], [1, 16], [0, null]]);
  for (const target of [7, 23, 41, 60, 75, 84, 200]) {
    const g = fillLayout(lim, caps, target);
    assert.ok(g.modules <= target, `target ${target}`);
    assert.notEqual(checkLayout(m, inv, lim, caps, g.rows, s).mppts.some((r) => r.status === "fail"), true, `target ${target}`);
  }
});

test("layout check flags voltage and current breaches per MPPT", () => {
  const m = JINKO_MODULES.find((x) => x.model.startsWith("JKM710"));
  const inv = byModel("SG50CX-P2");
  const lim = stringLimits(m, inv, {}, s), caps = mpptCapacity(inv, lim, s);
  const res = checkLayout(m, inv, lim, caps, [{ strings: 1, length: 18 }, { strings: 2, length: 18 }, { strings: 1, length: 25 }], s);
  assert.equal(res.mppts[0].status, "pass");
  assert.equal(res.mppts[1].status, "fail"); // 2 × 25.7 A > 40 A
  assert.equal(res.mppts[2].status, "fail"); // Voc over 1100 V
  assert.equal(res.status, "fail");
  assert.equal(res.modules, 18 * 3 + 25);
});

test("modules split over inverters", () => {
  assert.deepEqual(splitModules(250, 3), [{ count: 2, modules: 83 }, { count: 1, modules: 84 }]);
  assert.deepEqual(splitModules(120, 2), [{ count: 2, modules: 60 }]);
});

test("proposed designs: whole panel count, inside the MPPT voltage window, ratio band", async () => {
  const { proposeDesigns, designFor } = await import("../js/sizing/stringing.js");
  const d = { t_min_c: 0, t_max_c: 60 };
  for (const m of JINKO_MODULES) for (const n of [14, 81, 161, 474, 1400]) {
    const opts = proposeDesigns(m, invs, d, s, { modules: n, ratioMin: 0.8, ratioMax: 1.25 });
    for (const o of opts) {
      assert.equal(o.modules, n, `${m.model} ${n}: ${o.label} places every panel`);
      assert.ok(o.ratio >= 0.8 - 1e-9 && o.ratio <= 1.25 + 1e-9, `${o.label} ratio ${o.ratio}`);
      for (const p of o.parts) for (const gr of p.groups) for (const r of gr.fill.rows) if (r.strings) {
        assert.ok(r.length * p.lim.mv.voc_cold <= p.inverter.mppt_max_v + 1e-9, `${o.label}: ${r.length} modules exceed the MPPT max.`);
        assert.ok(r.length * p.lim.mv.vmp_hot >= p.inverter.mppt_min_v - 1e-9, `${o.label}: ${r.length} modules under the MPPT min.`);
      }
      for (const p of o.parts) for (const gr of p.groups) assert.ok(!gr.check.mppts.some((r) => r.status === "fail"), o.label);
    }
  }
});

test("341.28 kWp of 720 Wp panels: 2 × SG150CX is proposed and checks out", async () => {
  const { proposeDesigns, designFor } = await import("../js/sizing/stringing.js");
  const m = JINKO_MODULES.find((x) => x.wp === 720);
  const d = { t_min_c: 0, t_max_c: 60 };
  const opts = proposeDesigns(m, invs, d, s, { modules: 474 });
  assert.ok(opts.some((o) => o.label === "2 × SG150CX"), opts.map((o) => o.label).join(", "));
  const mine = designFor(m, [{ inverter: byModel("SG150CX"), qty: 2 }], d, s, { modules: 474 });
  assert.ok(mine.ok, mine.issues.join("; "));
  assert.equal(mine.modules, 474);
  // series alone can't: 7 MPPTs × 1 string × 19 modules = 133 per inverter
  assert.ok(mine.parallel > 0);
  // a configuration that can't take every panel is reported, not hidden
  const small = designFor(m, [{ inverter: byModel("SG50CX-P2"), qty: 1 }], d, s, { modules: 474 });
  assert.equal(small.ok, false);
  assert.ok(small.issues.some((x) => /add inverter capacity/.test(x)), small.issues.join("; "));
});

test("method worked example: 370 × 720 Wp on 2 × SG125CX-P2 fills every input evenly", async () => {
  const { designFor } = await import("../js/sizing/stringing.js");
  const m = JINKO_MODULES.find((x) => x.wp === 720);
  const d = { t_min_c: 0, t_max_c: 60 };
  const des = designFor(m, [{ inverter: byModel("SG125CX-P2"), qty: 2 }], d, s, { modules: 370 });
  assert.ok(des.ok, des.issues.join("; "));
  assert.equal(des.modules, 370);
  const x = des.parts[0].method;
  assert.equal(x.U, 24);
  assert.equal(x.n, 24);
  assert.equal(x.L, 15);
  assert.equal(x.r, 10);
  for (const inv of x.inverters) {
    assert.equal(inv.strings, 12);
    assert.equal(inv.longs, 5);
    assert.equal(inv.modules, 5 * 16 + 7 * 15);
    // strings sharing an MPPT have the same length
    for (const r of inv.rows) if (r.strings) assert.ok(r.length === 15 || r.length === 16);
  }
  // one string per MPPT halves the usable inputs on the SG150CX (7 MPPTs, 2 strings each)
  const two = designFor(m, [{ inverter: byModel("SG150CX"), qty: 2 }], d, s, { modules: 474 });
  const one = designFor(m, [{ inverter: byModel("SG150CX"), qty: 2 }], d, s, { modules: 474, seriesOnly: true });
  assert.equal(two.parts[0].method.U, 28);
  assert.equal(one.parts[0].method.U, 14);
  assert.equal(one.ok, false);
});
