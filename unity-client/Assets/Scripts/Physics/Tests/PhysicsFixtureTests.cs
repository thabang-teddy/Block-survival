using System.Collections.Generic;
using System.IO;
using System.Linq;
using BlockSurvival.World;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace BlockSurvival.Physics.Tests
{
    /// Verifies the C# physics/raycast port reproduces
    /// <c>shared/fixtures/physics/{aabb,raycast,walk}.json</c> tick for tick and
    /// case for case, the same contract <c>client/test/physics/</c> enforces on
    /// the Dart port (see <c>docs/flutter-client-plan.md</c> §2 S2 / physics
    /// fixtures). A mismatch here means a player would see a different world
    /// shape than their peers, or walk through a wall one of them sees as solid.
    public class PhysicsFixtureTests
    {
        private const int Seed = 11;
        private const double Dt = 1.0 / 60;

        private static string FixturesDir
        {
            get
            {
                var projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
                return Path.Combine(projectRoot, "shared", "fixtures", "physics");
            }
        }

        private static JObject Load(string name) => JObject.Parse(File.ReadAllText(Path.Combine(FixturesDir, name)));

        private static (WorldStore World, TerrainGenerator Terrain) StreamedWorld(int radius)
        {
            var terrain = new TerrainGenerator(Seed);
            var world = new WorldStore();
            world.SetGenerator((cx, cy, cz) => terrain.GenerateChunk(cx, cy, cz), TerrainConst.WorldChunksY);
            for (var cx = -radius; cx <= radius; cx++)
            {
                for (var cz = -radius; cz <= radius; cz++)
                {
                    world.LoadColumn(cx, cz);
                }
            }
            return (world, terrain);
        }

        // ------------------------------------------------------------- aabb.json

        [Test]
        public void MoveBox_matches_aabb_fixture()
        {
            var fx = Load("aabb.json");
            var world = new WorldStore();
            foreach (var row in (JArray)fx["blocks"])
            {
                world.SetBlock((int)row[0], (int)row[1], (int)row[2], (byte)(int)row[3]);
            }
            var i = 0;
            foreach (var c in (JArray)fx["cases"])
            {
                var boxArr = (JArray)c["box"];
                var box = new Box((double)boxArr[0], (double)boxArr[1], (double)boxArr[2], (double)boxArr[3], (double)boxArr[4], (double)boxArr[5]);
                var move = (JArray)c["move"];
                var result = Aabb.MoveBox(world, box, (double)move[0], (double)move[1], (double)move[2]);
                var expected = (JArray)c["result"];
                Assert.AreEqual((double)expected[0], result.Box.X, 0, $"case {i} box.x");
                Assert.AreEqual((double)expected[1], result.Box.Y, 0, $"case {i} box.y");
                Assert.AreEqual((double)expected[2], result.Box.Z, 0, $"case {i} box.z");
                Assert.AreEqual((int)expected[3] != 0, result.HitX, $"case {i} hitX");
                Assert.AreEqual((int)expected[4] != 0, result.HitY, $"case {i} hitY");
                Assert.AreEqual((int)expected[5] != 0, result.HitZ, $"case {i} hitZ");
                i++;
            }
        }

        // ------------------------------------------------------------- raycast.json

        [Test]
        public void RaycastVoxels_matches_raycast_fixture()
        {
            var fx = Load("raycast.json");
            var radius = (int)fx["radius"];
            var (world, _) = StreamedWorld(radius);
            var i = 0;
            foreach (var r in (JArray)fx["rays"])
            {
                var origin = (JArray)r["origin"];
                var dir = (JArray)r["dir"];
                var maxDist = (double)r["maxDist"];
                var ignoreWater = (bool)r["ignoreWater"];
                var hit = Raycast.RaycastVoxels(
                    world,
                    (double)origin[0], (double)origin[1], (double)origin[2],
                    (double)dir[0], (double)dir[1], (double)dir[2],
                    maxDist, ignoreWater);
                var expected = r["hit"];
                if (expected == null || expected.Type == JTokenType.Null)
                {
                    Assert.IsNull(hit, $"ray {i} expected no hit");
                }
                else
                {
                    Assert.IsNotNull(hit, $"ray {i} expected a hit");
                    var e = (JArray)expected;
                    Assert.AreEqual((int)e[0], hit.X, $"ray {i} x");
                    Assert.AreEqual((int)e[1], hit.Y, $"ray {i} y");
                    Assert.AreEqual((int)e[2], hit.Z, $"ray {i} z");
                    Assert.AreEqual((int)e[3], hit.Nx, $"ray {i} nx");
                    Assert.AreEqual((int)e[4], hit.Ny, $"ray {i} ny");
                    Assert.AreEqual((int)e[5], hit.Nz, $"ray {i} nz");
                    Assert.AreEqual((double)e[6], hit.Distance, 0, $"ray {i} distance");
                    Assert.AreEqual((int)e[7], hit.Block, $"ray {i} block");
                }
                i++;
            }
        }

        // ------------------------------------------------------------- walk.json

        [Test]
        public void PlayerController_matches_walk_fixture_tick_for_tick()
        {
            var fx = Load("walk.json");
            var radius = (int)fx["radius"];
            var dt = (double)fx["dt"];
            Assert.AreEqual(Dt, dt, 1e-12, "fixture dt");
            var (world, terrain) = StreamedWorld(radius);
            var spawn = terrain.GetSpawn();
            var spawnObj = (JObject)fx["spawn"];
            Assert.AreEqual((double)spawnObj["x"], spawn.X, 0, "spawn.x");
            Assert.AreEqual((double)spawnObj["y"], spawn.Y, 0, "spawn.y");
            Assert.AreEqual((double)spawnObj["z"], spawn.Z, 0, "spawn.z");

            var player = new PlayerController(world, spawn.X, spawn.Y, spawn.Z);
            player.Updrafts = (x, z) => terrain.UpdraftsNear(x - 3, z - 3, x + 3, z + 3);

            var ticks = (JArray)fx["ticks"];
            var tickIndex = 0;
            foreach (var tick in ticks)
            {
                var keys = ((JArray)tick["keys"]).Select(k => (string)k).ToList();
                var teleport = tick["teleport"];
                if (teleport != null && teleport.Type != JTokenType.Null)
                {
                    player.Teleport((double)teleport["x"], (double)teleport["y"], (double)teleport["z"]);
                }
                var look = tick["look"];
                if (look != null && look.Type != JTokenType.Null)
                {
                    var l = (JArray)look;
                    player.Look((double)l[0], (double)l[1]);
                }
                if ((bool)tick["jump"]) player.QueueJump();
                var frozen = (bool)tick["frozen"];
                player.Update(dt, new KeySetInput(keys), frozen);

                var expected = (JArray)tick["state"];
                var s = player.State;
                var actual = new double[]
                {
                    s.X, s.Y, s.Z, s.Vx, s.Vy, s.Vz, s.Yaw, s.Pitch,
                    s.OnGround ? 1 : 0, s.Stamina, s.Sprinting ? 1 : 0, s.SinceSprint, s.InUpdraft ? 1 : 0,
                };
                for (var f = 0; f < actual.Length; f++)
                {
                    Assert.AreEqual((double)expected[f], actual[f], 0, $"tick {tickIndex} field {f}");
                }
                tickIndex++;
            }
        }
    }
}
