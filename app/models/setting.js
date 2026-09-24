import { SettingSchema } from '#database/schema';
export default class Setting extends SettingSchema {
    static table = 'settings';
    static cache = null;
    static async allValues() {
        if (!Setting.cache) {
            const rows = await Setting.all();
            Setting.cache = new Map(rows.map((r) => [r.key, r.value]));
        }
        return Setting.cache;
    }
    static async get(key, fallback = null) {
        return (await Setting.allValues()).get(key) ?? fallback;
    }
    static async setMany(values) {
        for (const [key, value] of Object.entries(values)) {
            await Setting.updateOrCreate({ key }, { value });
        }
        Setting.forget();
    }
    static forget() {
        Setting.cache = null;
    }
}
//# sourceMappingURL=setting.js.map