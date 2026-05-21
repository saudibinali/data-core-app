import { describe, it, expect } from "vitest";
import { validateContactForm, sanitizeContactForm } from "../contact-validation";

describe("validateContactForm", () => {
  const valid = {
    fullName: "Jane Doe",
    companyName: "Acme Corp",
    email: "jane@acme.com",
    subject: "Enterprise demo",
    message: "We would like to schedule a platform overview.",
  };

  it("accepts valid payload", () => {
    expect(validateContactForm(valid).valid).toBe(true);
  });

  it("rejects honeypot", () => {
    expect(validateContactForm({ ...valid, website: "spam" }).valid).toBe(false);
  });

  it("rejects short message", () => {
    expect(validateContactForm({ ...valid, message: "hi" }).valid).toBe(false);
  });

  it("sanitizes email to lowercase", () => {
    const s = sanitizeContactForm({ ...valid, email: "Jane@Acme.COM" });
    expect(s.email).toBe("jane@acme.com");
  });
});
