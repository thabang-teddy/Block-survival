using BlockSurvival.Physics;
using BlockSurvival.World;
using UnityEngine;

namespace BlockSurvival.App
{
    /// Minimal playable vertical slice: loads a radius of columns around the
    /// spawn pad from the real world generator, meshes them with
    /// <see cref="Mesher"/>, and drives a first-person <see cref="PlayerController"/>
    /// from Unity's input and render loop. Not the real game yet — there is no
    /// chunk streaming (the whole radius loads once at Start), no inventory,
    /// no HUD, no multiplayer. It exists so the port in `BlockSurvival.World`/
    /// `BlockSurvival.Physics` is something you can actually walk around in,
    /// not just a pass/fail on a fixture test.
    public sealed class GameBootstrap : MonoBehaviour
    {
        [SerializeField] private int seed = 11;
        [SerializeField] private int columnRadius = 3;
        [SerializeField] private float mouseSensitivity = 1f;

        private WorldStore _world;
        private TerrainGenerator _terrain;
        private PlayerController _player;
        private readonly UnityPlayerInput _input = new UnityPlayerInput();
        private Camera _camera;
        private bool _cursorLocked;

        private void Start()
        {
            BuildWorld();
            SpawnChunkMeshes();
            SpawnPlayer();
            LockCursor(true);
        }

        private void BuildWorld()
        {
            _terrain = new TerrainGenerator(seed);
            _world = new WorldStore();
            _world.SetGenerator((cx, cy, cz) => _terrain.GenerateChunk(cx, cy, cz), TerrainConst.WorldChunksY);
            for (var cx = -columnRadius; cx <= columnRadius; cx++)
            {
                for (var cz = -columnRadius; cz <= columnRadius; cz++)
                {
                    _world.LoadColumn(cx, cz);
                }
            }
        }

        private void SpawnChunkMeshes()
        {
            var opaqueMat = new Material(Shader.Find("BlockSurvival/VertexColorOpaque"));
            var transparentMat = new Material(Shader.Find("BlockSurvival/VertexColorTransparent"));
            var root = new GameObject("Chunks").transform;
            root.SetParent(transform, false);

            foreach (var (cx, cy, cz) in _world.ChunkKeys)
            {
                var result = Mesher.MeshChunk(_world, cx, cy, cz);
                if (result.IsEmpty) continue;
                if (result.Opaque != null) SpawnChunkObject(root, $"chunk_{cx}_{cy}_{cz}_opaque", result.Opaque, opaqueMat);
                if (result.Translucent != null) SpawnChunkObject(root, $"chunk_{cx}_{cy}_{cz}_glass", result.Translucent, transparentMat);
            }
        }

        private static void SpawnChunkObject(Transform parent, string name, MeshData data, Material material)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = ChunkMeshBuilder.Build(data, name);
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
        }

        private void SpawnPlayer()
        {
            var spawn = _terrain.GetSpawn();
            _player = new PlayerController(_world, spawn.X, spawn.Y, spawn.Z)
            {
                Updrafts = (x, z) => _terrain.UpdraftsNear(x - 3, z - 3, x + 3, z + 3),
            };

            var cameraGo = new GameObject("PlayerCamera");
            cameraGo.transform.SetParent(transform, false);
            _camera = cameraGo.AddComponent<Camera>();
            _camera.nearClipPlane = 0.05f;
            _camera.farClipPlane = 1000f;
            _camera.clearFlags = CameraClearFlags.SolidColor;
            _camera.backgroundColor = new Color(0.55f, 0.75f, 0.95f);
            cameraGo.AddComponent<AudioListener>();
        }

        private void LockCursor(bool locked)
        {
            _cursorLocked = locked;
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }

        private void Update()
        {
            if (_player == null) return;

            if (Input.GetKeyDown(KeyCode.Escape)) LockCursor(false);
            if (!_cursorLocked && Input.GetMouseButtonDown(0)) LockCursor(true);

            if (_cursorLocked)
            {
                // Unity's Mouse Y axis is positive moving up; the controller expects a
                // browser-style delta where pitch increases (looks up) as dy decreases.
                // Flip here rather than in the ported PlayerController so that file stays
                // a faithful twin of playerController.ts. If look feels inverted, flip this sign.
                var dx = Input.GetAxis("Mouse X") * mouseSensitivity * 150f;
                var dy = -Input.GetAxis("Mouse Y") * mouseSensitivity * 150f;
                if (dx != 0 || dy != 0) _player.Look(dx, dy);
            }

            if (Input.GetKeyDown(KeyCode.Space)) _player.QueueJump();

            var dt = Mathf.Min(Time.deltaTime, 1f / 20f);
            _player.Update(dt, _input);

            var s = _player.State;
            var yawDeg = (float)(s.Yaw * Mathf.Rad2Deg) + 180f;
            var pitchDeg = (float)(-s.Pitch * Mathf.Rad2Deg);
            _camera.transform.SetPositionAndRotation(
                new Vector3((float)s.X, (float)(s.Y + PlayerTuning.EyeHeight), (float)s.Z),
                Quaternion.Euler(pitchDeg, yawDeg, 0f));
        }
    }
}
