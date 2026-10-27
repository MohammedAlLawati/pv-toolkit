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

SUBJECT = "Request for the approved solar PV capacity at our client's premises"

COMMERCIAL_BODY = f"""Dear Sir / Madam,

Hussam Technology Company L.L.C. (HTC), C.R. No. {HTC_CR}, writes to Nama Electricity Distribution Company (NEDC) on behalf of our client detailed below to request the approved solar PV capacity for the site. The meter number(s) are listed below for your reference:

[[details]]

[[points]]

We thank you for your cooperation.

[[signatures]]"""

COMMERCIAL_CONFIRMATION = ("We, the undersigned, authorise Hussam Technology Company L.L.C. to request "
                           "and receive from NEDC the approved solar PV capacity for the meter(s) listed above.")

RESIDENTIAL_BODY = f"""Dear Sir / Madam,

Hussam Technology Company L.L.C. (HTC), C.R. No. {HTC_CR}, writes to Nama Electricity Distribution Company (NEDC) on behalf of our client, the owner of the residence detailed below, to request the approved solar PV capacity for the site. The electricity account number(s) are listed below for your reference:

[[details]]

[[points]]

We thank you for your cooperation.

[[signatures]]"""

RESIDENTIAL_CONFIRMATION = ("I, the undersigned, authorise Hussam Technology Company L.L.C. to request "
                            "and receive from NEDC the approved solar PV capacity for the account(s) listed above.")

# ---- Arabic --------------------------------------------------------------------------------

NEDC_RECIPIENT_AR = """الفاضل/ مدير دائرة خدمات المشتركين المحترم
شركة نماء لتوزيع الكهرباء
سلطنة عُمان"""

SUBJECT_AR = "طلب القدرة المعتمدة لنظام الطاقة الشمسية لمبنى عميلنا"

COMMERCIAL_BODY_AR = f"""تحية طيبة وبعد،

تتقدم إليكم شركة حسام للتقنية ش.م.م (HTC)، سجل تجاري رقم {HTC_CR}، نيابةً عن عميلنا الموضحة بياناته أدناه، بطلب القدرة المعتمدة لنظام الطاقة الشمسية للموقع. وتجدون أدناه رقم/أرقام العدادات للرجوع إليها:

[[details]]

[[points]]

شاكرين لكم حسن تعاونكم.

[[signatures]]"""

COMMERCIAL_CONFIRMATION_AR = ("نحن الموقعين أدناه نفوّض شركة حسام للتقنية ش.م.م بطلب واستلام القدرة "
                              "المعتمدة لنظام الطاقة الشمسية من شركة نماء لتوزيع الكهرباء للعداد/العدادات الموضحة أعلاه.")

RESIDENTIAL_BODY_AR = f"""تحية طيبة وبعد،

تتقدم إليكم شركة حسام للتقنية ش.م.م (HTC)، سجل تجاري رقم {HTC_CR}، نيابةً عن عميلنا مالك المسكن الموضحة بياناته أدناه، بطلب القدرة المعتمدة لنظام الطاقة الشمسية للموقع. وتجدون أدناه رقم/أرقام حسابات الكهرباء للرجوع إليها:

[[details]]

[[points]]

شاكرين لكم حسن تعاونكم.

[[signatures]]"""

RESIDENTIAL_CONFIRMATION_AR = ("أنا الموقّع أدناه أفوّض شركة حسام للتقنية ش.م.م بطلب واستلام القدرة "
                               "المعتمدة لنظام الطاقة الشمسية من شركة نماء لتوزيع الكهرباء للحساب/الحسابات الموضحة أعلاه.")

DEFAULT_TEMPLATES = [
    {
        "key": "nedc_commercial", "language": "en",
        "name": "NEDC approved capacity request: commercial client",
        "audience": "commercial", "recipient": NEDC_RECIPIENT, "subject": SUBJECT,
        "body": COMMERCIAL_BODY, "confirmation": COMMERCIAL_CONFIRMATION, "purpose": "",
    },
    {
        "key": "nedc_residential", "language": "en",
        "name": "NEDC approved capacity request: residential client",
        "audience": "residential", "recipient": NEDC_RECIPIENT, "subject": SUBJECT,
        "body": RESIDENTIAL_BODY, "confirmation": RESIDENTIAL_CONFIRMATION, "purpose": "",
    },
    {
        "key": "nedc_commercial_ar", "language": "ar",
        "name": "NEDC approved capacity request: commercial client (Arabic)",
        "audience": "commercial", "recipient": NEDC_RECIPIENT_AR, "subject": SUBJECT_AR,
        "body": COMMERCIAL_BODY_AR, "confirmation": COMMERCIAL_CONFIRMATION_AR, "purpose": "",
    },
    {
        "key": "nedc_residential_ar", "language": "ar",
        "name": "NEDC approved capacity request: residential client (Arabic)",
        "audience": "residential", "recipient": NEDC_RECIPIENT_AR, "subject": SUBJECT_AR,
        "body": RESIDENTIAL_BODY_AR, "confirmation": RESIDENTIAL_CONFIRMATION_AR, "purpose": "",
    },
]
