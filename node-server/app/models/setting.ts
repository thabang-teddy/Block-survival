import { SettingSchema } from '#database/schema'

/**
 * Admin-editable key/value settings. The whole table is small and read on every
 * request (the login window), so it is kept in memory as one map; this process is the
 * only writer, so invalidating on write is enough.
 */
export default class Setting extends SettingSchema {
  static table = 'settings'

  private static cache: Map<string, string> | null = null

  static async allValues(): Promise<Map<string, string>> {
    if (!Setting.cache) {
      const rows = await Setting.all()
      Setting.cache = new Map(rows.map((r) => [r.key, r.value]))
    }
    return Setting.cache
  }

  static async get(key: string, fallback: string | null = null): Promise<string | null> {
    return (await Setting.allValues()).get(key) ?? fallback
  }

  static async setMany(values: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(values)) {
      await Setting.updateOrCreate({ key }, { value })
    }
    Setting.forget()
  }

  /** drop the in-memory copy (after a write, and between tests) */
  static forget(): void {
    Setting.cache = null
  }
}
