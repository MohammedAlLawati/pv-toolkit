// Built-in letter templates, approved by Mohammed on 27 Oct 2026 (ported from app/letters/defaults.py).
// Keyed by template, then language. Keep the wording as is unless he asks for a change.
//
// Body syntax:
// - Paragraphs are separated by a blank line. A line starting "- " is a bullet.
// - {{Key}} is replaced with a value from the letter form; an empty value prints as a blank line.
// - **text** is bold.
// - A paragraph holding only a [[block]] inserts it: [[details]] client details table,
//   [[points]] meters / accounts table, [[signatures]] HTC sign-off beside the client's
//   confirmation box, or [[htc_signature]] / [[client_signature]] on their own.

export const HTC_CR = "1665626";

export const BLANK = "____________________";

// fixed wording around the template text, per language
export const LABELS = {
  "en": {
    "ref": "Ref:",
    "date": "Date:",
    "subject": "Subject:",
    "company": "Hussam Technology Company L.L.C.",
    "company_name": "Company name",
    "cr": "C.R. No.",
    "signatory": "Authorised signatory",
    "signatory_id": "Signatory ID No.",
    "homeowner": "Homeowner",
    "civil_id": "Civil ID No.",
    "location": "Premises location",
    "no": "No.",
    "meter": "Meter No.",
    "account": "Account No.",
    "meter_opt": "Meter No.",
    "place": "Location / description",
    "enclosures": "Enclosures:",
    "faithfully": "Yours faithfully,",
    "for": "For",
    "name": "Name",
    "designation": "Designation",
    "signature": "Signature",
    "stamp": "Company stamp",
    "id": "ID No.",
    "client_box": "CLIENT CONFIRMATION",
    "owner_box": "HOMEOWNER CONFIRMATION"
  },
  "ar": {
    "ref": "الرقم المرجعي:",
    "date": "التاريخ:",
    "subject": "الموضوع:",
    "company": "شركة حسام للتقنية ش.م.م",
    "company_name": "اسم الشركة",
    "cr": "رقم السجل التجاري",
    "signatory": "المفوّض بالتوقيع",
    "signatory_id": "رقم بطاقة المفوّض",
    "homeowner": "اسم المالك",
    "civil_id": "الرقم المدني",
    "location": "موقع المبنى",
    "no": "م",
    "meter": "رقم العداد",
    "account": "رقم الحساب",
    "meter_opt": "رقم العداد",
    "place": "الموقع / الوصف",
    "enclosures": "المرفقات:",
    "faithfully": "وتفضلوا بقبول فائق الاحترام والتقدير،",
    "for": "عن",
    "name": "الاسم",
    "designation": "المسمى الوظيفي",
    "signature": "التوقيع",
    "stamp": "ختم الشركة",
    "id": "رقم البطاقة",
    "client_box": "إقرار العميل",
    "owner_box": "إقرار المالك"
  }
};

export const TEMPLATES = {
  "nedc_commercial": {
    "en": {
      "name": "NEDC approved capacity request: commercial client",
      "audience": "commercial",
      "recipient": "The Manager\nCustomer Services Department\nNama Electricity Distribution Company (NEDC)\nSultanate of Oman",
      "subject": "Request for the approved solar PV capacity at our client's premises",
      "body": "Dear Sir / Madam,\n\nHussam Technology Company L.L.C. (HTC), C.R. No. 1665626, writes to Nama Electricity Distribution Company (NEDC) on behalf of our client detailed below to request the approved solar PV capacity for the site. The meter number(s) are listed below for your reference:\n\n[[details]]\n\n[[points]]\n\nWe thank you for your cooperation.\n\n[[signatures]]",
      "confirmation": "We, the undersigned, authorise Hussam Technology Company L.L.C. to request and receive from NEDC the approved solar PV capacity for the meter(s) listed above."
    },
    "ar": {
      "name": "NEDC approved capacity request: commercial client (Arabic)",
      "audience": "commercial",
      "recipient": "الفاضل/ مدير دائرة خدمات المشتركين المحترم\nشركة نماء لتوزيع الكهرباء\nسلطنة عُمان",
      "subject": "طلب القدرة المعتمدة لنظام الطاقة الشمسية لمبنى عميلنا",
      "body": "تحية طيبة وبعد،\n\nتتقدم إليكم شركة حسام للتقنية ش.م.م (HTC)، سجل تجاري رقم 1665626، نيابةً عن عميلنا الموضحة بياناته أدناه، بطلب القدرة المعتمدة لنظام الطاقة الشمسية للموقع. وتجدون أدناه رقم/أرقام العدادات للرجوع إليها:\n\n[[details]]\n\n[[points]]\n\nشاكرين لكم حسن تعاونكم.\n\n[[signatures]]",
      "confirmation": "نحن الموقعين أدناه نفوّض شركة حسام للتقنية ش.م.م بطلب واستلام القدرة المعتمدة لنظام الطاقة الشمسية من شركة نماء لتوزيع الكهرباء للعداد/العدادات الموضحة أعلاه."
    }
  },
  "nedc_residential": {
    "en": {
      "name": "NEDC approved capacity request: residential client",
      "audience": "residential",
      "recipient": "The Manager\nCustomer Services Department\nNama Electricity Distribution Company (NEDC)\nSultanate of Oman",
      "subject": "Request for the approved solar PV capacity at our client's premises",
      "body": "Dear Sir / Madam,\n\nHussam Technology Company L.L.C. (HTC), C.R. No. 1665626, writes to Nama Electricity Distribution Company (NEDC) on behalf of our client, the owner of the residence detailed below, to request the approved solar PV capacity for the site. The electricity account number(s) are listed below for your reference:\n\n[[details]]\n\n[[points]]\n\nWe thank you for your cooperation.\n\n[[signatures]]",
      "confirmation": "I, the undersigned, authorise Hussam Technology Company L.L.C. to request and receive from NEDC the approved solar PV capacity for the account(s) listed above."
    },
    "ar": {
      "name": "NEDC approved capacity request: residential client (Arabic)",
      "audience": "residential",
      "recipient": "الفاضل/ مدير دائرة خدمات المشتركين المحترم\nشركة نماء لتوزيع الكهرباء\nسلطنة عُمان",
      "subject": "طلب القدرة المعتمدة لنظام الطاقة الشمسية لمبنى عميلنا",
      "body": "تحية طيبة وبعد،\n\nتتقدم إليكم شركة حسام للتقنية ش.م.م (HTC)، سجل تجاري رقم 1665626، نيابةً عن عميلنا مالك المسكن الموضحة بياناته أدناه، بطلب القدرة المعتمدة لنظام الطاقة الشمسية للموقع. وتجدون أدناه رقم/أرقام حسابات الكهرباء للرجوع إليها:\n\n[[details]]\n\n[[points]]\n\nشاكرين لكم حسن تعاونكم.\n\n[[signatures]]",
      "confirmation": "أنا الموقّع أدناه أفوّض شركة حسام للتقنية ش.م.م بطلب واستلام القدرة المعتمدة لنظام الطاقة الشمسية من شركة نماء لتوزيع الكهرباء للحساب/الحسابات الموضحة أعلاه."
    }
  }
};

export function getTemplate(key, lang = "en") {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Unknown letter template: ${key}`);
  return { key, lang, ...(t[lang] || t.en) };
}
