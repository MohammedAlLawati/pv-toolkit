# PV Toolkit: project handoff

*Handoff from the build sessions of 20–21 Oct 2026, for the Claude continuing this project.
Read this first. The code is in `pv-toolkit.zip` (git history included in the repo copy).*

---

## 1. Who the user is and what they want

- **User:** Mohammed (mohjlaw@gmail.com).
  - Solar PV engineer at **HTC (Hussam Technology Company), Muscat, Oman**. HTC is an EPC
    contractor for grid-connected PV. GreenOps is its engineering partner on consultancy work.
  - Timezone: Asia/Muscat (UTC+4).
- **Day-to-day work:**
  1. **Offer decks.** Techno-commercial offers in PowerPoint, usually adapted from previous
     offers. Residential clients get a Word "Execution Agreement" instead of a deck.
  2. **Authority paperwork.** NAMA (electricity distribution company) and municipality forms
     filled with client and system data. The forms differ by capacity.
  3. **String and inverter sizing**, plus yield estimates. He wants his own
     Helioscope/PVsyst-style tool.
- **Goal:** one private web app, with only him able to log in, that has a section for each
  task above.
- **Coding background:** "50/50". He has programmed before but nothing this size. Claude
  writes all the code, and he wants step-by-step deployment help.
- **Scale:** mostly residential and C&I, but utility scale must be considered. That includes
  transformer considerations: MV step-up for utility, and checks on spare capacity at the
  existing transformer for C&I.

### Requirements stated for the sizing tool (Phases 2–5, not built yet)

- **The tool recommends a complete design:** modules, strings per MPPT, inverters, DC/AC
  ratio, cables, transformer.
- **The user can then change anything.** Every change is checked against the rules.
  - If a **hard rule fails, report printing is blocked**. The tool must say which rule failed.
  - Softer issues are warnings only.
- **Design approaches the user picks from:**
  1. **Maximise area:** a visual layout drawn on satellite imagery (roofs, setbacks, keep-out
     zones).
  2. **Target capacity:** a DC kWp or AC kW target.
  3. **Consumption CSV:** design from the building's load profile (hourly, 15-min or monthly).
  4. **Multiple points of connection (POCs) on one site:** commercial sites often have
     several meters or accounts, e.g. the earlier Asyad project with 3 meters.
- **Data:** reputable, up-to-date, worldwide.
  - Planned: PVGIS (primary, covers Oman), NSRDB, ERA5 for record low temperatures.
  - Optional later: Meteonorm or Solcast.
  - Library: pvlib (Sandia National Labs).
- **Reports:** PVsyst-style PDF output.
- **Caveat agreed with the user:** expect results within a few percent of PVsyst for simple
  systems. Keep PVsyst for anything a bank or utility will scrutinise.

### Preferences and rules the user has given

- Every value on a form must come from the **individual project**: panel and inverter type,
  orientation, azimuth, tick marks, everything. Nothing may be fixed in a template.
- The design form's **"Documents Required" Yes/No/NA marks stay exactly as in his template**,
  not editable per project. This is now implemented.
- **Contractor and consultant** are chosen from dropdown lists that he can add to.
- **The 11 kW NAMA threshold applies to AC capacity.** Above 11 kW AC → "Above 11 kW" design
  form. 11 kW or less → "Below 11 kW" form. Exactly 11 kW uses "Below", and the app shows a
  warning.
- He welcomed the extras added without being asked: layout-image slot, reference code,
  consistency warnings.
- **Equipment:** new modules and inverters must be addable **by uploading datasheets, with the
  tool reading the values from them**. This is now implemented.

---

## 2. What exists now (Phases 1 and 1.5, done)

**Stack**
- Python 3.13, FastAPI, server-rendered Jinja2 pages, a little vanilla JS.
- SQLAlchemy 2, with SQLite by default (a single file, `data/app.db`).
- LibreOffice for DOCX → PDF conversion.
- Docker plus a Caddy reverse proxy (automatic HTTPS).
- No frontend build step. React was originally proposed, but server-rendered pages were chosen
  so a 50/50 coder can maintain the app. Leaflet or similar can be added for the map phase.

### Features

