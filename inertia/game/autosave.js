export const AUTOSAVE_SECONDS = 60;
export const RETRY_SECONDS = 15;
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}
export class Autosave {
    upload;
    interval;
    elapsed = 0;
    dirty = false;
    current = null;
    queued = null;
    saved = 0;
    failed = 0;
    constructor(upload, interval = AUTOSAVE_SECONDS) {
        this.upload = upload;
        this.interval = interval;
    }
    markDirty() {
        this.dirty = true;
    }
    get isDirty() {
        return this.dirty;
    }
    get inFlight() {
        return this.current !== null;
    }
    tick(dt) {
        this.elapsed += dt;
        if (!this.dirty || this.current || this.elapsed < this.interval)
            return false;
        this.start().catch(() => { });
        return true;
    }
    saveNow() {
        if (!this.current)
            return this.start();
        this.queued ??= deferred();
        return this.queued.promise;
    }
    start() {
        this.dirty = false;
        this.elapsed = 0;
        const run = this.upload().then(() => { this.saved++; }, (err) => {
            this.failed++;
            this.dirty = true;
            this.elapsed = this.interval - RETRY_SECONDS;
            throw err;
        });
        this.current = run.then(() => { }, () => { }).then(() => {
            this.current = null;
            const next = this.queued;
            if (!next)
                return;
            this.queued = null;
            this.start().then(next.resolve, next.reject);
        });
        return run;
    }
}
//# sourceMappingURL=autosave.js.map