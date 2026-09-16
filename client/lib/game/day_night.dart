/// The 20-minute day/night clock — twin of `game/DayNight.ts`: 15 min day →
/// sunset → 5 min night → dawn. The first sunset is when zombies first appear.
library;

import 'dart:math' as math;

import 'package:block_survival/world/js_math.dart';

const double daySeconds = 900;
const double nightSeconds = 300;
const double cycleSeconds = daySeconds + nightSeconds;

enum Phase { day, night }

final class SkyState {
  const SkyState({
    required this.elevation,
    required this.day,
    required this.sunset,
    required this.night,
    required this.sunX,
    required this.sunY,
    required this.sunZ,
  });

  /// -1..1, sin of the sun's elevation (negative at night)
  final double elevation;

  /// 0..1 blend weights for the three palettes
  final double day;
  final double sunset;
  final double night;

  /// unit sun direction
  final double sunX;
  final double sunY;
  final double sunZ;
}

double _smoothstep(double a, double b, double x) {
  final t = ((x - a) / (b - a)).clamp(0.0, 1.0);
  return t * t * (3 - 2 * t);
}

final class DayNight {
  /// seconds since the game started
  double time = 0;
  Phase phase = Phase.day;

  /// set for one update after a phase change
  bool justChanged = false;

  void update(double dt) {
    time += dt;
    final next = phaseAt(time);
    justChanged = next != phase;
    phase = next;
  }

  /// number of sunsets so far: 0 during the first day, 1 on the first night, …
  int get night =>
      time < daySeconds ? 0 : ((time - daySeconds) / cycleSeconds).floor() + 1;

  Phase phaseAt(double t) =>
      t.remainder(cycleSeconds) < daySeconds ? Phase.day : Phase.night;

  /// seconds until the next sunset / dawn
  double get secondsToTransition {
    final inCycle = time.remainder(cycleSeconds);
    return inCycle < daySeconds ? daySeconds - inCycle : cycleSeconds - inCycle;
  }

  /// 0..1 progress through the current night (0 during the day)
  double get nightProgress {
    final inCycle = time.remainder(cycleSeconds);
    return inCycle < daySeconds ? 0 : (inCycle - daySeconds) / nightSeconds;
  }

  String get timerText {
    final s = math.max(0, secondsToTransition.ceil());
    return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
  }

  SkyState sky() {
    // the sun arcs 0..π over the day and π..2π over the (shorter) night
    final inCycle = time.remainder(cycleSeconds);
    final angle = inCycle < daySeconds
        ? (inCycle / daySeconds) * math.pi
        : math.pi + ((inCycle - daySeconds) / nightSeconds) * math.pi;
    final elevation = math.sin(angle);
    final day = _smoothstep(0.05, 0.3, elevation);
    final night = _smoothstep(-0.05, -0.3, elevation);
    final sunset = math.max(0.0, 1 - day - night);
    // the sun rises in +X and sets in -X, arcing over +Z
    final sunX = math.cos(angle);
    final sunY = elevation;
    const sunZ = 0.35;
    final len = hypot3(sunX, sunY, sunZ);
    return SkyState(
      elevation: elevation,
      day: day,
      sunset: sunset,
      night: night,
      sunX: sunX / len,
      sunY: sunY / len,
      sunZ: sunZ / len,
    );
  }
}