**Login (single user)**
- Password plus authenticator-app code. QR setup on first login.
- bcrypt with a SHA-256 pre-hash. A code can't be reused.
- 5 failures lock login for 15 minutes.
- Signed session cookie with a session version, so logout ends every session.
- CSRF token on every POST. Strict CSP and security headers.
- Users are created by CLI only: `python -m app.cli create-user`.

**Clients**
- Name, civil ID / C.R., mobile, telephone, e-mail, governorate, wilayat, village.

**Projects**
- Site details: premises type (residential, commercial, governmental, agricultural),
  connection type (self-investment, lease, hybrid), mounting (rooftop, car park, ground,
  other), installation type, height, area, latitude/longitude.
- System: module and count, strings, tilt, azimuth, inverter and quantity, phases, internal
  transformer, annual kWh.
- Commercial terms: price, VAT, tariff (bz/kWh), degradation.
- Paperwork: consultant, contractor, agency date, reference code, layout image, status.
- **Live summary** while editing: DC kWp, AC kW, DC/AC ratio, and which NAMA form will be used.
- **Consistency warnings:** phase mismatch with the inverter, modules not dividing evenly into
  strings, AC exactly 11 kW.
- Projects can be duplicated.

**Equipment library**
- **Inverters** are in categories: residential, C&I ("commercial" in code) and utility.
- **Per-MPPT lists** are stored as slash strings, e.g. `mppt_currents="32/16"`,
  `mppt_iscs="40/20"`, `mppt_strings="2/1"`.
  - Summary maxima are kept in sync: `max_current_per_mppt`, `max_isc_per_mppt`,
    `strings_per_mppt`.
- Each inverter and module shows a "sizing-ready" flag.
- **Datasheet upload:** a PDF, PNG or JPG goes through a reader, then a review screen with one
  column per model, editable values and sanity checks, then save. The datasheet is stored and
  linked to the equipment.
  - **Two readers:**
    - **Claude**, when `ANTHROPIC_API_KEY` is set. It sends the document to the Messages API
      with a forced tool call whose JSON schema is generated from the field registry. Model
      from `ANTHROPIC_MODEL`, default `claude-sonnet-5-5`.
    - **A pdfplumber text reader** as the fallback.
  - On the user's files, the text reader reads the 5 C&I and utility Sungrow sheets correctly.
    It **cannot** read the RT residential sheets, which have two overlapping text layers.
    Claude reads the rendered page, so it handles them.
  - **The Claude reader is only tested against a simulated API reply.** No key was available
    in the build environment, so it needs a live test.
  - **When a datasheet updates an existing model, blank fields keep the existing values.**
- **The Sungrow MENA range is built in:** 18 inverters, values entered by hand from the user's
  datasheets, datasheets attached. One-click load, or the `seed` / `import-sungrow` CLI
  commands.
  - **Residential:** SG5.0, 6.0, 7.0, 8.0, 10, 12, 15, 17 and 20RT-P2.
  - **C&I:** SG25, 30, 33, 36, 40 and 50CX-P2, SG125CX-P2 and SG150CX.
  - **Utility:** SG320HX-20.
  - **Design notes are saved per model**, for example:
    - The RT series goes to standby between 1000 and 1100 V DC. Above 1000 V system voltage
      it needs MC4 Evo2 connectors.
    - The SG150CX is rated 150 kW at 45 °C and 143 kW at 50 °C.
    - The SG320HX has an 800 V AC output and needs a dedicated MV step-up transformer.
- **The module library is effectively empty.** There's one starter Jinko JKM545M-72HL4-V
  without electrical values. Module datasheets were requested from the user and have not been
  received yet.

**Contractors and consultants**
- Each has a name, phone, e-mail, address, project engineer, an optional stamp image (PNG) and
  a "default" flag.
- They can be added inline from the project form.
- Seeded:
  - **Contractor:** Hussam Technology Company, +968 9782 9469, engineer Al Muataz Al Tougi,
    solar@htc.om.
  - **Consultant:** Sabla Engineering Consultant, 22011757, engineer Jamal Alzeedi.

**Documents** (Word or PDF; zip "NAMA submission pack" of initial + agency + design)

