export type PublicLocale = "en" | "ar";

export interface PublicNavMessages {
  brand: string;
  about: string;
  contact: string;
  signIn: string;
  back: string;
  home: string;
}

export interface PublicHomeMessages {
  badge: string;
  dcchome: string;
  title: string;
  subtitle: string;
  signInCta: string;
  aboutCta: string;
  contactCta: string;
  footer: string;
  footerAbout: string;
  footerContact: string;
}

export interface PublicContactMessages {
  placeholders: {
    fullName: string;
    company: string;
    email: string;
    subject: string;
    message: string;
  };
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  cardBusinessTitle: string;
  cardBusinessText: string;
  cardEnterpriseTitle: string;
  cardEnterpriseText: string;
  cardSupportTitle: string;
  cardSupportText: string;
  privacyNote: string;
  formTitle: string;
  formSubtitle: string;
  labelFullName: string;
  labelCompany: string;
  labelEmail: string;
  labelSubject: string;
  labelMessage: string;
  messageHint: string;
  submit: string;
  submitting: string;
  alreadyAccount: string;
  signInLink: string;
  homeLink: string;
  footer: string;
  toastSuccessTitle: string;
  toastSuccessDefault: string;
  toastErrorTitle: string;
  errors: {
    rateLimit: string;
    unavailable: string;
    generic: string;
  };
}

export interface AboutHighlight {
  title: string;
  text: string;
}

export interface AboutNavItem {
  id: string;
  label: string;
}

export interface AboutSectionCard {
  title: string;
  text: string;
}

export interface AboutClientOutcome {
  title: string;
  items: string[];
}

export interface AboutModuleItem {
  name: string;
  desc: string;
}

export interface PublicAboutMessages {
  workspaceModules: AboutModuleItem[];
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  nav: AboutNavItem[];
  highlights: AboutHighlight[];
  sections: {
    overview: { title: string; p1: string; p2: string; focusLabel: string; focusText: string };
    structure: {
      title: string;
      workspacePlane: AboutSectionCard;
      platformPlane: AboutSectionCard;
      howOperateTitle: string;
      howOperate: string;
    };
    tenancy: {
      title: string;
      p1: string;
      tenantRegistry: AboutSectionCard;
      subscription: AboutSectionCard;
      saasTitle: string;
      saas: string;
    };
    organization: {
      title: string;
      p1: string;
      deptGroups: AboutSectionCard;
      provisioning: AboutSectionCard;
      p2: string;
    };
    hcm: {
      title: string;
      p1: string;
      capabilities: string[];
      depsLabel: string;
      deps: string;
    };
    selfService: {
      title: string;
      portalTitle: string;
      bullets: string[];
      p1: string;
    };
    attendancePayroll: {
      title: string;
      attendance: AboutSectionCard;
      leave: AboutSectionCard;
      payroll: AboutSectionCard;
      confidentiality: AboutSectionCard;
    };
    collaboration: {
      title: string;
      tickets: AboutSectionCard;
      messages: AboutSectionCard;
      calendar: AboutSectionCard;
      notifications: AboutSectionCard;
    };
    administration: {
      title: string;
      workspaceTitle: string;
      workspaceBullets: string[];
      platformTitle: string;
      platformAreas: AboutSectionCard[];
    };
    security: {
      title: string;
      p1: string;
      workspaceRolesTitle: string;
      workspaceRoles: { role: string; desc: string }[];
      platformRolesTitle: string;
      platformRoles: string[];
      p2: string;
    };
    visibility: {
      title: string;
      dashboard: AboutSectionCard;
      governance: AboutSectionCard;
      activity: AboutSectionCard;
    };
    workflows: {
      title: string;
      cardTitle: string;
      bullets: string[];
    };
    documents: {
      title: string;
      bullets: string[];
    };
    branding: {
      title: string;
      cardTitle: string;
      text: string;
    };
    experience: {
      title: string;
      responsive: AboutSectionCard;
      i18n: AboutSectionCard;
      p1: string;
    };
    saas: {
      title: string;
      p1: string;
      p2: string;
    };
    integration: {
      title: string;
      cardTitle: string;
      bullets: string[];
    };
    future: {
      title: string;
      p1: string;
      p2: string;
      mobileTitle: string;
      mobile: string;
    };
    value: { title: string; outcomes: AboutClientOutcome[] };
    modules: { title: string; intro: string };
  };
  cta: {
    tagline: string;
    subtitle: string;
    signIn: string;
    home: string;
  };
  footer: string;
}

export interface PublicMessages {
  nav: PublicNavMessages;
  home: PublicHomeMessages;
  contact: PublicContactMessages;
  about: PublicAboutMessages;
  language: {
    en: string;
    ar: string;
    switchLabel: string;
  };
}
