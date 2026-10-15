using BlockSurvival.World;
using UnityEngine;

namespace BlockSurvival.App
{
    /// Converts a pure-C# <see cref="MeshData"/> (position/normal/colour floats,
    /// no Unity types — see <c>BlockSurvival.World/Mesher.cs</c>) into an actual
    /// Unity <see cref="Mesh"/>.
    public static class ChunkMeshBuilder
    {
        public static Mesh Build(MeshData data, string name)
        {
            var vertexCount = data.VertexCount;
            var positions = new Vector3[vertexCount];
            var normals = new Vector3[vertexCount];
            var colors = new Color[vertexCount];
            var v = data.Vertices;
            for (var i = 0; i < vertexCount; i++)
            {
                var o = i * MeshData.VertexFloats;
                positions[i] = new Vector3(v[o], v[o + 1], v[o + 2]);
                normals[i] = new Vector3(v[o + 3], v[o + 4], v[o + 5]);
                colors[i] = new Color(v[o + 6], v[o + 7], v[o + 8], v[o + 9]);
            }
            var mesh = new Mesh { name = name, indexFormat = vertexCount > 65000 ? UnityEngine.Rendering.IndexFormat.UInt32 : UnityEngine.Rendering.IndexFormat.UInt16 };
            mesh.SetVertices(positions);
            mesh.SetNormals(normals);
            mesh.SetColors(colors);
            mesh.SetTriangles(data.Indices, 0);
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
