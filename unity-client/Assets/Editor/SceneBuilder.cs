using System.IO;
using BlockSurvival.App;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace BlockSurvival.EditorTools
{
    /// One-off scaffolding: creates `Assets/Scenes/Main.unity` with a single
    /// `GameBootstrap` object and registers it as the project's start scene.
    /// Run once via `-executeMethod BlockSurvival.EditorTools.SceneBuilder.BuildMainScene`;
    /// safe to re-run (overwrites the same scene).
    public static class SceneBuilder
    {
        private const string ScenePath = "Assets/Scenes/Main.unity";

        [MenuItem("Block Survival/Build Main Scene")]
        public static void BuildMainScene()
        {
            if (!Directory.Exists("Assets/Scenes")) Directory.CreateDirectory("Assets/Scenes");

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var gameObject = new GameObject("Game");
            gameObject.AddComponent<GameBootstrap>();

            EditorSceneManager.SaveScene(scene, ScenePath);

            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            AssetDatabase.SaveAssets();
            Debug.Log($"Built {ScenePath}");
        }
    }
}
