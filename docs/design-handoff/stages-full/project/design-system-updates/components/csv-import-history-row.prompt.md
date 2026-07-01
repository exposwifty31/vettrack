CsvImportHistoryRow — proposed addition (§21-D5), not yet in the published
bundle. Import from `@/components/general/csv-import-history-row` once
merged.

Companion to the real, shipped `CsvImportDialog` — that component performs
the import; this renders one row of the import-history list shown beneath it
(Stage 8 Admin Shifts Import always keeps history visible under the active
step, never as a separate mode).

## Props

```ts
interface CsvImportHistoryRowProps {
  fileName: string;
  meta: string; // pre-formatted, e.g. "Jun 29 · 40 rows · Admin"
  className?: string;
}
```

## Usage

```jsx
<CsvImportHistoryRow fileName="shifts_week27.csv" meta="Jun 29 · 40 rows · Admin" />
```
