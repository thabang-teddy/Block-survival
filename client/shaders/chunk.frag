// Vertex colour (with baked AO) lit by a hemisphere term plus one directional sun,
// then fogged towards the sky colour — the same ingredients as Lighting.tsx in the
// browser client (three.js MeshStandardMaterial with flat shading).
uniform LightInfo {
  vec4 sun_dir;      // xyz: unit vector towards the sun
  vec4 sun_color;    // rgb premultiplied by intensity
  vec4 hemi_sky;     // rgb premultiplied by hemisphere intensity
  vec4 hemi_ground;
  vec4 fog_color;    // rgb: sky colour
  vec4 fog_range;    // x: near, y: far
} light_info;

in vec4 v_color;
in vec3 v_normal;
in float v_depth;

out vec4 frag_color;

void main() {
  vec3 n = normalize(v_normal);
  float ndl = max(dot(n, light_info.sun_dir.xyz), 0.0);
  float up = n.y * 0.5 + 0.5;
  vec3 hemi = mix(light_info.hemi_ground.rgb, light_info.hemi_sky.rgb, up);
  // Lambert BRDF: radiance = albedo * irradiance / pi (three.js physical lights)
  vec3 lit = v_color.rgb * (hemi + light_info.sun_color.rgb * ndl) / 3.14159265;
  float f = clamp(
      (v_depth - light_info.fog_range.x) / (light_info.fog_range.y - light_info.fog_range.x),
      0.0, 1.0);
  vec3 rgb = mix(lit, light_info.fog_color.rgb, f);
  // linear -> sRGB, as three.js does on output
  frag_color = vec4(pow(rgb, vec3(1.0 / 2.2)), v_color.a);
}
