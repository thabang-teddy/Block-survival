/// Score rules and the lobby's time formatting — twin of `game/score.ts`.
library;

import 'package:block_survival/game/day_night.dart';

const int scorePerNight = 100;
const int scorePerKill = 5;

int computeScore(int nightsSurvived, int kills) =>
    nightsSurvived * scorePerNight + kills * scorePerKill;

/// a night counts once dawn has broken
int nightsSurvived(int night, Phase phase) =>
    phase == Phase.day ? night : night - 1;

/// "3:07", or "1h 12m" past an hour
String formatTime(num seconds) {
  final s = seconds.floor().clamp(0, 1 << 40);
  final m = s ~/ 60;
  return m >= 60
      ? '${m ~/ 60}h ${m % 60}m'
      : '$m:${(s % 60).toString().padLeft(2, '0')}';
}

/// "just now", "3 min ago", "2 h ago", "4 d ago" for an ISO timestamp
String timeAgo(String iso, [DateTime? now]) {
  final t = DateTime.tryParse(iso);
  if (t == null) return 'a while ago';
  final s = (now ?? DateTime.now()).difference(t).inSeconds.clamp(0, 1 << 40);
  if (s < 60) return 'just now';
  final m = s ~/ 60;
  if (m < 60) return '$m min ago';
  final h = m ~/ 60;
  if (h < 48) return '$h h ago';
  return '${h ~/ 24} d ago';
}
