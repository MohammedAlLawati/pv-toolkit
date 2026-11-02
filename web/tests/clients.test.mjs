// The client record: Google Maps links, required capacity and the defaults it gives a design record.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocation, isShortMapsLink, requiredCapacity, splitMeters, withClientDefaults, clientView, mapsUrl }
  from "../js/clients/model.js";

test("coordinates come out of the usual Google Maps links", () => {
  const cases = [
    ["https://www.google.com/maps/place/Muscat/@23.5880,58.3829,15z", [23.588, 58.3829]],
    // a pinned place beats the map's view centre
    ["https://www.google.com/maps/place/HTC/@23.60,58.40,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d23.6012345!4d58.4123456", [23.6012345, 58.4123456]],
    ["https://maps.google.com/?q=23.5880,58.3829", [23.588, 58.3829]],
    ["https://www.google.com/maps/search/?api=1&query=23.5880%2C58.3829", [23.588, 58.3829]],
    ["https://www.google.com/maps?ll=17.0194,54.0897&z=12", [17.0194, 54.0897]],
    ["https://www.google.com/maps/search/23.5880,+58.3829?entry=ttu", [23.588, 58.3829]],
    ["https://www.google.com/maps/dir/?api=1&destination=24.1,56.8", [24.1, 56.8]],
    ["23.5880, 58.3829", [23.588, 58.3829]],
    ["-33.86 151.21", [-33.86, 151.21]],
  ];
  for (const [url, [lat, lon]] of cases) assert.deepEqual(parseLocation(url), { lat, lon }, url);
});

test("links without coordinates give nothing", () => {
  assert.equal(parseLocation(""), null);
  assert.equal(parseLocation("https://maps.app.goo.gl/AbCdEf123"), null);
  assert.equal(parseLocation("https://www.google.com/maps/place/Muscat"), null);
  assert.equal(parseLocation("123.0, 58.0"), null);   // latitude out of range
  assert.ok(isShortMapsLink("https://maps.app.goo.gl/AbCdEf123"));
  assert.ok(!isShortMapsLink("https://www.google.com/maps/@23.5,58.3,15z"));
  assert.equal(mapsUrl(23.5, 58.3), "https://www.google.com/maps/search/?api=1&query=23.5,58.3");
  assert.equal(mapsUrl(null, 58.3), "");
});

test("required capacity reads in kWp or kWac", () => {
  assert.deepEqual(requiredCapacity({ required_capacity_kw: 150, required_capacity_unit: "dc" }), { kw: 150, unit: "dc", label: "150 kWp" });
  assert.deepEqual(requiredCapacity({ required_capacity_kw: 100, required_capacity_unit: "ac" }), { kw: 100, unit: "ac", label: "100 kWac" });
  assert.equal(requiredCapacity({ required_capacity_kw: null }), null);
  assert.equal(requiredCapacity({ required_capacity_kw: 0 }), null);
});

test("meter numbers keep their leading zeros", () => {
  assert.deepEqual(splitMeters("08023459, 30012345\n0001"), ["08023459", "30012345", "0001"]);
});

test("a design record takes the site and type from its client", () => {
  const c = { client_type: "commercial", latitude: 23.6, longitude: 58.4, meter_numbers: ["0801", "0802"], installation_types: ["Carpark", "Elevated Flat Roof"] };
  const p = withClientDefaults({ premises_type: "residential", latitude: 20, longitude: 50, account_no: "", installation_type: "" }, c);
  assert.equal(p.latitude, 23.6);
  assert.equal(p.longitude, 58.4);
  assert.equal(p.premises_type, "commercial");
  assert.equal(p.account_no, "0801");
  assert.equal(p.installation_type, "Carpark / Elevated Flat Roof");
  // the design record's own meter and installation type win
  const q = withClientDefaults({ account_no: "0802", installation_type: "Ballasted" }, c);
  assert.equal(q.account_no, "0802");
  assert.equal(q.installation_type, "Ballasted");
  // a client without a location leaves the record's own coordinates alone
  const r = withClientDefaults({ latitude: 20, longitude: 50 }, { client_type: "other" });
  assert.equal(r.latitude, 20);
  assert.equal(r.premises_type, undefined);
});

test("older clients read as residential or commercial", () => {
  assert.equal(clientView({ name: "A" }).client_type, "residential");
  assert.equal(clientView({ name: "B LLC", signatory_name: "X" }).client_type, "commercial");
  assert.deepEqual(clientView({ name: "C" }).meter_numbers, []);
});