| Key | Document | Template file |
|---|---|---|
| `initial` | NAMA Solar PV Initial Service Application | `nama_initial_form.docx` |
| `agency` | NAMA Agency Contract (5 pages) | `nama_agency_contract.docx` |
| `design` | NAMA Design Approval Application, picked by AC capacity | `nama_design_above_11kw.docx` / `nama_design_below_11kw.docx` |
| `execution` | HTC Execution Agreement (residential offer/contract) | `execution_agreement.docx` |

- The project page lists the **missing fields** for each document. Documents still generate
  with blanks.

**Deployment**
- Files: `Dockerfile`, `docker-compose.yml` (app + Caddy), `Caddyfile`, `.env.example`
  (DOMAIN, SECRET_KEY, ANTHROPIC_API_KEY, ANTHROPIC_MODEL), and `backup.sh` (nightly SQLite
  backup, keeps 30).
- `DEPLOY.md` is a step-by-step guide:
  - Recommended server: AWS Lightsail Bahrain (2 GB) or Hetzner CX22, Ubuntu 24.04.
  - Steps cover the domain A record, ufw, Docker, `.env`, `docker compose up -d --build`,
    `create-user`, `seed`, cron backups, restore, and updating with git pull and rebuild.
- **Status:** the user had not confirmed deploying yet. The Docker image has **not** been
  test-built, because Docker Hub was blocked in the build sandbox. The Dockerfile falls back
  from `libreoffice-writer-nogui` to `libreoffice-writer`.

**Database upgrades:** `db.add_missing_columns()` runs at startup and adds any new model
columns (it never drops any). There is no Alembic yet.

**Tests:** `pytest -q` runs **14 end-to-end tests, all passing**. They cover:
- login and 2FA, including code replay
- the CSRF check
- the full project flow, with every document free of leftover `{{` placeholders
- the switch between the 11 kW forms
- the layout image and footer reference
- Sungrow import
- datasheet upload with both readers, the fallback and the sanity checks
- "blank keeps existing"
- the column upgrade on an old schema
- the fixed design checklist

---

## 3. How the document templates work (important for any template change)

- `source_templates/` holds the user's **original** files, untouched:
  - the 4 NAMA forms
  - `Execution_Agreement.docx`
  - `EPC_Offer_Template.pptx` (for Phase 6, not used yet)
- `tools/prepare_templates.py` builds the cleaned files in `app/doc_templates/`.
  **Re-run it after editing a source template**, then run `pytest -q`.
- **The NAMA forms are full-page scanned JPGs** with floating text boxes holding
  `{{Placeholders}}`.
  - The prep script turns the old fixed values into placeholders: Jinko, 2256×1133×35 mm,
    strings = 2, tilt 5, azimuth 208, 545 Wp, quantity 1, "RT".
  - It adds an azimuth box to the >11 kW form.
  - It normalises fonts and uses kWh for annual production.
  - **Tick marks and frames** are shapes tagged in `docPr@descr`:
    - `if:<flag>` shapes are removed unless the flag is true. Flags include
      `prem_residential|commercial|governmental|agricultural`, `conn_self|lease|hybrid`,
      `mount_rooftop|carpark|ground|other`, `phase1`/`phase3` and `trafo_yes`/`trafo_no`.
    - `doc:<row>:<default>|<yes_x>|<no_x>|<na_x>` marks the 21 Documents Required rows. The
      app always uses the template default.
    - `img:<key>` is an image slot: `consultant_stamp`, `contractor_stamp`, `layout`.
  - **Initial Form background:** the old consultant and contractor names, phones, engineers,
    signatures and stamps were removed from the scan with PIL. The consultant's Arabic labels
    were rebuilt from the contractor column. All value boxes were re-laid out in page
    coordinates.
- **Execution Agreement changes:**
  - Contractor block → `{{ContractorName/Address/Tel/Email}}`.
  - Module and inverter descriptions, Wp rating, inverter quantity and unit kW became
    placeholders.
  - Degradation % and tariff became placeholders.
  - The empty "Design Summary" box became an image slot for the project's layout picture.
  - The footer reads `Reference: HTC/{{Abbreviation}}/EA/01`. The code defaults to the
    client's initials.
- **Renderer** (`app/docgen/render.py` + `ooxml.py`):
  - Replaces placeholders even when Word has split them across runs, touching only the runs
    involved.
  - Handles headers and footers.
  - Converts to PDF with LibreOffice.
