"""Built-in letter templates. Loaded into the database once; edited there afterwards
("Reset to built-in wording" on the template page reloads them).

Body syntax (also shown on the template editor):
- Paragraphs are separated by a blank line. A line starting "- " is a bullet.
- {{Key}} is replaced with a value from the letter form (see letters.builder.PLACEHOLDERS).
  A value left empty prints as a blank line to fill by hand.
- **text** is bold.
- A line holding only a [[block]] token inserts a block:
  [[details]] client details table, [[points]] meters / accounts table,
  [[signatures]] HTC sign-off (with any enclosures under it) beside the client's
  confirmation box, or [[htc_signature]] / [[client_signature]] / [[enclosures]] on their own.
"""
from __future__ import annotations

HTC_CR = "1665626"

# ---- English -------------------------------------------------------------------------------

NEDC_RECIPIENT = """The Manager
Customer Services Department
Nama Electricity Distribution Company (NEDC)
Sultanate of Oman"""

DEFAULT_PURPOSE = ("application, design approval and grid connection of a rooftop solar PV "
                   "system under the net-metering scheme")

COMMERCIAL_BODY = f"""Dear Sir / Madam,

Hussam Technology Company L.L.C. (HTC), C.R. No. {HTC_CR}, writes to Nama Electricity Distribution Company (NEDC) on behalf of our client, **{{{{ClientName}}}}** (C.R. No. {{{{CRNo}}}}), regarding the {{{{Purpose}}}} at the premises supplied through the meter(s) listed below.

Our client has appointed HTC as its contractor and authorised representative for this matter. We therefore kindly request that NEDC accepts HTC's submissions and deals with HTC on all correspondence, site inspections and follow-ups relating to the following:

[[details]]

[[points]]

We thank you for your cooperation.

[[signatures]]"""

COMMERCIAL_CONFIRMATION = ("We, {{ClientName}}, confirm that Hussam Technology Company L.L.C. is "
                           "authorised to act on our behalf with NEDC for the meter(s) listed above.")

RESIDENTIAL_BODY = f"""Dear Sir / Madam,

Hussam Technology Company L.L.C. (HTC), C.R. No. {HTC_CR}, writes to Nama Electricity Distribution Company (NEDC) on behalf of our client, **{{{{ClientName}}}}**, the owner of the residence detailed below, regarding the {{{{Purpose}}}} at the premises.

The homeowner has appointed HTC as the contractor and authorised representative for this matter. We therefore kindly request that NEDC accepts HTC's submissions and deals with HTC on all correspondence, site inspections and follow-ups relating to the following:

[[details]]

[[points]]

We thank you for your cooperation.

[[signatures]]"""

RESIDENTIAL_CONFIRMATION = ("I, {{ClientName}}, confirm that Hussam Technology Company L.L.C. is "
                            "authorised to act on my behalf with NEDC for the account(s) listed above.")

# ---- Arabic --------------------------------------------------------------------------------

NEDC_RECIPIENT_AR = """الفاضل/ مدير دائرة خدمات المشتركين المحترم
شركة نماء لتوزيع الكهرباء
سلطنة عُمان"""

DEFAULT_PURPOSE_AR = ("تقديم طلب واعتماد التصميم وربط نظام الطاقة الشمسية الكهروضوئية "
                      "المركّب على السطح بالشبكة الكهربائية ضمن نظام صافي القياس")

COMMERCIAL_BODY_AR = f"""تحية طيبة وبعد،

تتقدم إليكم شركة حسام للتقنية ش.م.م (HTC)، سجل تجاري رقم {HTC_CR}، نيابةً عن عميلنا **{{{{ClientName}}}}** (سجل تجاري رقم {{{{CRNo}}}})، بخصوص {{{{Purpose}}}}، وذلك للمبنى المغذّى بالعداد/العدادات الموضحة أدناه.

وقد قام عميلنا بتعيين شركة حسام للتقنية مقاولاً وممثلاً معتمداً له في هذا الشأن، لذا نرجو التكرم بقبول طلبات الشركة والتعامل معها في جميع المراسلات والزيارات الميدانية والمتابعات المتعلقة بما يلي:

[[details]]

[[points]]

شاكرين لكم حسن تعاونكم.

[[signatures]]"""

COMMERCIAL_CONFIRMATION_AR = ("نحن، {{ClientName}}، نؤكد تفويض شركة حسام للتقنية ش.م.م بالتعامل "
                              "نيابةً عنا مع شركة نماء لتوزيع الكهرباء بخصوص العداد/العدادات "
                              "الموضحة أعلاه.")

RESIDENTIAL_BODY_AR = f"""تحية طيبة وبعد،

تتقدم إليكم شركة حسام للتقنية ش.م.م (HTC)، سجل تجاري رقم {HTC_CR}، نيابةً عن عميلنا **{{{{ClientName}}}}**، مالك المسكن الموضحة بياناته أدناه، بخصوص {{{{Purpose}}}}.

وقد قام المالك بتعيين شركة حسام للتقنية مقاولاً وممثلاً معتمداً له في هذا الشأن، لذا نرجو التكرم بقبول طلبات الشركة والتعامل معها في جميع المراسلات والزيارات الميدانية والمتابعات المتعلقة بما يلي:

[[details]]

[[points]]

شاكرين لكم حسن تعاونكم.

[[signatures]]"""

RESIDENTIAL_CONFIRMATION_AR = ("أنا، {{ClientName}}، أؤكد تفويض شركة حسام للتقنية ش.م.م بالتعامل "
                               "نيابةً عني مع شركة نماء لتوزيع الكهرباء بخصوص الحساب/الحسابات "
                               "الموضحة أعلاه.")

DEFAULT_TEMPLATES = [
    {
        "key": "nedc_commercial", "language": "en",
        "name": "NEDC authorisation: commercial client",
        "audience": "commercial",
        "recipient": NEDC_RECIPIENT,
        "subject": "Authorisation for HTC to act on behalf of {{ClientName}}",
        "body": COMMERCIAL_BODY,
        "confirmation": COMMERCIAL_CONFIRMATION,
        "purpose": DEFAULT_PURPOSE,
    },
    {
        "key": "nedc_residential", "language": "en",
        "name": "NEDC authorisation: residential client",
        "audience": "residential",
        "recipient": NEDC_RECIPIENT,
        "subject": "Authorisation for HTC to act on behalf of {{ClientName}}",
        "body": RESIDENTIAL_BODY,
        "confirmation": RESIDENTIAL_CONFIRMATION,
        "purpose": DEFAULT_PURPOSE,
    },
    {
        "key": "nedc_commercial_ar", "language": "ar",
        "name": "NEDC authorisation: commercial client (Arabic)",
        "audience": "commercial",
        "recipient": NEDC_RECIPIENT_AR,
        "subject": "تفويض شركة حسام للتقنية بالتعامل نيابةً عن {{ClientName}}",
        "body": COMMERCIAL_BODY_AR,
        "confirmation": COMMERCIAL_CONFIRMATION_AR,
        "purpose": DEFAULT_PURPOSE_AR,
    },
    {
        "key": "nedc_residential_ar", "language": "ar",
        "name": "NEDC authorisation: residential client (Arabic)",
        "audience": "residential",
        "recipient": NEDC_RECIPIENT_AR,
        "subject": "تفويض شركة حسام للتقنية بالتعامل نيابةً عن {{ClientName}}",
        "body": RESIDENTIAL_BODY_AR,
        "confirmation": RESIDENTIAL_CONFIRMATION_AR,
        "purpose": DEFAULT_PURPOSE_AR,
    },
]
