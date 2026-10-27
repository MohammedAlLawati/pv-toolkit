"""Built-in letter templates. Loaded into the database once; edited there afterwards.

Body syntax (also shown on the template editor):
- Paragraphs are separated by a blank line. A line starting "- " is a bullet.
- {{Key}} is replaced with a value from the letter form (see letters.builder.PLACEHOLDERS).
- **text** is bold.
- A line holding only a [[block]] token inserts a block:
  [[details]] client details table, [[points]] meters / accounts table,
  [[signatures]] HTC sign-off (with the enclosures under it) beside the client's
  confirmation box, or [[htc_signature]] / [[client_signature]] / [[enclosures]] on their own.
"""
from __future__ import annotations

NEDC_RECIPIENT = """The Manager
Customer Services Department
Nama Electricity Distribution Company (NEDC)
Sultanate of Oman"""

DEFAULT_PURPOSE = ("application, design approval and grid connection of a rooftop "
                   "solar PV system under the net-metering scheme")

COMMERCIAL_BODY = """Dear Sir / Madam,

Hussam Technology Company L.L.C. (HTC) writes to Nama Electricity Distribution Company (NEDC) on behalf of our client, **{{ClientName}}** (C.R. No. {{CRNo}}), regarding the {{Purpose}} at the premises supplied through the meter(s) listed below.

Our client has appointed HTC as its contractor and authorised representative for this matter. We therefore kindly request that NEDC accepts HTC's submissions and deals with HTC on all correspondence, site inspections and follow-ups relating to the following:

[[details]]

[[points]]

Should you require any further information, please contact {{HTCContactName}} on {{HTCContactTel}} or {{HTCContactEmail}}. We thank you for your cooperation.

[[signatures]]"""

COMMERCIAL_CONFIRMATION = ("We, {{ClientName}}, confirm that Hussam Technology Company L.L.C. is "
                           "authorised to act on our behalf with NEDC for the meter(s) listed above.")

RESIDENTIAL_BODY = """Dear Sir / Madam,

Hussam Technology Company L.L.C. (HTC) writes to Nama Electricity Distribution Company (NEDC) on behalf of our client, **{{ClientName}}**, the owner of the residence at {{Location}}, regarding the {{Purpose}} at the premises.

The homeowner has appointed HTC as the contractor and authorised representative for this matter. We therefore kindly request that NEDC accepts HTC's submissions and deals with HTC on all correspondence, site inspections and follow-ups relating to the following:

[[details]]

[[points]]

Should you require any further information, please contact {{HTCContactName}} on {{HTCContactTel}} or {{HTCContactEmail}}. We thank you for your cooperation.

[[signatures]]"""

RESIDENTIAL_CONFIRMATION = ("I, {{ClientName}}, confirm that Hussam Technology Company L.L.C. is "
                            "authorised to act on my behalf with NEDC for the account(s) listed above.")

DEFAULT_TEMPLATES = [
    {
        "key": "nedc_commercial",
        "name": "NEDC authorisation: commercial client",
        "audience": "commercial",
        "recipient": NEDC_RECIPIENT,
        "subject": "HTC acting on behalf of {{ClientName}} for Meter No. {{MeterList}}",
        "body": COMMERCIAL_BODY,
        "confirmation": COMMERCIAL_CONFIRMATION,
        "enclosures": "Copy of the Commercial Registration (C.R.)\n"
                      "Copy of the authorised signatory's ID\n"
                      "Latest electricity bill for each meter",
    },
    {
        "key": "nedc_residential",
        "name": "NEDC authorisation: residential client",
        "audience": "residential",
        "recipient": NEDC_RECIPIENT,
        "subject": "HTC acting on behalf of {{ClientName}} for Account No. {{AccountList}}",
        "body": RESIDENTIAL_BODY,
        "confirmation": RESIDENTIAL_CONFIRMATION,
        "enclosures": "Copy of the homeowner's Civil ID\n"
                      "Latest electricity bill for each account",
    },
]
