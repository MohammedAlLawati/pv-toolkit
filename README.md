# PV Toolkit

A private web app for solar PV work: clients, projects, authority paperwork, and
(in later phases) string and inverter sizing, yield reports and offer decks.

**Deploying:** see [DEPLOY.md](DEPLOY.md).

## What Phase 1 does

- **Sign-in:** a single user, with a password plus a code from an authenticator app.
  - Five wrong attempts lock sign-in for 15 minutes.
  - Signing out ends every session.
  - Every form is CSRF-protected.
- **Clients:** you enter a client once, and every document reuses the details.
- **Projects:** each project holds:
  - its site, system, commercial terms and authority settings
  - a live DC/AC summary
  - consistency warnings, e.g. an inverter's phase count not matching the project, or modules that don't split evenly into strings.
- **Equipment library**, with modules and inverters in three categories: residential, C&I and utility.
  - **Upload a datasheet** (PDF or a photo of the spec table) and the app reads every model in it. Each value is checked for sense, for example Voc above Vmp, or the MPPT window inside the max. voltage. Nothing is saved until you've reviewed and corrected it. The datasheet is stored with the equipment.
  - **Reading:** with an `ANTHROPIC_API_KEY`, datasheets are read by Claude, which copes with multi-model tables, merged cells and scans. Without a key, a basic text reader handles clean tables.
  - **Re-reading a datasheet for a model already in the library** only overwrites the values you fill in. Blanks keep the existing values.
  - **The Sungrow MENA range is built in:** 18 inverters, checked by hand against your datasheets, with the datasheets attached. You load it with one click.
  - **Per-MPPT limits** (strings, current, short-circuit current), e.g. 32/16 A, are stored per MPPT for the sizing engine.
- **Contractors and consultants:** editable lists that feed the project dropdowns. You can also add new ones from inside the project form. Each can have a stamp image that goes onto the NAMA initial form.
- **Documents** (Word or PDF, one at a time or as a zip pack). Every value and tick mark comes
  from the project. The design form's "Documents Required" Yes / NA marks stay exactly as
  in the template.
  - NAMA Initial Service Application
  - NAMA Agency Contract
  - NAMA Design Approval Application. The app picks the **above 11 kW** or **11 kW and below** form automatically from the **AC** capacity.
  - Execution Agreement for residential clients, with an optional layout image in the Design Summary box

## What Phase 2 adds: string and inverter sizing

- **Sizing page per project** (Project → Open sizing, or *String & inverter sizing* in the menu).
- **Recommend a design:** choose a module and a target (DC kWp, AC kW, or the most modules that
  fit) and the app proposes inverter model, quantity, string length and string count. Only
  designs that pass every hard rule are listed; "Use this" applies one to the project.
- **Rules check on every change**, live as you type. Hard rules (Voc at record low vs inverter,
  module and connector limits; Vmp hot/cold vs the MPPT window; strings, Isc and current per
  MPPT from the per-MPPT lists; connector current; AC vs the connection limit and profile limits;
  phases) **block reports** when they fail or can't be checked. Warnings (DC/AC band, DC power
  per inverter, cold-morning standby, start-up voltage, string fuses, voltage drop) don't.
- **Design rules page:** every limit and each rule's severity (hard / warning / off) lives in an
  editable rule profile. The default "APSR / NAMA (provisional)" profile uses common practice
  until the APSR/NAMA guidelines are entered. An option also blocks the NAMA design form.
- **Per project:** record low and max. ambient temperature, high-voltage DC connectors (e.g.
  MC4 Evo2), connection limit (approved load / spare transformer capacity), cable runs.
- The engine is in `app/sizing/` (`engine.py` calculations, `rules.py` parameters and rules).

## Project layout

