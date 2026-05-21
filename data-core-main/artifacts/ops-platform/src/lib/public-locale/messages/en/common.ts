import type { PublicNavMessages, PublicHomeMessages, PublicContactMessages } from "../../types";

export const enNav: PublicNavMessages = {
  brand: "Data Core Center",
  about: "About",
  contact: "Contact",
  signIn: "Sign In",
  back: "Back",
  home: "Home",
};

export const enHome: PublicHomeMessages = {
  badge: "Enterprise platform",
  dcchome: "DCCHOME",
  title: "Data Core Center",
  subtitle:
    "Enterprise workspace for data, operations, and governance — secure access for authorized teams.",
  signInCta: "Sign In",
  aboutCta: "About Platform",
  contactCta: "Contact",
  footer: "Access is restricted to authorized personnel. Accounts are provisioned by administrators.",
  footerAbout: "About Platform",
  footerContact: "Contact",
};

export const enContact: PublicContactMessages = {
  placeholders: {
    fullName: "Your full name",
    company: "Organization or company",
    email: "you@company.com",
    subject: "Brief subject line",
    message: "Describe your inquiry…",
  },
  heroEyebrow: "Contact Us",
  heroTitle: "Get in touch with Data Core Center",
  heroSubtitle:
    "Enterprise inquiries, partnership discussions, and platform questions. Submit the form below and our team will review your message privately.",
  cardBusinessTitle: "Business inquiries",
  cardBusinessText:
    "Partnerships, enterprise licensing, platform demonstrations, and organizational rollout planning.",
  cardEnterpriseTitle: "Enterprise communication",
  cardEnterpriseText:
    "Structured messages regarding Data Core Center capabilities, tenancy, and operational fit.",
  cardSupportTitle: "Support & inquiries",
  cardSupportText:
    "Existing customers should use their authorized workspace sign-in. General inquiries may be submitted below.",
  privacyNote:
    "Authorized users should sign in to their workspace for operational support. This form is for external enterprise inquiries only.",
  formTitle: "Contact form",
  formSubtitle:
    "All fields are required. We typically respond to qualified enterprise inquiries during business hours.",
  labelFullName: "Full name",
  labelCompany: "Company name",
  labelEmail: "Email address",
  labelSubject: "Subject",
  labelMessage: "Message",
  messageHint: "10–5000 characters",
  submit: "Send message",
  submitting: "Sending…",
  alreadyAccount: "Already have an account?",
  signInLink: "Sign in",
  homeLink: "Home",
  footer: "Data Core Center — enterprise inquiries are handled confidentially.",
  toastSuccessTitle: "Message sent",
  toastSuccessDefault:
    "Your inquiry has been received. Our team will respond when appropriate.",
  toastErrorTitle: "Could not send message",
  errors: {
    rateLimit: "Too many attempts. Please wait before submitting again.",
    unavailable: "Contact service is temporarily unavailable. Please try again later.",
    generic: "Unable to send your message. Please try again later.",
  },
};
