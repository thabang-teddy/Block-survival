import { DateTime } from 'luxon'

/**
 * A timestamp as SQLite stores Lucid's `@column.dateTime` values ('yyyy-MM-dd HH:mm:ss'
 * in the process zone), for `where` clauses that compare against those columns.
 */
export function sqlTime(dt: DateTime): string {
  return dt.toFormat('yyyy-MM-dd HH:mm:ss')
}

/** ISO 8601 without milliseconds, the way the Laravel app's `toIso8601String()` wrote it */
export function iso(dt: DateTime | null | undefined): string | null {
  return dt ? dt.toISO({ suppressMilliseconds: true }) : null
}
