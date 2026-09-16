// The admin's clock and zombie schedule reach the clock, the night schedule
// and the wire (twin of game/__tests__/rules.test.ts).
import 'package:block_survival/entities/zombies.dart';
import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/rules.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('fromJson fills gaps with the defaults and clamps nonsense', () {
    expect(GameRules.fromJson(null), GameRules.defaults);
    final r = GameRules.fromJson({
      'daySeconds': 120,
      'nightSeconds': 60,
      'spawnWindowPercent': 50,
    });
    expect(r.daySeconds, 120);
    expect(r.nightSeconds, 60);
    expect(r.spawnWindow, 0.5);
    expect(r.zombiesFirstNight, 8);
    final wild = GameRules.fromJson({
      'daySeconds': 1,
      'nightSeconds': 1e9,
      'zombiesPerNight': -5,
      'spawnDelaySeconds': 'soon',
    });
    expect(wild.daySeconds, 30);
    expect(wild.nightSeconds, 7200);
    expect(wild.zombiesPerNight, 0);
    expect(wild.spawnDelaySeconds, 2);
    expect(GameRules.fromJson(GameRules.defaults.toJson()), GameRules.defaults);
  });

  test('the clock follows the admin lengths', () {
    final d = DayNight(const GameRules(daySeconds: 120, nightSeconds: 60));
    expect(d.timerText, '2:00');
    d.update(121);
    expect(d.phase, Phase.night);
    expect(d.night, 1);
    expect(d.timerText, '0:59');
    d.update(60);
    expect(d.phase, Phase.day);
    d.update(180);
    expect(d.night, 2);
    expect(d.phaseAt(180 + 120 + 30), Phase.night);
  });

  test('the zombie count follows the admin schedule', () {
    expect(zombiesForNight(1, firstNight: 3, perNight: 2), 3);
    expect(zombiesForNight(4, firstNight: 3, perNight: 2), 9);
    expect(zombiesForNight(4, firstNight: 0, perNight: 0), 0);
    expect(zombiesForNight(2), 14); // the defaults
  });

  test('a welcome carries the rules and decodes without them', () {
    const rules = GameRules(daySeconds: 200, nightSeconds: 100);
    final withRules = decodeHost(
      encodeHost(
        const Welcome(
          v: protocolVersion,
          you: 'p1',
          seed: 3,
          time: 0,
          edits: [],
          spawn: Vec3(0.5, 1, 0.5),
          rules: rules,
        ),
      ),
    );
    expect((withRules as Welcome).rules, rules);
    final without = decodeHost(
      encodeHost(
        const Welcome(
          v: protocolVersion,
          you: 'p1',
          seed: 3,
          time: 0,
          edits: [],
          spawn: Vec3(0.5, 1, 0.5),
        ),
      ),
    );
    expect((without as Welcome).rules, isNull);
  });
}
