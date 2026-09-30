/** The cURL facade contract manifest in row order (28 rows: 24 repair rows + 4 controls). */
import { censusRows } from './rows-census.ts';
import { downloadRows } from './rows-download.ts';
import { redirectRows } from './rows-redirect.ts';
import { retryRows } from './rows-retry.ts';
import type { Row } from './row.ts';
import { statusRows } from './rows-status.ts';
import { terminalRows } from './rows-terminals.ts';
import { waitRows } from './rows-waits.ts';

const byId = new Map<string, Row>();
for (const row of [...statusRows, ...terminalRows, ...downloadRows, ...redirectRows, ...retryRows, ...waitRows, ...censusRows]) byId.set(row.id, row);
export const ROW_ORDER = ['CFC-01', 'CFC-02', 'CFC-03', 'CFC-04', 'CFC-05', 'CFC-06', 'CFC-07', 'CFC-08', 'CFC-09', 'CFC-10', 'CFC-11', 'CFC-12', 'CFC-13', 'CFC-14', 'CFC-15', 'CFC-16', 'CFC-17', 'CFC-18', 'CFC-19', 'CFC-20a', 'CFC-20b', 'CFC-20c', 'CFC-21', 'CFC-22', 'CFC-23', 'CFC-24', 'CFC-25', 'CFC-26'] as const;
export const CFC_ROWS: Row[] = ROW_ORDER.map((id) => { const row = byId.get(id); if (!row) throw new Error(`row ${id} is not implemented`); return row; });