- **Placeholders available** (built in `app/docgen/context.py → build_values`):
  - **Client / site:** Name, FirstName, IDNo, Contact, Tel, Email, Governorate, Wilaya,
    Wilayat, Village, AccountNo, MeterNo, ProjectArea, InstallationType, Elevation.
  - **Modules / inverters:** ModuleMake, ModuleModel, PanelType, PanelCap, ModuleDims,
    ModuleDescription, PanelNo, NoofPVModules, Strings, Tilt, Azimuth, InverterMake,
    InverterModel, InverterDescription, InverterQty, InverterUnitKW.
  - **Capacity / energy:** Capacity, DCCapacity, InverterCap, ACCapacity, DCACRatio,
    AnnualGen (MWh), YearlyGen (MWh), AnnualGenKWh, Degradation.
  - **Commercial:** Subtotal, VAT, FinalPrice (OMR, 3 dp), TariffBz, TariffNote,
    CleanEnergyProduction (OMR/yr = kWh × tariff), PaybackPeriod.
  - **Dates / reference:** ENdate, Today, Abbreviation.
  - **Parties:** ConsultantName, ConsultantTel, ConsultantEngineer, ContractorName,
    ContractorTel, ContractorEngineer, ContractorEmail, ContractorAddress.

---

## 4. Code map

```
app/main.py              app, security headers, routers, error handlers
app/config.py            env settings (DATA_DIR, DATABASE_URL, SECRET_KEY, COOKIE_SECURE, SESSION_HOURS)
app/db.py                engine, init_db, add_missing_columns
app/models.py            User, Party, Client, Datasheet, Module, Inverter, Project (+ NAMA_DOC_ROWS)
app/security.py          passwords, TOTP, lockout, sessions, CSRF
app/web.py               Jinja setup, render/flash/redirect, form parsing helpers
app/cli.py               create-user, reset-2fa, set-password, unlock, seed, import-sungrow
app/equipment_fields.py  FIELD REGISTRY for modules/inverters: drives forms, Claude schema, review, checks
app/datasheets.py        extract() → Claude reader / text reader; check() sanity rules
app/seed/                sungrow_mena.py (18 inverters) + datasheets/*.pdf + import function
app/routes/auth.py       login, 2FA setup, logout
app/routes/records.py    dashboard, clients, contractors/consultants, account
app/routes/library.py    library list, upload → review → save, datasheet file, manual edit
app/routes/projects.py   projects CRUD, documents (/projects/{id}/documents/{key}.{docx|pdf}), pack.zip, layout image
app/docgen/              ooxml.py (docx editing), render.py (fill + PDF), context.py (project → values/flags)
app/templates/, static/  pages, style.css, app.js
tools/prepare_templates.py, source_templates/, app/doc_templates/
tests/                   conftest.py, test_app.py, test_library.py
```

To add an equipment field, add it to `equipment_fields.py` and to the model in `models.py`.
The column is added automatically on startup.

---

## 5. Roadmap: what's next

| Phase | Scope | Status |
|---|---|---|
| 1 | Login, clients, projects, NAMA forms, execution agreement | ✅ done |
| 1.5 | Datasheet upload and reading, categories, Sungrow range, fixed checklist | ✅ done |
| 2 | Sizing engine and rules check | ✅ done (21 Oct, see README) |
| 3 | Yield simulation (pvlib + PVGIS TMY, losses) and a PVsyst-style PDF report, locked behind the rules check | ✅ in the static app (`web/`, see README); checked against pvlib |
| 4 | Satellite layout ("maximise area") with Esri imagery (free) or Google (needs billing); multiple POCs per site; transformer checks (C&I spare capacity, utility MV step-up) | |
| 5 | Consumption-CSV design approach | |
| 6 | Offer deck generator from `source_templates/EPC_Offer_Template.pptx` | ✅ static app, Offer decks page |

**To check at QC (offer decks):**
- **ROI** is average yearly savings ÷ price, with no discounting (`cashFlow` in
  `web/js/offer/values.js`). Kept for now on Mohammed's say-so; compare with HTC's own offers.
