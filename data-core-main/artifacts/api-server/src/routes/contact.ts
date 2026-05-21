/**
 * Public contact form — delivers to server-configured inbox via SMTP.
 */

import { Router, type Request, type Response } from "express";
import { checkContactRateLimit } from "../lib/contact-rate-limit";
import { isContactDeliveryReady, sendContactInquiryEmail } from "../lib/contact-mail";
import {
  validateContactForm,
  sanitizeContactForm,
  contactValidationMessage,
} from "../lib/contact-validation";

const router = Router();

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** POST /contact — public contact form submission */
router.post("/contact", async (req: Request, res: Response): Promise<void> => {
  const ip = clientIp(req);
  const rate = checkContactRateLimit(ip);
  if (!rate.allowed) {
    res.status(429).json({
      error: "Too many submissions. Please try again later.",
      code: "RATE_LIMITED",
      retryAfterSec: rate.retryAfterSec,
    });
    return;
  }

  if (!isContactDeliveryReady()) {
    res.status(503).json({
      error: "Contact delivery is temporarily unavailable. Please try again later.",
      code: "CONTACT_UNAVAILABLE",
    });
    return;
  }

  const validation = validateContactForm(req.body ?? {});
  if (!validation.valid) {
    res.status(400).json({
      error: contactValidationMessage(validation.errors),
      code: "VALIDATION_FAILED",
    });
    return;
  }

  const payload = sanitizeContactForm(req.body ?? {});

  try {
    await sendContactInquiryEmail({
      ...payload,
      clientIp: ip,
    });
    res.json({
      success: true,
      message: "Your message has been received. Our team will respond if appropriate.",
    });
  } catch {
    res.status(500).json({
      error: "We could not send your message at this time. Please try again later.",
      code: "DELIVERY_FAILED",
    });
  }
});

export default router;