```
app/
  main.py              app setup, security headers, error pages
  config.py            settings from environment variables
  models.py            database tables
  security.py          passwords, 2FA, sessions, CSRF, lockout
  cli.py               admin commands (create-user, reset-2fa, seed, ...)
  routes/              auth.py, records.py (clients/parties/account), projects.py
  routes/library.py    equipment library, datasheet upload / review
  equipment_fields.py  every equipment field (drives forms, datasheet reading, review, checks)
  datasheets.py        datasheet readers (Claude + text) and sanity checks
  seed/                built-in Sungrow MENA range + datasheets
  docgen/
    ooxml.py           low-level Word (.docx) editing
    render.py          fills a template; converts to PDF with LibreOffice
    context.py         project -> placeholder values, tick marks, stamps; required fields per document
  doc_templates/       the cleaned templates the app fills (generated, see below)
  templates/, static/  pages, CSS, JS
source_templates/      your original files, untouched
tools/prepare_templates.py   builds app/doc_templates from source_templates
tests/                 end-to-end tests (pytest -q)
```

## Database upgrades

On startup the app adds any columns that a newer version defines (it never drops or
changes columns), so updating a deployed server keeps all existing data.

## How the templates work

Your original files are in `source_templates/`. `tools/prepare_templates.py` turns them
into the files the app fills:
- Hard-coded values (Jinko, 545 Wp, strings = 2, tilt 5°, "RT"…) become placeholders.
- Tick marks are tagged so they follow the project.
- The consultant and contractor details, signatures and stamps are removed from the
  Initial Form's scanned background.

Placeholders look like `{{Name}}`. The full list is in `app/docgen/context.py` (`build_values`).

**Changing a template**
1. Edit the file in `source_templates/` in Word, keeping the `{{Placeholders}}`.
2. Run `python tools/prepare_templates.py`, then `pytest -q`.
3. Deploy as usual.

**Adding a new placeholder:** type `{{MyField}}` in the Word file, then add `"MyField": ...`
to `build_values` in `app/docgen/context.py`. If any placeholder has no value, it is left
blank in the generated document, and the app logs the name.

## Roadmap

| Phase | Scope |
|---|---|
| 1 ✅ | Login, clients, projects, equipment library, contractor/consultant lists, NAMA forms + execution agreement |
| 2 ✅ | Sizing engine: string and inverter sizing, with a rules check that blocks reports when a hard limit fails. Covers Voc at record low temperature, MPPT window, MPPT current, DC/AC ratio, POC limits and the NAMA/APSR rules |
| 3 | Yield simulation (pvlib + PVGIS weather data) and a PVsyst-style PDF report |
| 4 | Satellite layout ("maximise area"), multiple POCs per site, transformer checks |
| 5 | Consumption-based design from a load CSV |
| 6 | Offer deck generator (commercial / utility) from the EPC PowerPoint template |

## Letters

- **Letters** in the menu: letters on the HTC letterhead, filled from editable templates.
- **Built in:** four NEDC letters (English and Arabic) where HTC (C.R. 1665626) acts on the
  client's behalf:
  - **commercial:** company name, C.R., authorised signatory and ID, one or more meters
  - **residential:** homeowner, civil ID, one or two electricity accounts
  - No reference number, no enclosures and no HTC person named. HTC's name, designation,
    signature and stamp are blank lines to fill in by hand, as are any inputs left empty.
- **New letter:** pick a template, then a client or project to fill the details in. Letters are
  kept, so they can be downloaded again as Word or PDF. A template with a reference prefix
  numbers its letters `<prefix>/<year>/001`.
- **Templates:** add or duplicate one and edit its wording, in English or Arabic (right to
  left). `{{Values}}` come from the letter form, and `[[blocks]]` insert the details table, the
  meters table and the signature boxes. The editor lists them all. "Blank PDF" shows a
  template with every input empty. Built-in templates have "Reset to built-in wording".
- **Letterheads:** header and footer images. The HTC one is built in, and you can upload others.
- Clients now have an optional authorised signatory name and ID for companies.
- Code: `app/letters/` (`builder.py` builds the .docx, `defaults.py` holds the built-in wording,
  `service.py` links them to the database) and `app/routes/letters.py`.