- **Environmental equivalents** use the factors in HTC's "EPA Calc" spreadsheet (from the US EPA
  equivalencies calculator, homes ÷ 3), applied to the project's annual generation rather than
  the spreadsheet's kWp × 1,650.
- **Monthly generation** comes from the AC Power (kWh) row of the "Solar Access by Month" table
  on the shading report's scanned page 2, read with tesseract.js (vendored in `web/vendor/tesseract`,
  English "best_int" data). The row is used only if it adds up to the annual figure (±1%) and each
  month is within 4% of the bar chart; otherwise the months are read off the pixels of the
  "Monthly Production" bar chart and scaled to the annual figure (about 1% out per month). The
  form also takes the 12 figures pasted in.
- **Sub-systems and inverter suggestions** (`suggestInverters` in `web/js/offer/quick.js`): every
  combination of up to two library inverter models whose DC/AC ratio is 0.8–1.2, with no inverter
  that could be dropped and stay in range; ranked by number of inverters, then ratio closest to
  1.0, then one model before two. Mohammed asked for the 0.8–1.2 limits and fewest inverters; the
  1.0 target and the two-model cap are my choices, to confirm.
- **3D views for slide 17** are cut from the shading report's scanned page 2 by finding the
  panels' grey rule lines (`scannedPanels` in `web/js/offer/helioscope.js`). Check on a few more
  reports; any picture can be replaced by hand on the form.
- **Degradation** comes from the module's linear power warranty (Tiger Neo: 1% in year 1,
  then 0.40% a year), applied linearly from year 2; year 1 is the simulated figure. Modules
  without these figures in the library fall back to one yearly figure (0.65%, compounded).
  The 620 Wp Tiger Neo's figures are assumed equal to the 66HL5 datasheet's until its own is in.
- **Component pictures** (slide after "Component Specifications"): built-in datasheets have
  their product picture cut out ahead of time (`python -m tools.extract_product_images` →
  `web/data/products/`; the Jinko panel is a fixed crop of page 1 since it's drawn, not a
  picture). A datasheet uploaded later uses the largest picture on its first page. The 620 Wp
  module has no datasheet in the library, so it gets a caption without a picture.
- **Structure height** isn't in the reports, so slide 17 reads "Height: m" until it's typed in.

**Phase 2 scope (sizing engine):**
- **Auto-recommend** a design: string length range, strings per MPPT, number of inverters,
  DC/AC ratio.
- **Hard rules, which block the report:**
  - Voc at the site's record low temperature ≤ the inverter's max DC voltage. For Sungrow RT,
    note the 1000 V practical limit unless MC4 Evo2 connectors are used.
  - Vmp at hot cell temperature ≥ the MPPT minimum.
  - Vmp at cold temperature ≤ the MPPT maximum.
  - String Isc × safety factor ≤ the MPPT short-circuit limit, using the **per-MPPT lists**.
  - Operating current ≤ the MPPT current limit.
  - Strings per MPPT ≤ the inverter's connector count.
  - AC capacity within the POC / transformer / NAMA limits.
- **Warnings only:** DC/AC ratio outside the target band, clipping, voltage drop.
- **Rules must be configurable**, with an APSR/NAMA rule profile.
- Equipment data needed is already in the library: Voc, Isc, Vmp, Imp and temperature
  coefficients for modules; MPPT window, max V and per-MPPT limits for inverters.

**The 11 kW** and other utility rules should come from the **APSR "Connection Guidelines for
Small-scale Grid-connected Solar PV" and the NAMA rules**. These were requested from the user.

---

## 6. Open items / waiting on the user

1. **Module datasheets** for the 2–3 panels he uses most (Jinko, LONGi, …). Use them to test
   the module reader on real files and fill the module library.
2. **APSR / NAMA connection guidelines PDF**, so the hard rules match the regulations exactly.
3. **Claude API key.** The user has to create one at console.anthropic.com and put it in
   `.env`. The Claude reader has only been tested with a mocked reply, so test it live.
4. **Deployment:**
   - Not yet confirmed. Suggest walking him through DEPLOY.md.
   - The Docker image was never built in the sandbox, so watch the first build.
   - Offer to push the code to a private GitHub repo so updates become `git pull`.
