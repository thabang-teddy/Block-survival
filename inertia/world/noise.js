export function createRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
export function makeRng(seed) {
    const next = createRng(seed);
    return {
        random: next,
        randint: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
        shuffle(arr) {
            const out = arr.slice();
            for (let i = out.length - 1; i > 0; i--) {
                const j = Math.floor(next() * (i + 1));
                const tmp = out[i];
                out[i] = out[j];
                out[j] = tmp;
            }
            return out;
        },
    };
}
export function hashInt(a, b = 0, c = 0, d = 0) {
    let h = Math.imul(a | 0, 0x9e3779b1) ^ 0x85ebca6b;
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^ Math.imul(b | 0, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 13), 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) ^ Math.imul(d | 0, 0xc2b2ae35);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4eb2f);
    return (h ^ (h >>> 16)) >>> 0;
}
export const hash01 = (a, b = 0, c = 0, d = 0) => hashInt(a, b, c, d) / 4294967296;
const GRAD = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + t * (b - a);
export class PerlinNoise {
    perm = new Uint8Array(512);
    constructor(seed) {
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++)
            p[i] = i;
        const rng = createRng(seed);
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            const tmp = p[i];
            p[i] = p[j];
            p[j] = tmp;
        }
        for (let i = 0; i < 512; i++)
            this.perm[i] = p[i & 255];
    }
    grad(hash, x, y, z) {
        const g = GRAD[hash % 12];
        return g[0] * x + g[1] * y + g[2] * z;
    }
    noise(x, y, z) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        const Z = Math.floor(z) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        z -= Math.floor(z);
        const u = fade(x);
        const v = fade(y);
        const w = fade(z);
        const p = this.perm;
        const A = p[X] + Y;
        const AA = p[A] + Z;
        const AB = p[A + 1] + Z;
        const B = p[X + 1] + Y;
        const BA = p[B] + Z;
        const BB = p[B + 1] + Z;
        return lerp(lerp(lerp(this.grad(p[AA], x, y, z), this.grad(p[BA], x - 1, y, z), u), lerp(this.grad(p[AB], x, y - 1, z), this.grad(p[BB], x - 1, y - 1, z), u), v), lerp(lerp(this.grad(p[AA + 1], x, y, z - 1), this.grad(p[BA + 1], x - 1, y, z - 1), u), lerp(this.grad(p[AB + 1], x, y - 1, z - 1), this.grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
    }
}
export function fractal2(perlin) {
    return (x, z, seed, freq) => {
        const vx = x * freq;
        const vz = z * freq;
        const vs = seed * 7.31;
        return perlin.noise(vx, vz, vs) + 0.5 * perlin.noise(vx * 2.1 + 3.3, vz * 2.1 + 1.7, vs * 2.1);
    };
}
//# sourceMappingURL=noise.js.map