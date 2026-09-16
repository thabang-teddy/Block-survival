// Chunk vertices: interleaved position / normal / colour straight from the mesher.
// Lighting is per-fragment so the sun and hemisphere terms can change every frame
// with the day/night clock without re-meshing.
uniform FrameInfo {
  mat4 mvp;
} frame_info;

in vec3 position;
in vec3 normal;
in vec4 color;

out vec4 v_color;
out vec3 v_normal;
out float v_depth;

void main() {
  gl_Position = frame_info.mvp * vec4(position, 1.0);
  v_color = color;
  v_normal = normal;
  // clip-space w is the view-space distance along the camera axis: the fog input
  v_depth = gl_Position.w;
}
