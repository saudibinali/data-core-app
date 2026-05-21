/**
 * @phase P15-F - Load commercial data for risk computation (read-only)
 */

import { db } from "@workspace/db";
import {
  workspacesTable,
  commercialAccountsTable,
  commercialBillingContactsTable,
  commercialContractTermsTable,
  commercialInvoicesTable,
  commercialInvoiceDocumentsTable,
  commercialPaymentRecordsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import {
  computeTenantCommercialRisk,
  type CommercialRiskAssessment,
  type TenantCommercialRiskInput,
} from "./commercial-risk-engine";

export async function loadAllTenantCommercialRiskAssessments(): Promise<CommercialRiskAssessment[]> {
  const workspaces = await db.query.workspacesTable.findMany({
    columns: { id: true, name: true },
  });
  if (workspaces.length === 0) return [];

  const workspaceIds = workspaces.map(w => w.id);
  const inputs = await loadCommercialInputsForWorkspaces(workspaces, workspaceIds);
  return inputs.map(inp => computeTenantCommercialRisk(inp));
}

export async function loadTenantCommercialRiskAssessment(
  tenantId: number,
): Promise<CommercialRiskAssessment | null> {
  const ws = await db.query.workspacesTable.findFirst({
    where: eq(workspacesTable.id, tenantId),
    columns: { id: true, name: true },
  });
  if (!ws) return null;

  const [input] = await loadCommercialInputsForWorkspaces([ws], [tenantId]);
  if (!input) return null;
  return computeTenantCommercialRisk(input);
}

async function loadCommercialInputsForWorkspaces(
  workspaces: Array<{ id: number; name: string }>,
  workspaceIds: number[],
): Promise<TenantCommercialRiskInput[]> {
  const accounts = await db.query.commercialAccountsTable.findMany({
    where: inArray(commercialAccountsTable.workspaceId, workspaceIds),
  });
  const accountIds = accounts.map(a => a.id);
  const accountByWs = new Map(accounts.map(a => [a.workspaceId, a]));

  const contracts = accountIds.length
    ? await db.query.commercialContractTermsTable.findMany({
        where: inArray(commercialContractTermsTable.commercialAccountId, accountIds),
      })
    : [];

  const contacts = accountIds.length
    ? await db.query.commercialBillingContactsTable.findMany({
        where: inArray(commercialBillingContactsTable.commercialAccountId, accountIds),
      })
    : [];

  const invoices = await db.query.commercialInvoicesTable.findMany({
    where: inArray(commercialInvoicesTable.workspaceId, workspaceIds),
  });
  const invoiceIds = invoices.map(i => i.id);

  const documents = invoiceIds.length
    ? await db.query.commercialInvoiceDocumentsTable.findMany({
        where: inArray(commercialInvoiceDocumentsTable.invoiceId, invoiceIds),
      })
    : [];
  const docByInvoice = new Set(documents.map(d => d.invoiceId));

  const payments = invoiceIds.length
    ? await db.query.commercialPaymentRecordsTable.findMany({
        where: inArray(commercialPaymentRecordsTable.invoiceId, invoiceIds),
      })
    : [];

  const contractsByWs = new Map<number, typeof contracts>();
  for (const c of contracts) {
    const list = contractsByWs.get(c.workspaceId) ?? [];
    list.push(c);
    contractsByWs.set(c.workspaceId, list);
  }

  const contactCountByAccount = new Map<number, number>();
  for (const ct of contacts) {
    contactCountByAccount.set(
      ct.commercialAccountId,
      (contactCountByAccount.get(ct.commercialAccountId) ?? 0) + 1,
    );
  }

  const paymentsByInvoice = new Map<number, typeof payments>();
  for (const p of payments) {
    const list = paymentsByInvoice.get(p.invoiceId) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.invoiceId, list);
  }

  const allPaymentsByWs = new Map<number, typeof payments>();
  for (const p of payments) {
    const list = allPaymentsByWs.get(p.workspaceId) ?? [];
    list.push(p);
    allPaymentsByWs.set(p.workspaceId, list);
  }

  return workspaces.map(ws => {
    const acct = accountByWs.get(ws.id);
    const wsContracts = contractsByWs.get(ws.id) ?? [];
    const wsInvoices = invoices.filter(i => i.workspaceId === ws.id);

    return {
      tenantId: ws.id,
      tenantName: ws.name,
      contracts: wsContracts.map(c => ({
        status: c.status,
        contractEndDate: c.contractEndDate,
        renewalDate: c.renewalDate,
        renewalNoticeDays: c.renewalNoticeDays,
        renewalCommitmentStatus: c.renewalCommitmentStatus,
      })),
      billingContactCount: acct ? (contactCountByAccount.get(acct.id) ?? 0) : 0,
      invoices: wsInvoices.map(inv => ({
        status: inv.status,
        invoiceAmount: inv.invoiceAmount,
        invoiceDate: inv.invoiceDate,
        hasDocument: docByInvoice.has(inv.id),
        payments: (paymentsByInvoice.get(inv.id) ?? []).map(p => ({
          receivedAmount: p.receivedAmount,
          collectionStatus: p.collectionStatus,
        })),
      })),
      payments: (allPaymentsByWs.get(ws.id) ?? []).map(p => ({
        paymentDate: p.paymentDate,
        collectionStatus: p.collectionStatus,
      })),
    };
  });
}
