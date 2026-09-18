import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/score.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('phases, nights and the timer follow the 15 + 5 minute cycle', () {
    final c = DayNight();
    expect(c.phase, Phase.day);
    expect(c.night, 0);
    expect(c.timerText, '15:00');
    c.update(daySeconds - 1);
    expect(c.phase, Phase.day);
    expect(c.timerText, '0:01');
    c.update(1);
    expect(c.phase, Phase.night);
    expect(c.justChanged, isTrue);
    expect(c.night, 1);
    expect(c.timerText, '5:00');
    c.update(nightSeconds);
    expect(c.phase, Phase.day);
    expect(c.night, 1);
    expect(c.nightProgress, 0);
    c.update(daySeconds + 150);
    expect(c.night, 2);
    expect(c.nightProgress, closeTo(0.5, 1e-9));
  });

  test('the sky arcs from dawn to noon to sunset to midnight', () {
    final c = DayNight();
    expect(c.sky().elevation, closeTo(0, 1e-9));
    c.time = daySeconds / 2;
    expect(c.sky().day, 1);
    expect(c.sky().sunY, greaterThan(0.9));
    c.time = daySeconds + nightSeconds / 2;
    expect(c.sky().night, 1);
    expect(c.sky().elevation, closeTo(-1, 1e-9));
  });

  test('score and time helpers match the web', () {
    expect(computeScore(3, 7), 335);
    expect(nightsSurvived(2, Phase.night), 1);
    expect(nightsSurvived(2, Phase.day), 2);
    expect(formatTime(187), '3:07');
    expect(formatTime(4321), '1h 12m');
    final now = DateTime.parse('2026-09-16T12:00:00Z');
    expect(timeAgo('2026-09-16T11:59:30Z', now), 'just now');
    expect(timeAgo('2026-09-16T11:30:00Z', now), '30 min ago');
    expect(timeAgo('2026-09-15T12:00:00Z', now), '24 h ago');
    expect(timeAgo('2026-09-10T12:00:00Z', now), '6 d ago');
    expect(timeAgo('nope', now), 'a while ago');
  });
}
