/// First-person camera: position + yaw/pitch, producing the view-projection
/// matrix the chunk shader wants. Conventions match the browser client
/// (three.js): right-handed, y up, yaw 0 looks down -z.
library;

import 'dart:math' as math;

import 'package:vector_math/vector_math_64.dart';

final class Camera {
  Camera({
    Vector3? position,
    this.yaw = 0,
    this.pitch = 0,
    this.fovYDegrees = 70,
    this.near = 0.1,
    this.far = 400,
  }) : position = position ?? Vector3.zero();

  Vector3 position;

  /// radians; positive turns left (counter-clockwise seen from above)
  double yaw;

  /// radians; positive looks up, clamped just short of straight up/down
  double pitch;
  double fovYDegrees;
  double near;
  double far;

  static const double maxPitch = math.pi / 2 - 0.01;

  Vector3 get forward => Vector3(
    -math.sin(yaw) * math.cos(pitch),
    math.sin(pitch),
    -math.cos(yaw) * math.cos(pitch),
  );

  /// horizontal forward, for walking
  Vector3 get flatForward => Vector3(-math.sin(yaw), 0, -math.cos(yaw));

  Vector3 get right => Vector3(math.cos(yaw), 0, -math.sin(yaw));

  void look(double dyaw, double dpitch) {
    yaw = (yaw + dyaw) % (2 * math.pi);
    pitch = (pitch + dpitch).clamp(-maxPitch, maxPitch);
  }

  Matrix4 view() =>
      makeViewMatrix(position, position + forward, Vector3(0, 1, 0));

  /// perspective with depth in [0, 1] as Impeller expects (vector_math's
  /// helper produces OpenGL's [-1, 1])
  Matrix4 projection(double aspect) {
    final gl = makePerspectiveMatrix(
      fovYDegrees * math.pi / 180,
      aspect,
      near,
      far,
    );
    final remap = Matrix4.identity()
      ..setEntry(2, 2, 0.5)
      ..setEntry(2, 3, 0.5);
    return remap * gl;
  }

  Matrix4 viewProjection(double aspect) => projection(aspect) * view();
}
