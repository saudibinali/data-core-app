/**
 * Phase 4 — Transaction manager with savepoints and failure isolation.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { incrementRuntimeMetric } from "../../workforce/stabilization/observability-metrics";

export type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RowExecutionResult<T> = {
  rowNumber: number;
  ok: boolean;
  result?: T;
  error?: string;
  savepoint?: string;
};

export type TransactionBatchResult<T> = {
  results: RowExecutionResult<T>[];
  committed: boolean;
  savepointFailures: number;
  timingMs: number;
};

export async function runTransactionalBatch<T>(input: {
  label: string;
  rows: Array<{ rowNumber: number; execute: (tx: TxClient) => Promise<T> }>;
}): Promise<TransactionBatchResult<T>> {
  const t0 = Date.now();
  const results: RowExecutionResult<T>[] = [];
  let savepointFailures = 0;

  try {
    await db.transaction(async (tx) => {
      for (const row of input.rows) {
        const sp = `sp_${input.label}_${row.rowNumber}`.replace(/[^a-zA-Z0-9_]/g, "_");
        try {
          await tx.execute(sql.raw(`SAVEPOINT "${sp}"`));
          const result = await row.execute(tx);
          await tx.execute(sql.raw(`RELEASE SAVEPOINT "${sp}"`));
          results.push({ rowNumber: row.rowNumber, ok: true, result, savepoint: sp });
        } catch (e) {
          savepointFailures++;
          incrementRuntimeMetric("import.v4.savepoint_failure");
          try {
            await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT "${sp}"`));
          } catch {
            /* savepoint may not exist */
          }
          results.push({
            rowNumber: row.rowNumber,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
            savepoint: sp,
          });
        }
      }
    });

    incrementRuntimeMetric("import.v4.transaction_success");
    return {
      results,
      committed: true,
      savepointFailures,
      timingMs: Date.now() - t0,
    };
  } catch (e) {
    incrementRuntimeMetric("import.v4.transaction_failure");
    if (results.length === 0) {
      for (const row of input.rows) {
        results.push({
          rowNumber: row.rowNumber,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return {
      results,
      committed: false,
      savepointFailures,
      timingMs: Date.now() - t0,
    };
  }
}

export async function runInTransaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
