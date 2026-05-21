import type { PublicNavMessages, PublicHomeMessages, PublicContactMessages } from "../../types";

export const arNav: PublicNavMessages = {
  brand: "مركز البيانات الأساسي",
  about: "عن المنصة",
  contact: "اتصل بنا",
  signIn: "تسجيل الدخول",
  back: "رجوع",
  home: "الرئيسية",
};

export const arHome: PublicHomeMessages = {
  badge: "منصة مؤسسية",
  dcchome: "الصفحة الرئيسية",
  title: "مركز البيانات الأساسي",
  subtitle:
    "بيئة عمل مؤسسية للبيانات والعمليات والحوكمة — وصول آمن للفرق المصرّح لها.",
  signInCta: "تسجيل الدخول",
  aboutCta: "عن المنصة",
  contactCta: "اتصل بنا",
  footer: "الوصول مقصور على الموظفين المعتمدين. يتم إنشاء الحسابات من قِبل المسؤولين.",
  footerAbout: "عن المنصة",
  footerContact: "اتصل بنا",
};

export const arContact: PublicContactMessages = {
  placeholders: {
    fullName: "الاسم الكامل",
    company: "اسم الشركة أو المؤسسة",
    email: "example@company.com",
    subject: "موضوع الرسالة",
    message: "اكتب استفسارك بالتفصيل…",
  },
  heroEyebrow: "اتصل بنا",
  heroTitle: "تواصل مع مركز البيانات الأساسي",
  heroSubtitle:
    "استفسارات المؤسسات، شراكات الأعمال، وأسئلة المنصة. أرسل النموذج أدناه وسيراجع فريقنا رسالتك بسرية.",
  cardBusinessTitle: "استفسارات الأعمال",
  cardBusinessText:
    "الشراكات، التراخيص المؤسسية، عروض المنصة، وتخطيط النشر المؤسسي.",
  cardEnterpriseTitle: "التواصل المؤسسي",
  cardEnterpriseText:
    "رسائل منظمة حول قدرات مركز البيانات الأساسي، التعددية، والملاءمة التشغيلية.",
  cardSupportTitle: "الدعم والاستفسارات",
  cardSupportText:
    "يجب على العملاء الحاليين استخدام تسجيل الدخول المعتمد لمساحة العمل. يمكن إرسال الاستفسارات العامة عبر النموذج أدناه.",
  privacyNote:
    "يجب على المستخدمين المصرّح لهم تسجيل الدخول إلى مساحة العمل للدعم التشغيلي. هذا النموذج مخصص لاستفسارات المؤسسات الخارجية فقط.",
  formTitle: "نموذج الاتصال",
  formSubtitle:
    "جميع الحقول مطلوبة. نرد عادةً على استفسارات المؤسسات المؤهلة خلال ساعات العمل.",
  labelFullName: "الاسم الكامل",
  labelCompany: "اسم الشركة",
  labelEmail: "البريد الإلكتروني",
  labelSubject: "الموضوع",
  labelMessage: "الرسالة",
  messageHint: "من 10 إلى 5000 حرفاً",
  submit: "إرسال الرسالة",
  submitting: "جارٍ الإرسال…",
  alreadyAccount: "لديك حساب بالفعل؟",
  signInLink: "تسجيل الدخول",
  homeLink: "الرئيسية",
  footer: "مركز البيانات الأساسي — تُعالج استفسارات المؤسسات بسرية.",
  toastSuccessTitle: "تم إرسال الرسالة",
  toastSuccessDefault: "تم استلام استفسارك. سيرد فريقنا عند الاقتضاء.",
  toastErrorTitle: "تعذّر إرسال الرسالة",
  errors: {
    rateLimit: "محاولات كثيرة. يرجى الانتظار قبل الإرسال مرة أخرى.",
    unavailable: "خدمة الاتصال غير متاحة مؤقتاً. يرجى المحاولة لاحقاً.",
    generic: "تعذّر إرسال رسالتك. يرجى المحاولة لاحقاً.",
  },
};