5. **Possible feature:** the design form has "Group ( )" columns for a second array group
   (e.g. east/west, or a different module or inverter). This isn't supported yet; only
   Group 1 is filled. Ask whether he needs it.
6. **Equipment library cleanup:** the starter module JKM545M-72HL4-V has no electrical values.
   It came from the old fixed form values and is not a verified datasheet.

---

## 7. Related context from the user's earlier conversations (for offer and deck work)

- HTC offer decks follow a standard structure. The 46-slide EPC template has these sections:
  1. HTC introduction and project references
  2. General PV plant schematic (energy flow, net meter, NEDC grid)
  3. PV layout, shadow analysis and mounting structure; design summary table
  4. Component specifications (module and inverter datasheet slides)
  5. Energy analysis: monthly yield table, 25-year degradation at 0.65 %/yr, CO₂ savings,
     25-year financial analysis at the tariff (e.g. 33 bz/kWh)
  6. Methodology and schedule (Gantt with phases: award, design approval, statutory
     approvals, procurement, mobilisation, installation, testing and commissioning, handover)
  7. Commercial offer table (DC kWp, AC kWac, OMR/kWp, total, "prices exclusive of VAT")
  8. Key technical assumptions and exclusions; warranties (modules 12-yr product / 30-yr
     performance, inverters 5 yr, structure 10 yr, BoS 1 yr)
- **Residential execution agreement terms:**
  - payment 25 % advance / 25 % on design approval and NOC / 50 % on commissioning
  - validity 30 days
  - tariff assumption 32 bz/kWh (third slab)
- **The approval route he works with:** APSR guidelines, a 3-stage NAMA/NEDC process (initial
  enquiry → design approval → connection), plus Muscat Municipality approval.

---

## 8. Phase 2 notes (added 21 Oct 2026)

- Code: `app/sizing/engine.py` (Design → `check()` → Result; `recommend()`), `app/sizing/rules.py`
  (PARAMS / RULES registry, RuleProfile JSON), `app/routes/sizing.py`, templates `sizing*.html`,
  `_sizing_results.html`, `rules.html`. Tests: `tests/test_sizing.py` (12). `pytest -q`: 26 pass.
  Test-only deps in `requirements-dev.txt`.
- New columns: Project `rule_profile_id, mppt_layout, t_min_c, t_max_c, hv_connectors,
  connection_limit_kw, dc_cable_m/mm2, ac_cable_m/mm2`; Inverter `connector_limit_v`
  (Sungrow RT = 1000 V); new table `rule_profiles`. Added by `add_missing_columns()`.
  Re-run "import-sungrow" on an existing server to fill `connector_limit_v`.
- Vmp temperature coefficient = tc_pmax − tc_isc (fallback tc_voc). Hot cell = Tmax + (NOCT−20)/800 × G.
- Phase 3 is next and must refuse the report when `project_check(db, p).blocked` is True.
- `seed` fills the starter JKM545M-72HL4-V with electrical values from Jinko's public datasheet
  (flagged in its notes as not checked against the user's copy).
- APSR values in the default profile (from a public summary of APSR's 2017 "Technical Guidelines
  for Solar PV Systems"; apsr.om's PDF needs JavaScript and couldn't be read): 1-phase LV only
  if phase current ≤ 16 A (hard rule), LVRT from 11.08 kW and remote control from 10 kW on LV
  (reminder notes). Max. AC per connection still blank. Default temps 5 °C / 50 °C.
- Jinko Tiger Neo JKM710-735N-66HL5-BDV (user's datasheet) is a built-in module set
  (`seed/jinko_modules.py`, library button, `seed`). The text reader now handles Jinko's
  "detached table" layout (`_detached_module_table` in datasheets.py).
- Current rules (user asked for "harsh but within reason", 21 Oct): Isc per MPPT is a hard rule at
  IEC 62548-1 K_I = 1.25 × Isc(STC) × (1 + bifaciality × 135/1000) (BNPI rear irradiance);
  operating current per MPPT is a warning (the inverter clips). Auto-allocation and recommendations
  only respect hard rules. Result: 720 W Tiger Neo = 1 string per 40 A MPPT; 620 W = 2.
- JKM620N-78HL4-BDV is in the Jinko seed set with values from a distributor's copy of Jinko's
  610-630 W datasheet (no user datasheet yet).
