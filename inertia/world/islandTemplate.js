import { AIR } from "./palette.js";
import { generateIsland } from "./islandGen.js";
const XZ_MARGIN = 5;
const Y_BELOW = 12;
const Y_ABOVE = 16;
export class IslandTemplate {
    minX = Infinity;
    minY = Infinity;
    minZ = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    maxZ = -Infinity;
    padHeight;
    voxelCount = 0;
    ext;
    yLo;
    yHi;
    sx;
    sy;
    data;
    constructor(params) {
        this.ext = Math.trunc(params.size / 2) + XZ_MARGIN;
        this.yLo = -(params.depth + Y_BELOW);
        this.yHi = params.maxHeight + Y_ABOVE;
        this.sx = this.ext * 2 + 1;
        this.sy = this.yHi - this.yLo + 1;
        this.data = new Uint8Array(this.sx * this.sy * this.sx);
        this.padHeight = generateIsland(this, params).padHeight;
    }
    get(x, y, z) {
        if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY || z < this.minZ || z > this.maxZ)
            return AIR;
        return this.data[this.index(x, y, z)];
    }
    getBlock(x, y, z) {
        if (!this.inside(x, y, z))
            return AIR;
        return this.data[this.index(x, y, z)];
    }
    setBlock(x, y, z, id) {
        if (!this.inside(x, y, z))
            throw new Error(`island block ${x},${y},${z} outside its template`);
        const i = this.index(x, y, z);
        if (this.data[i] === AIR && id !== AIR)
            this.voxelCount++;
        this.data[i] = id;
        if (id === AIR)
            return;
        if (x < this.minX)
            this.minX = x;
        if (x > this.maxX)
            this.maxX = x;
        if (y < this.minY)
            this.minY = y;
        if (y > this.maxY)
            this.maxY = y;
        if (z < this.minZ)
            this.minZ = z;
        if (z > this.maxZ)
            this.maxZ = z;
    }
    setBlockIfAir(x, y, z, id) {
        if (this.getBlock(x, y, z) === AIR)
            this.setBlock(x, y, z, id);
    }
    inside(x, y, z) {
        return x >= -this.ext && x <= this.ext && z >= -this.ext && z <= this.ext && y >= this.yLo && y <= this.yHi;
    }
    index(x, y, z) {
        return ((z + this.ext) * this.sy + (y - this.yLo)) * this.sx + (x + this.ext);
    }
}
//# sourceMappingURL=islandTemplate.js.map