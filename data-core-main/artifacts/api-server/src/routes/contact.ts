/**
 * Public contact form — delivers to server-configured inbox via SMTP.
 */

import { Router, type Request, type Response } from "express";
import { checkContactRateLimit } from "../lib/contact-rate-limit";
import { clientIp } from "../lib/client-ip";
import { isContactDeliveryReady, sendContactInquiryEmail } from "../lib/contact-mail";
import {
  validateContactForm,
  sanitizeContactForm,
  contactValidationMessage,
} from "../lib/contact-validation";

const router = Router();

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
    console.error("[contact-smtp-debug] contact delivery not ready (SMTP or inbox missing)");
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
    console.log("[contact-smtp-debug] POST /contact delivery attempt", { ip, company: payload.companyName });
    await sendContactInquiryEmail({
      ...payload,
      clientIp: ip,
    });
    console.log("[contact-smtp-debug] POST /contact delivery success");
    res.json({
      success: true,
      message: "Your message has been received. Our team will respond if appropriate.",
    });
  } catch (error) {
    console.error("[contact-smtp-debug] POST /contact delivery failed");
    console.error(error);
    res.status(500).json({
      error: "We could not send your message at this time. Please try again later.",
      code: "DELIVERY_FAILED",
    });
  }
});

export default router;
