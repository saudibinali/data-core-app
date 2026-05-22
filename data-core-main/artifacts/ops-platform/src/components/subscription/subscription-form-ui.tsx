/**
 * Shared UI primitives for workspace subscription create/edit modals (P16-A).
 * UI-only — no API or schema changes.
 */

import type { ReactNode } from "react";
import { Calendar } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WorkspaceSubscriptionCreateInput } from "@/hooks/use-tenant-subscription";
import {
  WORKSPACE_SUBSCRIPTION_STATUS_CODES,
  WORKSPACE_SUBSCRIPTION_STATUS_CONFIG,
  type WorkspaceSubscriptionStatusCode,
} from "@/lib/subscription-state-config";

export const SUBSCRIPTION_FIELD_INPUT_CLASS =
  "h-9 bg-background text-foreground border-input placeholder:text-muted-foreground";

export const SUBSCRIPTION_SELECT_TRIGGER_CLASS =
  "h-9 w-full bg-background text-foreground border-input focus:ring-2 focus:ring-ring";

export const SUBSCRIPTION_SELECT_CONTENT_CLASS =
  "bg-popover text-popover-foreground border border-border z-[100]";

export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="space-y-0.5">
        <h5 className="text-sm font-semibold text-foreground">{title}</h5>
        {description ? (
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        ) : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function FormField({
  id,
  label,
  required,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  description?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span className="text-destructive ms-1" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {description ? (
        <p id={`${id}-desc`} className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function ReadOnlyField({
  id,
  label,
  value,
  description,
}: {
  id: string;
  label: string;
  value: ReactNode;
  description?: string;
}) {
  return (
    <FormField id={id} label={label} description={description}>
      <div
        id={id}
        className="flex h-9 w-full items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground"
        aria-readonly="true"
      >
        {value}
      </div>
    </FormField>
  );
}

export type SubscriptionFormErrors = Partial<
  Record<
    | "subscriptionCode"
    | "subscriptionName"
    | "startDate"
    | "endDate"
    | "renewalDate",
    string
  >
>;

export function validateSubscriptionForm(
  form: WorkspaceSubscriptionCreateInput,
): SubscriptionFormErrors {
  const errors: SubscriptionFormErrors = {};
  if (!form.subscriptionCode?.trim()) {
    errors.subscriptionCode = "Subscription code is required.";
  }
  if (!form.subscriptionName?.trim()) {
    errors.subscriptionName = "Subscription name is required.";
  }
  if (form.startDate && form.endDate && form.endDate < form.startDate) {
    errors.endDate = "End date must be on or after the start date.";
  }
  if (form.startDate && form.renewalDate && form.renewalDate < form.startDate) {
    errors.renewalDate = "Renewal date should not be before the start date.";
  }
  return errors;
}

export function DateInput({
  id,
  value,
  onChange,
  disabled,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <div className="relative">
      <Calendar
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className={cn(SUBSCRIPTION_FIELD_INPUT_CLASS, "ps-9")}
      />
    </div>
  );
}

export function SubscriptionStatusSelect({
  id,
  value,
  onChange,
  disabled,
  placeholder = "Select status",
  excludeStatus,
  "aria-invalid": ariaInvalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  excludeStatus?: string;
  "aria-invalid"?: boolean;
}) {
  const codes = WORKSPACE_SUBSCRIPTION_STATUS_CODES.filter(
    (s) => s !== excludeStatus,
  );
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        className={SUBSCRIPTION_SELECT_TRIGGER_CLASS}
        aria-invalid={ariaInvalid}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className={SUBSCRIPTION_SELECT_CONTENT_CLASS}>
        {codes.map((s) => (
          <SelectItem
            key={s}
            value={s}
            className="text-sm text-foreground focus:bg-accent focus:text-accent-foreground"
          >
            {WORKSPACE_SUBSCRIPTION_STATUS_CONFIG[s as WorkspaceSubscriptionStatusCode].label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ContractSelect({
  id,
  value,
  onChange,
  disabled,
  contracts,
}: {
  id: string;
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  contracts: { id: number; contractNumber: string | null; contractTitle: string | null }[];
}) {
  const selectValue = value != null ? String(value) : "none";
  return (
    <Select
      value={selectValue}
      onValueChange={(v) => onChange(v === "none" ? null : Number(v))}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={SUBSCRIPTION_SELECT_TRIGGER_CLASS}>
        <SelectValue placeholder="No linked contract" />
      </SelectTrigger>
      <SelectContent className={SUBSCRIPTION_SELECT_CONTENT_CLASS}>
        <SelectItem
          value="none"
          className="text-sm text-foreground focus:bg-accent focus:text-accent-foreground"
        >
          No linked contract
        </SelectItem>
        {contracts.map((c) => (
          <SelectItem
            key={c.id}
            value={String(c.id)}
            className="text-sm text-foreground focus:bg-accent focus:text-accent-foreground"
          >
            {c.contractNumber ?? c.id} — {c.contractTitle ?? "Contract"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SubscriptionFormBody({
  form,
  setForm,
  includeStatus,
  tenantId,
  region,
  contracts,
  fieldErrors,
  disabled,
}: {
  form: WorkspaceSubscriptionCreateInput;
  setForm: React.Dispatch<React.SetStateAction<WorkspaceSubscriptionCreateInput>>;
  includeStatus?: boolean;
  tenantId: string;
  region: string | null | undefined;
  contracts: { id: number; contractNumber: string | null; contractTitle: string | null }[];
  fieldErrors: SubscriptionFormErrors;
  disabled?: boolean;
}) {
  const err = (key: keyof SubscriptionFormErrors) => fieldErrors[key];

  return (
    <div className="space-y-4">
      <FormSection
        title="Subscription info"
        description="Core identifiers and commercial posture for this workspace subscription."
      >
        <ReadOnlyField
          id="sub-tenant-id"
          label="Tenant ID"
          value={<span className="font-mono text-xs">{tenantId}</span>}
          description="Platform tenant identifier (read-only)."
        />
        <ReadOnlyField
          id="sub-region"
          label="Region"
          value={region?.trim() ? region : "—"}
          description="Deployment or data residency region from tenant profile."
        />
        <FormField
          id="sub-code"
          label="Subscription code"
          required
          description="Unique code used in reports and audit logs (e.g. SUB-001)."
          error={err("subscriptionCode")}
        >
          <Input
            id="sub-code"
            className={SUBSCRIPTION_FIELD_INPUT_CLASS}
            value={form.subscriptionCode}
            onChange={(e) => setForm((f) => ({ ...f, subscriptionCode: e.target.value }))}
            disabled={disabled}
            aria-invalid={!!err("subscriptionCode")}
            aria-describedby={err("subscriptionCode") ? "sub-code-error" : "sub-code-desc"}
            data-testid="subscription-form-code"
          />
        </FormField>
        <FormField
          id="sub-name"
          label="Subscription name"
          required
          description="Display name shown to platform operators."
          error={err("subscriptionName")}
        >
          <Input
            id="sub-name"
            className={SUBSCRIPTION_FIELD_INPUT_CLASS}
            value={form.subscriptionName}
            onChange={(e) => setForm((f) => ({ ...f, subscriptionName: e.target.value }))}
            disabled={disabled}
            aria-invalid={!!err("subscriptionName")}
            aria-describedby={err("subscriptionName") ? "sub-name-error" : "sub-name-desc"}
            data-testid="subscription-form-name"
          />
        </FormField>
        {includeStatus ? (
          <FormField
            id="sub-status"
            label="Subscription status"
            required
            description="Initial lifecycle state for the new subscription record."
          >
            <SubscriptionStatusSelect
              id="sub-status"
              value={form.status ?? "trial"}
              onChange={(v) => setForm((f) => ({ ...f, status: v }))}
              disabled={disabled}
            />
          </FormField>
        ) : null}
        <FormField
          id="sub-plan"
          label="Plan name"
          description="Commercial plan label (free text; not tied to payment processing)."
        >
          <Input
            id="sub-plan"
            className={SUBSCRIPTION_FIELD_INPUT_CLASS}
            value={form.planName ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, planName: e.target.value.trim() || undefined }))
            }
            disabled={disabled}
            placeholder="e.g. Enterprise HCM"
            data-testid="subscription-form-plan"
          />
        </FormField>
      </FormSection>

      <FormSection
        title="Contract & dates"
        description="Link an optional commercial contract and define subscription dates."
      >
        <FormField
          id="sub-contract"
          label="Linked contract"
          description="Optional commercial contract reference from the tenant account."
        >
          <ContractSelect
            id="sub-contract"
            value={form.activeContractTermId}
            onChange={(id) => setForm((f) => ({ ...f, activeContractTermId: id }))}
            disabled={disabled}
            contracts={contracts}
          />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            id="sub-start"
            label="Subscription start date"
            description="When the subscription term begins."
            error={err("startDate")}
          >
            <DateInput
              id="sub-start"
              value={form.startDate ?? ""}
              onChange={(v) => setForm((f) => ({ ...f, startDate: v || undefined }))}
              disabled={disabled}
            />
          </FormField>
          <FormField
            id="sub-end"
            label="Subscription end date"
            description="When the current term ends, if applicable."
            error={err("endDate")}
          >
            <DateInput
              id="sub-end"
              value={form.endDate ?? ""}
              onChange={(v) => setForm((f) => ({ ...f, endDate: v || undefined }))}
              disabled={disabled}
              aria-invalid={!!err("endDate")}
              aria-describedby={err("endDate") ? "sub-end-error" : "sub-end-desc"}
            />
          </FormField>
        </div>
        <FormField
          id="sub-renewal"
          label="Next renewal date"
          description="Date of next automatic renewal or commercial review."
          error={err("renewalDate")}
        >
          <DateInput
            id="sub-renewal"
            value={form.renewalDate ?? ""}
            onChange={(v) => setForm((f) => ({ ...f, renewalDate: v || undefined }))}
            disabled={disabled}
            aria-invalid={!!err("renewalDate")}
            aria-describedby={err("renewalDate") ? "sub-renewal-error" : "sub-renewal-desc"}
          />
        </FormField>
      </FormSection>

      <FormSection title="Internal" description="Operator-only notes; not shown to workspace users.">
        <FormField
          id="sub-notes"
          label="Internal notes"
          description="Context for finance or platform ops (audit-logged with changes)."
        >
          <Textarea
            id="sub-notes"
            className="min-h-[88px] resize-y bg-background text-foreground border-input text-sm"
            value={form.internalNotes ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, internalNotes: e.target.value.trim() || undefined }))
            }
            disabled={disabled}
            placeholder="Commercial terms, renewal contacts, or handoff notes…"
            data-testid="subscription-form-notes"
          />
        </FormField>
      </FormSection>
    </div>
  );
}
