/// The admin-tunable game clock — twin of `game/rules.ts` and
/// `App\Support\GameRules`: day and night lengths and the zombie schedule.
/// Loaded from `GET /api/rules` before a match; a joiner takes the host's
/// from the welcome so one match runs on one set of rules.
library;

final class GameRules {
  const GameRules({
    this.daySeconds = 900,
    this.nightSeconds = 300,
    this.zombiesFirstNight = 8,
    this.zombiesPerNight = 6,
    this.spawnDelaySeconds = 2,
    this.spawnWindow = 0.7,
  });

  /// what the server sends (percent instead of a fraction); anything missing
  /// or absurd becomes the default
  factory GameRules.fromJson(Map<String, dynamic>? j) {
    const d = GameRules();
    double pick(String key, double fallback, double min, double max) {
      final v = j?[key];
      if (v is! num) return fallback;
      return v.toDouble().clamp(min, max);
    }

    return GameRules(
      daySeconds: pick('daySeconds', d.daySeconds, 30, 7200),
      nightSeconds: pick('nightSeconds', d.nightSeconds, 30, 7200),
      zombiesFirstNight: pick('zombiesFirstNight', 8, 0, 200).round(),
      zombiesPerNight: pick('zombiesPerNight', 6, 0, 100).round(),
      spawnDelaySeconds: pick('spawnDelaySeconds', d.spawnDelaySeconds, 0, 600),
      spawnWindow:
          pick('spawnWindowPercent', d.spawnWindow * 100, 5, 100) / 100,
    );
  }

  static const GameRules defaults = GameRules();

  final double daySeconds;
  final double nightSeconds;

  /// zombies on night 1
  final int zombiesFirstNight;

  /// added every night after the first
  final int zombiesPerNight;

  /// seconds after sunset before the first group appears
  final double spawnDelaySeconds;

  /// the groups are spread over this share of the night, 0..1
  final double spawnWindow;

  double get cycleSeconds => daySeconds + nightSeconds;

  Map<String, Object?> toJson() => {
    'daySeconds': daySeconds,
    'nightSeconds': nightSeconds,
    'zombiesFirstNight': zombiesFirstNight,
    'zombiesPerNight': zombiesPerNight,
    'spawnDelaySeconds': spawnDelaySeconds,
    'spawnWindowPercent': (spawnWindow * 100).round(),
  };

  @override
  bool operator ==(Object other) =>
      other is GameRules &&
      other.daySeconds == daySeconds &&
      other.nightSeconds == nightSeconds &&
      other.zombiesFirstNight == zombiesFirstNight &&
      other.zombiesPerNight == zombiesPerNight &&
      other.spawnDelaySeconds == spawnDelaySeconds &&
      other.spawnWindow == spawnWindow;

  @override
  int get hashCode => Object.hash(
    daySeconds,
    nightSeconds,
    zombiesFirstNight,
    zombiesPerNight,
    spawnDelaySeconds,
    spawnWindow,
  );
}
