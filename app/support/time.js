export function sqlTime(dt) {
    return dt.toFormat('yyyy-MM-dd HH:mm:ss');
}
export function iso(dt) {
    return dt ? dt.toISO({ suppressMilliseconds: true }) : null;
}
//# sourceMappingURL=time.js.map