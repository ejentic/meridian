'use client';

/**
 * A plain table with a caption and a stated empty case.
 *
 * The empty case is spelled out rather than left as a blank area, because "no rows" and "the
 * request was refused" look identical on an empty screen, and telling those two apart is
 * most of what a trainee is being asked to do.
 */
export interface Column<T> {
  header: string;
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty = 'No rows.',
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="note">{empty}</p>;

  return (
    <table>
      <caption className="note">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.header} className={column.numeric ? 'numeric' : undefined}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((column) => (
              <td key={column.header} className={column.numeric ? 'numeric' : undefined}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
