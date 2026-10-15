using System.Collections.Generic;

namespace BlockSurvival.World
{
    /// Culled chunk mesher — twin of <c>server/resources/js/world/mesher.ts</c>.
    /// Emits only exposed faces, with per-vertex colours from the palette and
    /// baked 4-level ambient occlusion. Two geometries per chunk: opaque and
    /// translucent.
    ///
    /// Vertices are interleaved for the GPU: position(3) normal(3) colour(4),
    /// all float32 — see <see cref="MeshData.VertexFloats"/>.
    public sealed class MeshData
    {
        public const int VertexFloats = 10;

        /// interleaved x y z nx ny nz r g b a
        public readonly float[] Vertices;
        public readonly int[] Indices;

        public MeshData(float[] vertices, int[] indices)
        {
            Vertices = vertices;
            Indices = indices;
        }

        public int VertexCount => Vertices.Length / VertexFloats;
    }

    public sealed class ChunkMeshResult
    {
        public readonly MeshData Opaque;
        public readonly MeshData Translucent;

        public ChunkMeshResult(MeshData opaque, MeshData translucent)
        {
            Opaque = opaque;
            Translucent = translucent;
        }

        public bool IsEmpty => Opaque == null && Translucent == null;
    }

    public static class Mesher
    {
        private readonly struct FaceDef
        {
            public readonly (int, int, int) N;

            /// CCW seen from outside
            public readonly (int, int, int)[] Corners;

            /// 0 top, 1 side, 2 bottom colour
            public readonly int Slot;

            /// the two in-plane axes used for AO neighbour sampling, per corner
            public readonly ((int, int, int), (int, int, int))[] Ao;

            public FaceDef((int, int, int) n, (int, int, int)[] corners, int slot, ((int, int, int), (int, int, int))[] ao)
            {
                N = n; Corners = corners; Slot = slot; Ao = ao;
            }
        }

        private static readonly FaceDef[] Faces =
        {
            new FaceDef((0, 1, 0), new[] { (0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0) }, 0, new[]
            {
                ((-1, 0, 0), (0, 0, -1)), ((-1, 0, 0), (0, 0, 1)), ((1, 0, 0), (0, 0, 1)), ((1, 0, 0), (0, 0, -1)),
            }),
            new FaceDef((0, -1, 0), new[] { (0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1) }, 2, new[]
            {
                ((-1, 0, 0), (0, 0, -1)), ((1, 0, 0), (0, 0, -1)), ((1, 0, 0), (0, 0, 1)), ((-1, 0, 0), (0, 0, 1)),
            }),
            new FaceDef((1, 0, 0), new[] { (1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1) }, 1, new[]
            {
                ((0, -1, 0), (0, 0, -1)), ((0, 1, 0), (0, 0, -1)), ((0, 1, 0), (0, 0, 1)), ((0, -1, 0), (0, 0, 1)),
            }),
            new FaceDef((-1, 0, 0), new[] { (0, 0, 1), (0, 1, 1), (0, 1, 0), (0, 0, 0) }, 1, new[]
            {
                ((0, -1, 0), (0, 0, 1)), ((0, 1, 0), (0, 0, 1)), ((0, 1, 0), (0, 0, -1)), ((0, -1, 0), (0, 0, -1)),
            }),
            new FaceDef((0, 0, 1), new[] { (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1) }, 1, new[]
            {
                ((-1, 0, 0), (0, -1, 0)), ((1, 0, 0), (0, -1, 0)), ((1, 0, 0), (0, 1, 0)), ((-1, 0, 0), (0, 1, 0)),
            }),
            new FaceDef((0, 0, -1), new[] { (1, 0, 0), (0, 0, 0), (0, 1, 0), (1, 1, 0) }, 1, new[]
            {
                ((1, 0, 0), (0, -1, 0)), ((-1, 0, 0), (0, -1, 0)), ((-1, 0, 0), (0, 1, 0)), ((1, 0, 0), (0, 1, 0)),
            }),
        };

        private static readonly double[] AoLevels = { 0.5, 0.68, 0.84, 1.0 };
        private const double WaterTopDrop = 0.15;

        private sealed class Builder
        {
            private readonly List<float> _vertices = new List<float>();
            private readonly List<int> _indices = new List<int>();
            private int _vertexCount;

