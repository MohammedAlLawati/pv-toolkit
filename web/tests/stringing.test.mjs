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
