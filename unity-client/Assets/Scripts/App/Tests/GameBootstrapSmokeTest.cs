using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace BlockSurvival.App.Tests
{
    /// Not a fixture test — just confirms the minimal playable slice actually
    /// runs (world load, meshing, player/camera setup, one input tick) without
    /// throwing, before asking anyone to press Play and trust it visually.
    public class GameBootstrapSmokeTest
    {
        [UnityTest]
        public IEnumerator GameBootstrap_runs_one_frame_without_errors()
        {
            var go = new GameObject("TestGame");
            go.AddComponent<GameBootstrap>();

            yield return null; // Start()
            yield return null; // Update()

            var camera = go.GetComponentInChildren<Camera>();
            Assert.IsNotNull(camera, "GameBootstrap should have created a player camera");

            var chunks = go.transform.Find("Chunks");
            Assert.IsNotNull(chunks, "GameBootstrap should have created a Chunks root");
            Assert.Greater(chunks.childCount, 0, "at least one chunk should have produced a mesh for seed 11 near spawn");

            Object.Destroy(go);
            yield return null;
        }
    }
}
