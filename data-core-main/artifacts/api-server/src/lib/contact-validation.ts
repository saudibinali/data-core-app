const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ContactFormPayload {
  fullName?: string;
  companyName?: string;
  email?: string;
  subject?: string;
  message?: string;
  website?: string;
}

export function validateContactForm(body: ContactFormPayload): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (body.website && String(body.website).trim().length > 0) {
    errors.push("SPAM_DETECTED");
  }

  const fullName = String(body.fullName ?? "").trim();
  const companyName = String(body.companyName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const subject = String(body.subject ?? "").trim();
  const message = String(body.message ?? "").trim();

  if (fullName.length < 2 || fullName.length > 120) {
    errors.push("INVALID_FULL_NAME");
  }
  if (companyName.length < 2 || companyName.length > 200) {
    errors.push("INVALID_COMPANY_NAME");
  }
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    errors.push("INVALID_EMAIL");
  }
  if (subject.length < 3 || subject.length > 200) {
    errors.push("INVALID_SUBJECT");
  }
  if (message.length < 10 || message.length > 5000) {
    errors.push("INVALID_MESSAGE");
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeContactForm(body: ContactFormPayload) {
  return {
    fullName: String(body.fullName ?? "").trim(),
    companyName: String(body.companyName ?? "").trim(),
    email: String(body.email ?? "").trim().toLowerCase(),
    subject: String(body.subject ?? "").trim(),
    message: String(body.message ?? "").trim(),
  };
}

export function contactValidationMessage(errors: string[]): string {
  if (errors.includes("SPAM_DETECTED")) return "Submission could not be processed.";
  if (errors.includes("INVALID_EMAIL")) return "Please enter a valid email address.";
  if (errors.includes("INVALID_MESSAGE")) return "Message must be between 10 and 5000 characters.";
  if (errors.includes("INVALID_SUBJECT")) return "Subject must be between 3 and 200 characters.";
  if (errors.includes("INVALID_FULL_NAME")) return "Please enter your full name.";
  if (errors.includes("INVALID_COMPANY_NAME")) return "Please enter your company name.";
  return "Please check the form and try again.";
}
