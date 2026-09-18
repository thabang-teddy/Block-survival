/// Sun, hemisphere light, sky colour and fog — twin of `render/Lighting.tsx`.
/// Palettes are the concept art's (daylight, orange sunset, deep blue night);
/// [Lighting.at] blends them by the day/night phase.
library;

import 'package:block_survival/world/chunk.dart';
import 'package:vector_math/vector_math_64.dart';

/// chunk columns streamed around the player (chunkStreamer.ts LOAD_RADIUS)
const int loadRadius = 6;

/// the fog closes just inside the streamed radius so the world's edge is never seen
const double fogFar = (loadRadius + 0.5) * chunkSize;
const double fogNear = fogFar * 0.55;

Vector3 _hex(int rgb) => Vector3(
  ((rgb >> 16) & 0xff) / 255,
  ((rgb >> 8) & 0xff) / 255,
  (rgb & 0xff) / 255,
);

final class Palette {
  Palette({
    required this.sky,
    required this.hemiSky,
    required this.hemiGround,
    required this.hemi,
    required this.sun,
    required this.sunIntensity,
  });

  final Vector3 sky;
  final Vector3 hemiSky;
  final Vector3 hemiGround;
  final double hemi;
  final Vector3 sun;
  final double sunIntensity;

  Palette mix(Palette other, double t) => Palette(
    sky: _lerp(sky, other.sky, t),
    hemiSky: _lerp(hemiSky, other.hemiSky, t),
    hemiGround: _lerp(hemiGround, other.hemiGround, t),
    hemi: hemi + (other.hemi - hemi) * t,
    sun: _lerp(sun, other.sun, t),
    sunIntensity: sunIntensity + (other.sunIntensity - sunIntensity) * t,
  );

  static Vector3 _lerp(Vector3 a, Vector3 b, double t) => a + (b - a) * t;
}

final Palette day = Palette(
  sky: _hex(0x87b4d8),
  hemiSky: _hex(0xdfefff),
  hemiGround: _hex(0x6a5a3a),
  hemi: 1.0,
  sun: _hex(0xfff2d0),
  sunIntensity: 2.4,
);

final Palette sunset = Palette(
  sky: _hex(0xd9773f),
  hemiSky: _hex(0xf0b080),
  hemiGround: _hex(0x3a2a3a),
  hemi: 0.55,
  sun: _hex(0xffa060),
  sunIntensity: 1.3,
);

final Palette night = Palette(
  sky: _hex(0x16223f),
  hemiSky: _hex(0x4a60b0),
  hemiGround: _hex(0x1a1a28),
  hemi: 0.32,
  sun: _hex(0xa0b0e0),
  sunIntensity: 0.24,
);

/// what the chunk shader needs for one frame
final class Lighting {
  Lighting({required this.palette, required this.sunDirection});

  final Palette palette;

  /// unit vector towards the sun
  final Vector3 sunDirection;

  /// noon sun, as the browser client places its directional light
  static Lighting noon() =>
      Lighting(palette: day, sunDirection: Vector3(60, 80, 30).normalized());

  /// `phase` 0 = noon, 0.25 = sunset, 0.5 = midnight, 0.75 = dawn
  static Lighting at(double phase) {
    final p = phase % 1.0;
    final Palette palette;
    if (p < 0.25) {
      palette = day.mix(sunset, p / 0.25);
    } else if (p < 0.5) {
      palette = sunset.mix(night, (p - 0.25) / 0.25);
    } else if (p < 0.75) {
      palette = night.mix(sunset, (p - 0.5) / 0.25);
    } else {
      palette = sunset.mix(day, (p - 0.75) / 0.25);
    }
    return Lighting(
      palette: palette,
      sunDirection: Vector3(60, 80, 30).normalized(),
    );
  }
}
