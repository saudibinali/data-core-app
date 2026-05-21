/** @deprecated Use /subscription/status — invoices are embedded there. */
import { Redirect } from "wouter";

export default function BillingInvoicesPage() {
  return <Redirect to="/subscription/status" />;
}