            public void Quad((double, double, double)[] pts, (int, int, int) n, Rgb rgb, double alpha, int[] ao)
            {
                for (var i = 0; i < 4; i++)
                {
                    var (px, py, pz) = pts[i];
                    var shade = AoLevels[ao[i]];
                    _vertices.Add((float)px);
                    _vertices.Add((float)py);
                    _vertices.Add((float)pz);
                    _vertices.Add(n.Item1);
                    _vertices.Add(n.Item2);
                    _vertices.Add(n.Item3);
                    _vertices.Add((float)(rgb.R * shade));
                    _vertices.Add((float)(rgb.G * shade));
                    _vertices.Add((float)(rgb.B * shade));
                    _vertices.Add((float)alpha);
                }
                var b = _vertexCount;
                // flip the diagonal so AO interpolates without the classic seam artefact
                if (ao[0] + ao[2] > ao[1] + ao[3])
                {
                    _indices.Add(b); _indices.Add(b + 1); _indices.Add(b + 2);
                    _indices.Add(b); _indices.Add(b + 2); _indices.Add(b + 3);
                }
                else
                {
                    _indices.Add(b + 1); _indices.Add(b + 2); _indices.Add(b + 3);
                    _indices.Add(b + 1); _indices.Add(b + 3); _indices.Add(b);
                }
                _vertexCount += 4;
            }

            public MeshData Build() => _indices.Count == 0 ? null : new MeshData(_vertices.ToArray(), _indices.ToArray());
        }

        /// Does a block occlude ambient light? (opaque-ish solids)
        private static bool Occludes(byte id) => id != Block.Air && id != Block.Water && id != Block.Glass && !Palette.IsProp(id);

        private static int VertexAo(WorldStore world, int x, int y, int z, (int, int, int) n, (int, int, int) s1, (int, int, int) s2)
        {
            var bx = x + n.Item1;
            var by = y + n.Item2;
            var bz = z + n.Item3;
            var side1 = Occludes(world.GetBlock(bx + s1.Item1, by + s1.Item2, bz + s1.Item3)) ? 1 : 0;
            var side2 = Occludes(world.GetBlock(bx + s2.Item1, by + s2.Item2, bz + s2.Item3)) ? 1 : 0;
            var corner = Occludes(world.GetBlock(bx + s1.Item1 + s2.Item1, by + s1.Item2 + s2.Item2, bz + s1.Item3 + s2.Item3)) ? 1 : 0;
            if (side1 == 1 && side2 == 1) return 0;
            return 3 - (side1 + side2 + corner);
        }

        /// Should this face of `kind` be drawn against neighbour `nb`?
        public static bool FaceVisible(byte kind, byte nb, bool isTop)
        {
            if (nb != Block.Air && !(Palette.IsSeeThrough(nb) && nb != kind)) return false;
            if (kind == Block.Water && !isTop && nb != Block.Air) return false;
            return true;
        }

        public static ChunkMeshResult MeshChunk(WorldStore world, int cx, int cy, int cz)
        {
            var chunk = world.GetChunk(cx, cy, cz);
            if (chunk == null) return new ChunkMeshResult(null, null);
            var opaqueBuilder = new Builder();
            var translucentBuilder = new Builder();
            var ox = cx * Chunk.Size;
            var oy = cy * Chunk.Size;
            var oz = cz * Chunk.Size;
            var ao = new[] { 3, 3, 3, 3 };

            for (var lx = 0; lx < Chunk.Size; lx++)
            {
                for (var ly = 0; ly < Chunk.Size; ly++)
                {
                    for (var lz = 0; lz < Chunk.Size; lz++)
                    {
                        var kind = chunk[(lx << 8) | (ly << 4) | lz];
                        if (kind == Block.Air || Palette.IsProp(kind)) continue;
                        var x = ox + lx;
                        var y = oy + ly;
                        var z = oz + lz;
                        var def = Palette.BlockDefs[kind];
                        var target = Palette.IsTranslucent(kind) ? translucentBuilder : opaqueBuilder;
                        foreach (var face in Faces)
                        {
                            var nb = world.GetBlock(x + face.N.Item1, y + face.N.Item2, z + face.N.Item3);
                            var isTop = face.Slot == 0;
                            if (!FaceVisible(kind, nb, isTop)) continue;
                            var drop = kind == Block.Water && isTop ? WaterTopDrop : 0.0;
                            var pts = new (double, double, double)[4];
                            for (var i = 0; i < 4; i++)
                            {
                                var c = face.Corners[i];
                                pts[i] = (x + c.Item1, y + c.Item2 - drop, z + c.Item3);
                            }
                            for (var i = 0; i < 4; i++)
                            {
                                ao[i] = VertexAo(world, x, y, z, face.N, face.Ao[i].Item1, face.Ao[i].Item2);
                            }
                            var colour = face.Slot switch
                            {
                                0 => def.Top,
                                2 => def.Bottom,
                                _ => def.Side,
                            };
                            target.Quad(pts, face.N, colour, def.Alpha, ao);
                        }
                    }
                }
            }
            return new ChunkMeshResult(opaqueBuilder.Build(), translucentBuilder.Build());
        }
    }
}
