/**
 * @phase P15-A / P15-G - Commercial account & billing contacts
 */

import { useState } from "react";
import { Briefcase, UserCheck, Mail, Phone, Star, PlusCircle, Pencil, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  useCommercialAccount,
  useUpsertCommercialAccount,
  useBillingContacts,
  useCreateBillingContact,
  useUpdateBillingContact,
  useSetPrimaryBillingContact,
  type BillingContact,
  type CommercialAccountUpsertInput,
  type BillingContactCreateInput,
} from "@/hooks/use-commercial";
import {
  COMMERCIAL_ACCOUNT_STATUS_CONFIG,
  BILLING_CONTACT_ROLE_CONFIG,
  BILLING_CONTACT_ROLE_CODES,
  type CommercialAccountStatus,
  type BillingContactRole,
} from "@/lib/commercial-config";

interface Props {
  tenantId: string;
  canReadAccount: boolean;
  canWriteAccount: boolean;
  canReadContacts: boolean;
  canWriteContacts: boolean;
}

export function CommercialAccountSection({
  tenantId,
  canReadAccount,
  canWriteAccount,
  canReadContacts,
  canWriteContacts,
}: Props) {
  const { data: account, isLoading: accountLoading } = useCommercialAccount(
    canReadAccount ? tenantId : undefined,
  );
  const { data: contacts = [], isLoading: contactsLoading } = useBillingContacts(
    canReadContacts && account ? tenantId : undefined,
  );

  const upsertAccount = useUpsertCommercialAccount(tenantId);
  const createContact = useCreateBillingContact(tenantId);
  const updateContact = useUpdateBillingContact(tenantId);
  const setPrimary = useSetPrimaryBillingContact(tenantId);

  const [editingAccount, setEditingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState<CommercialAccountUpsertInput>({});
  const [showContactForm, setShowContactForm] = useState(false);
  const [editingContactId, setEditingContactId] = useState<number | null>(null);
  const [contactForm, setContactForm] = useState<BillingContactCreateInput>({
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    contactRole: "other",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  if (!canReadAccount && !canReadContacts) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="commercial-account-access-denied">
        No permission to view commercial account data.
      </p>
    );
  }

  function openAccountEdit() {
    setAccountForm({
      commercialAccountName: account?.commercialAccountName ?? "",
      legalEntityName: account?.legalEntityName ?? "",
      billingEmail: account?.billingEmail ?? "",
      billingPhone: account?.billingPhone ?? "",
      contractOwnerName: account?.contractOwnerName ?? "",
      contractOwnerEmail: account?.contractOwnerEmail ?? "",
      companyTaxNumberPlaceholder: account?.companyTaxNumberPlaceholder ?? "",
      commercialNotes: account?.commercialNotes ?? "",
      status: account?.status ?? "draft",
    });
    setEditingAccount(true);
  }

  function openContactEdit(contact: BillingContact) {
    setContactForm({
      contactName: contact.contactName,
      contactEmail: contact.contactEmail,
      contactPhone: contact.contactPhone ?? "",
      contactRole: contact.contactRole,
      notes: contact.notes ?? "",
    });
    setEditingContactId(contact.id);
    setShowContactForm(true);
    setFormError(null);
  }

  function openNewContactForm() {
    setContactForm({
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      contactRole: "other",
      notes: "",
    });
    setEditingContactId(null);
    setShowContactForm(true);
    setFormError(null);
  }

  async function handleAccountSave() {
    await upsertAccount.mutateAsync(accountForm);
    setEditingAccount(false);
  }

  async function handleContactSave() {
    if (!contactForm.contactName?.trim()) {
      setFormError("Contact name is required");
      return;
    }
    if (!contactForm.contactEmail?.trim()) {
      setFormError("Contact email is required");
      return;
    }
    setFormError(null);
    if (editingContactId !== null) {
      await updateContact.mutateAsync({ contactId: editingContactId, input: contactForm });
    } else {
      await createContact.mutateAsync(contactForm);
    }
    setShowContactForm(false);
    setEditingContactId(null);
  }

  const statusCfg = account
    ? (COMMERCIAL_ACCOUNT_STATUS_CONFIG[account.status as CommercialAccountStatus]
      ?? COMMERCIAL_ACCOUNT_STATUS_CONFIG.draft)
    : null;

  return (
    <div className="space-y-4" data-testid="commercial-account-section">
      {canReadAccount && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Commercial Account</span>
            </div>
            {statusCfg && <Badge variant={statusCfg.variant} className="text-xs">{statusCfg.label}</Badge>}
            {canWriteAccount && !editingAccount && (
              <button
                type="button"
                onClick={openAccountEdit}
                data-testid="commercial-edit-account-btn"
                className="flex items-center gap-1 text-xs text-primary hover:underline ml-auto"
              >
                <Pencil className="w-3 h-3" />
                {account ? "Edit" : "Set up"}
              </button>
            )}
          </div>
          <div className="px-4 py-4">
            {accountLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading...
              </div>
            )}
            {!accountLoading && !editingAccount && !account && (
              <p className="text-xs text-muted-foreground py-2">No commercial account on file.</p>
            )}
            {!accountLoading && !editingAccount && account && (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {account.commercialAccountName && (
                  <>
                    <dt className="text-muted-foreground">Account Name</dt>
                    <dd className="font-medium">{account.commercialAccountName}</dd>
                  </>
                )}
                {account.legalEntityName && (
                  <>
                    <dt className="text-muted-foreground">Legal Entity</dt>
                    <dd className="font-medium">{account.legalEntityName}</dd>
                  </>
                )}
                {account.billingEmail && (
                  <>
                    <dt className="text-muted-foreground">Billing Email</dt>
                    <dd className="font-medium">{account.billingEmail}</dd>
                  </>
                )}
                {account.billingPhone && (
                  <>
                    <dt className="text-muted-foreground">Billing Phone</dt>
                    <dd className="font-medium">{account.billingPhone}</dd>
                  </>
                )}
              </dl>
            )}
            {editingAccount && (
              <div className="space-y-3" data-testid="commercial-account-form">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Account Name</label>
                    <input
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      value={accountForm.commercialAccountName ?? ""}
                      onChange={e =>
                        setAccountForm(f => ({ ...f, commercialAccountName: e.target.value }))
                      }
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Status</label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      value={accountForm.status ?? "draft"}
                      onChange={e => setAccountForm(f => ({ ...f, status: e.target.value }))}
                    >
                      {Object.values(COMMERCIAL_ACCOUNT_STATUS_CONFIG).map(s => (
                        <option key={s.code} value={s.code}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleAccountSave()}
                    disabled={upsertAccount.isPending}
                    data-testid="commercial-account-save-btn"
                    className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                  >
                    {upsertAccount.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingAccount(false)}
                    className="px-3 py-1.5 rounded-md border border-border text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {canReadContacts && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Billing Contacts</span>
              <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
            </div>
            {canWriteContacts && account && !showContactForm && (
              <button
                type="button"
                onClick={openNewContactForm}
                data-testid="commercial-add-contact-btn"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <PlusCircle className="w-3 h-3" />
                Add Contact
              </button>
            )}
          </div>
          <div className="px-4 py-4 space-y-3">
            {contactsLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {!contactsLoading && contacts.length === 0 && !showContactForm && (
              <p className="text-xs text-muted-foreground">No billing contacts on file.</p>
            )}
            {!contactsLoading &&
              contacts.map(contact => {
                const roleCfg =
                  BILLING_CONTACT_ROLE_CONFIG[contact.contactRole as BillingContactRole]
                  ?? BILLING_CONTACT_ROLE_CONFIG.other;
                return (
                  <div
                    key={contact.id}
                    className="flex items-start justify-between rounded-md border border-border p-3"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{contact.contactName}</span>
                        {contact.isPrimary && (
                          <span className="flex items-center gap-0.5 text-[10px] text-primary font-medium">
                            <Star className="w-2.5 h-2.5" />
                            Primary
                          </span>
                        )}
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {roleCfg.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Mail className="w-3 h-3" />
                          {contact.contactEmail}
                        </span>
                        {contact.contactPhone && (
                          <span className="flex items-center gap-0.5">
                            <Phone className="w-3 h-3" />
                            {contact.contactPhone}
                          </span>
                        )}
                      </div>
                    </div>
                    {canWriteContacts && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!contact.isPrimary && (
                          <button
                            type="button"
                            onClick={() => void setPrimary.mutateAsync(contact.id)}
                            disabled={setPrimary.isPending}
                            data-testid={`contact-set-primary-${contact.id}`}
                            className="text-[10px] border border-border rounded px-1.5 py-0.5"
                          >
                            Set Primary
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openContactEdit(contact)}
                          data-testid={`contact-edit-${contact.id}`}
                          className="text-[10px] border border-border rounded px-1.5 py-0.5"
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            {showContactForm && (
              <div className="rounded-md border p-3 space-y-2 bg-muted/10" data-testid="contact-form">
                <p className="text-xs font-semibold">
                  {editingContactId !== null ? "Edit Contact" : "New Contact"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="rounded border px-2 py-1 text-xs"
                    value={contactForm.contactName}
                    onChange={e => setContactForm(f => ({ ...f, contactName: e.target.value }))}
                    placeholder="Name*"
                  />
                  <input
                    className="rounded border px-2 py-1 text-xs"
                    type="email"
                    value={contactForm.contactEmail}
                    onChange={e => setContactForm(f => ({ ...f, contactEmail: e.target.value }))}
                    placeholder="Email*"
                  />
                  <select
                    className="rounded border px-2 py-1 text-xs col-span-2"
                    value={contactForm.contactRole ?? "other"}
                    onChange={e => setContactForm(f => ({ ...f, contactRole: e.target.value }))}
                  >
                    {BILLING_CONTACT_ROLE_CODES.map(r => (
                      <option key={r} value={r}>{BILLING_CONTACT_ROLE_CONFIG[r].label}</option>
                    ))}
                  </select>
                </div>
                {formError && <p className="text-xs text-destructive">{formError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleContactSave()}
                    disabled={createContact.isPending || updateContact.isPending}
                    data-testid="contact-save-btn"
                    className="px-3 py-1 rounded bg-primary text-primary-foreground text-xs"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowContactForm(false);
                      setEditingContactId(null);
                    }}
                    className="px-3 py-1 rounded border text-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {!account && !contactsLoading && (
              <p className="text-xs text-muted-foreground">Create a commercial account first.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

