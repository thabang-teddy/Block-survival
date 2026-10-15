using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace BlockSurvival.World.Tests
{
    /// Verifies the C# world generator reproduces <c>shared/fixtures/worldgen/</c>
    /// byte for byte, exactly as the Dart port does (see
    /// <c>client/test/world/</c> and <c>docs/flutter-client-plan.md</c> §2 S2 /
    /// §7 S2). A mismatch here means this Unity port has drifted from
    /// <c>server/resources/js/world/*.ts</c>, which breaks cross-play.
    public class WorldGenFixtureTests
    {
        private static readonly long[] Seeds = { 11, 1, 12345, 987654321, 2147483646 };

        private static string FixturesDir
        {
            get
            {
                // Application.dataPath = <project>/unity-client/Assets
                var projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
                return Path.Combine(projectRoot, "shared", "fixtures", "worldgen");
            }
        }

        private static readonly Dictionary<string, JObject> FixtureCache = new Dictionary<string, JObject>();

        private static JObject Load(string name)
        {
            if (FixtureCache.TryGetValue(name, out var cached)) return cached;
            var path = Path.Combine(FixturesDir, name);
            var obj = JObject.Parse(File.ReadAllText(path));
            FixtureCache[name] = obj;
            return obj;
        }

        private static string Sha256Hex(byte[] bytes)
        {
            using var sha = SHA256.Create();
            var hash = sha.ComputeHash(bytes);
            var sb = new StringBuilder(hash.Length * 2);
            foreach (var b in hash) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        private static byte[] Gunzip(byte[] gz)
        {
            using var input = new MemoryStream(gz);
            using var gzip = new GZipStream(input, CompressionMode.Decompress);
            using var output = new MemoryStream();
            gzip.CopyTo(output);
            return output.ToArray();
        }

        // ------------------------------------------------------------- primitives

        [Test]
        public void Rng_matches_fixture()
        {
            var rng = (JObject)Load("primitives.json")["rng"];
            foreach (var prop in rng.Properties())
            {
                var seed = long.Parse(prop.Name);
                var next = Noise.CreateRng(seed);
                foreach (var expected in prop.Value.Select(v => (double)v))
                {
                    Assert.AreEqual(expected, next(), 0, $"seed {seed}");
                }
            }
        }

        [Test]
        public void HashInt_matches_fixture()
        {
            foreach (var row in (JArray)Load("primitives.json")["hashInt"])
            {
                var a = (long)row[0];
                var b = (long)row[1];
                var c = (long)row[2];
                var d = (long)row[3];
                var expected = (long)row[4];
                Assert.AreEqual(expected, Noise.HashInt(a, b, c, d), $"hashInt({a},{b},{c},{d})");
            }
        }

        [Test]
        public void Perlin_matches_fixture()
        {
            var perlinObj = (JObject)Load("primitives.json")["perlin"];
            var perlin = new PerlinNoise((long)perlinObj["seed"]);
            foreach (var row in (JArray)perlinObj["samples"])
            {
                var x = (double)row[0];
                var y = (double)row[1];
                var z = (double)row[2];
                var expected = (double)row[3];
                Assert.AreEqual(expected, perlin.SampleNoise(x, y, z), 0, $"perlin({x},{y},{z})");
            }
        }

        [Test]
        public void Fractal2_matches_fixture()
        {
            // the dump script builds the fractal2 sampler from the same PerlinNoise(11 ^ 0x5eed) as `perlin`.
            var perlin = new PerlinNoise(11L ^ 0x5eedL);
            var n2 = PerlinNoise.Fractal2Of(perlin);
            foreach (var row in (JArray)Load("primitives.json")["fractal2"])
            {
                var x = (double)row[0];
                var z = (double)row[1];
                var seed = (double)row[2];
                var freq = (double)row[3];
                var expected = (double)row[4];
                Assert.AreEqual(expected, n2(x, z, seed, freq), 0, $"fractal2({x},{z},{seed},{freq})");
            }
        }

        [Test]
        public void Hypot_matches_fixture()
        {
            foreach (var row in (JArray)Load("primitives.json")["hypot"])
            {
                var x = (double)row[0];
                var z = (double)row[1];
                var expected = (double)row[2];
                Assert.AreEqual(expected, JsMath.Hypot(x, z), 0, $"hypot({x},{z})");
            }
        }

        [Test]
        public void Trig_matches_fixture()
        {
            foreach (var row in (JArray)Load("primitives.json")["trig"])
            {
                var a = (double)row[0];
                var expSin = (double)row[1];
                var expCos = (double)row[2];
                Assert.AreEqual(expSin, JsMath.JsSin(a), 0, $"sin({a})");
                Assert.AreEqual(expCos, JsMath.JsCos(a), 0, $"cos({a})");
            }
        }

        // ------------------------------------------------------------- per-seed

        [TestCaseSource(nameof(Seeds))]
        public void Spawn_and_padHeight_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var gen = new TerrainGenerator(seed);
            var ground = new GroundModel(seed);
            var spawn = gen.GetSpawn();
            var fxSpawn = (JObject)fx["spawn"];
            Assert.AreEqual((double)fxSpawn["x"], spawn.X, 0);
            Assert.AreEqual((double)fxSpawn["y"], spawn.Y, 0);
            Assert.AreEqual((double)fxSpawn["z"], spawn.Z, 0);
            Assert.AreEqual((long)fx["padHeight"], ground.PadHeight);
        }

        [TestCaseSource(nameof(Seeds))]
        public void Heights_and_naturalHeights_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var ground = new GroundModel(seed);
            foreach (var row in (JArray)fx["heights"])
            {
                var x = (int)row[0];
                var z = (int)row[1];
                Assert.AreEqual((int)row[2], ground.Height(x, z), $"height({x},{z}) seed {seed}");
            }
            foreach (var row in (JArray)fx["naturalHeights"])
            {
                var x = (int)row[0];
                var z = (int)row[1];
                Assert.AreEqual((int)row[2], ground.NaturalHeight(x, z), $"naturalHeight({x},{z}) seed {seed}");
            }
        }

        [TestCaseSource(nameof(Seeds))]
        public void Trees_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var ground = new GroundModel(seed);
            int HeightAt(int x, int z) => ground.Height(x, z);
            var expected = ((JArray)fx["trees"]).Select(r => ((int)r[0], (int)r[1], (int)r[2])).ToList();
            var actual = new List<(int, int, int)>();
            for (var x = -64; x < 64; x++)
            {
                for (var z = -64; z < 64; z++)
                {
                    var h = ground.TreeHeight(x, z, HeightAt);
                    if (h != 0) actual.Add((x, z, h));
                }
            }
            CollectionAssert.AreEqual(expected, actual, $"seed {seed}");
        }

        [TestCaseSource(nameof(Seeds))]
        public void Islands_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            foreach (var entry in (JArray)fx["islands"])
            {
                var ix = (int)entry["ix"];
                var iz = (int)entry["iz"];
                var expected = entry["island"];
                var actual = IslandField.IslandAtCell(seed, ix, iz);
                if (expected == null || expected.Type == JTokenType.Null)
                {
                    Assert.IsNull(actual, $"island({ix},{iz}) seed {seed}");
                    continue;
                }
                Assert.IsNotNull(actual, $"island({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)expected["x"], actual.X, $"island.x ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)expected["z"], actual.Z, $"island.z ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)expected["baseY"], actual.BaseY, $"island.baseY ({ix},{iz}) seed {seed}");
                var p = expected["params"];
                Assert.AreEqual((int)p["size"], actual.Params.Size, $"params.size ({ix},{iz}) seed {seed}");
                Assert.AreEqual((long)p["seed"], actual.Params.Seed, $"params.seed ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)p["maxHeight"], actual.Params.MaxHeight, $"params.maxHeight ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)p["depth"], actual.Params.Depth, $"params.depth ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)p["padRadius"], actual.Params.PadRadius, $"params.padRadius ({ix},{iz}) seed {seed}");
                Assert.AreEqual((bool)p["lake"], actual.Params.Lake, $"params.lake ({ix},{iz}) seed {seed}");
                Assert.AreEqual((double)p["treeDensity"], actual.Params.TreeDensity, 0, $"params.treeDensity ({ix},{iz}) seed {seed}");
            }
        }

        [TestCaseSource(nameof(Seeds))]
        public void Templates_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var templates = new IslandTemplates();
            foreach (var entry in (JArray)fx["templates"])
            {
                var ix = (int)entry["ix"];
                var iz = (int)entry["iz"];
                var island = IslandField.IslandAtCell(seed, ix, iz);
                Assert.IsNotNull(island, $"template island({ix},{iz}) seed {seed}");
                var t = templates.Get(island);
                Assert.AreEqual((int)entry["minX"], t.MinX, $"minX ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["minY"], t.MinY, $"minY ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["minZ"], t.MinZ, $"minZ ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["maxX"], t.MaxX, $"maxX ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["maxY"], t.MaxY, $"maxY ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["maxZ"], t.MaxZ, $"maxZ ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["padHeight"], t.PadHeight, $"padHeight ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["voxelCount"], t.VoxelCount, $"voxelCount ({ix},{iz}) seed {seed}");

                // re-read the template through its public accessor, in the same order the dump script hashed it
                var size = island.Params.Size;
                var depth = island.Params.Depth;
                var maxHeight = island.Params.MaxHeight;
                var ext = size / 2 + 5;
                var yLo = -(depth + 12);
                var yHi = maxHeight + 16;
                var bytes = new byte[(ext * 2 + 1) * (yHi - yLo + 1) * (ext * 2 + 1)];
                var i = 0;
                for (var z = -ext; z <= ext; z++)
                {
                    for (var y = yLo; y <= yHi; y++)
                    {
                        for (var x = -ext; x <= ext; x++)
                        {
                            bytes[i++] = t.Get(x, y, z);
                        }
                    }
                }
                Assert.AreEqual((string)entry["sha256"], Sha256Hex(bytes), $"template sha256 ({ix},{iz}) seed {seed}");
            }
        }

        [TestCaseSource(nameof(Seeds))]
        public void Updrafts_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var gen = new TerrainGenerator(seed);
            foreach (var entry in (JArray)fx["updrafts"])
            {
                var ix = (int)entry["ix"];
                var iz = (int)entry["iz"];
                var island = IslandField.IslandAtCell(seed, ix, iz);
                Assert.IsNotNull(island, $"updraft island({ix},{iz}) seed {seed}");
                var u = gen.UpdraftOf(island);
                Assert.AreEqual((double)entry["x"], u.X, 0, $"updraft.x ({ix},{iz}) seed {seed}");
                Assert.AreEqual((double)entry["z"], u.Z, 0, $"updraft.z ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["bottomY"], u.BottomY, $"updraft.bottomY ({ix},{iz}) seed {seed}");
                Assert.AreEqual((int)entry["topY"], u.TopY, $"updraft.topY ({ix},{iz}) seed {seed}");
                Assert.AreEqual((double)entry["radius"], u.Radius, 0, $"updraft.radius ({ix},{iz}) seed {seed}");
            }
        }

        [TestCaseSource(nameof(Seeds))]
        public void UpdraftsNear_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var gen = new TerrainGenerator(seed);
            var expected = ((JArray)fx["updraftsNear"])
                .Select(e => ((double)e["x"], (double)e["z"], (int)e["bottomY"], (int)e["topY"], (double)e["radius"], (int)e["ix"], (int)e["iz"]))
                .OrderBy(t => (t.Item6, t.Item7)).ToList();
            var actual = gen.UpdraftsNear(-160, -160, 159, 159)
                .Select(u => (u.X, u.Z, u.BottomY, u.TopY, u.Radius, u.Ix, u.Iz))
                .OrderBy(t => (t.Item6, t.Item7)).ToList();
            CollectionAssert.AreEqual(expected, actual, $"seed {seed}");
        }

        [TestCaseSource(nameof(Seeds))]
        public void IslandsNear_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var expected = ((JArray)fx["islandsNear"]).Select(e => ((int)e[0], (int)e[1])).OrderBy(t => (t.Item1, t.Item2)).ToList();
            var actual = IslandField.IslandsNear(seed, -100, -100, 100, 100)
                .Select(i => (i.Ix, i.Iz)).OrderBy(t => (t.Item1, t.Item2)).ToList();
            CollectionAssert.AreEqual(expected, actual, $"seed {seed}");
        }

        [TestCaseSource(nameof(Seeds))]
        public void Underground_caves_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var caves = new CaveModel(seed, GroundConst.PadRadius + GroundConst.PadBlend);
            foreach (var row in (JArray)((JObject)fx["underground"])["caves"])
            {
                var x = (int)row[0];
                var y = (int)row[1];
                var z = (int)row[2];
                var h = (int)row[3];
                var expected = (bool)row[4];
                Assert.AreEqual(expected, caves.Open(x, y, z, h), $"cave({x},{y},{z},{h}) seed {seed}");
            }
        }

        [TestCaseSource(nameof(Seeds))]
        public void Underground_veins_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var field = new VeinField(seed);
            foreach (var entry in (JArray)((JObject)fx["underground"])["veins"])
            {
                var gx = (long)entry["gx"];
                var gy = (long)entry["gy"];
                var gz = (long)entry["gz"];
                var expected = entry["vein"];
                var actual = field.InCell(gx, gy, gz);
                if (expected == null || expected.Type == JTokenType.Null)
                {
                    Assert.IsNull(actual, $"vein({gx},{gy},{gz}) seed {seed}");
                    continue;
                }
                Assert.IsNotNull(actual, $"vein({gx},{gy},{gz}) seed {seed}");
                Assert.AreEqual((int)expected["block"], actual.Ore.Block, $"vein.block ({gx},{gy},{gz}) seed {seed}");
                Assert.AreEqual((int)expected["x"], actual.X, $"vein.x ({gx},{gy},{gz}) seed {seed}");
                Assert.AreEqual((int)expected["y"], actual.Y, $"vein.y ({gx},{gy},{gz}) seed {seed}");
                Assert.AreEqual((int)expected["z"], actual.Z, $"vein.z ({gx},{gy},{gz}) seed {seed}");
                var expectedOffsets = expected["offsets"].Select(v => (sbyte)(int)v).ToArray();
                CollectionAssert.AreEqual(expectedOffsets, actual.Offsets, $"vein.offsets ({gx},{gy},{gz}) seed {seed}");
            }
        }

        [TestCaseSource(nameof(Seeds))]
        public void Chunks_match_fixture(long seed)
        {
            var fx = Load($"seed-{seed}.json");
            var gen = new TerrainGenerator(seed);
            foreach (var entry in (JArray)fx["chunks"])
            {
                var cx = (long)entry["cx"];
                var cy = (long)entry["cy"];
                var cz = (long)entry["cz"];
                var shaToken = entry["sha256"];
                var expectedSha = shaToken == null || shaToken.Type == JTokenType.Null ? null : (string)shaToken;
                var data = gen.GenerateChunk(cx, cy, cz);
                if (expectedSha == null)
                {
                    Assert.IsNull(data, $"chunk({cx},{cy},{cz}) seed {seed} expected empty");
                    continue;
                }
                Assert.IsNotNull(data, $"chunk({cx},{cy},{cz}) seed {seed} expected non-empty");
                Assert.AreEqual(expectedSha, Sha256Hex(data), $"chunk sha256 ({cx},{cy},{cz}) seed {seed}");

                var packed = entry["data"];
                if (packed != null && packed.Type != JTokenType.Null)
                {
                    var expectedBytes = Gunzip(Convert.FromBase64String((string)packed));
                    CollectionAssert.AreEqual(expectedBytes, data, $"chunk bytes ({cx},{cy},{cz}) seed {seed}");
                }
            }
        }
    }
}
