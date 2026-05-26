/**
 * @deprecated Legacy path — use `/self-service/approvals` (Approval Inbox).
 * Kept so accidental imports redirect safely; App.tsx also redirects `/approvals`.
 */
import { Redirect } from "wouter";

export default function ApprovalsPage() {
  return <Redirect to="/self-service/approvals" />;
}
