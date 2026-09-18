// The game loop end to end on a real world: the host's night comes, zombies
// arrive and attack, the sword and rifle work through FrameInput, death and
// respawn reach the HUD state, and the save carries the entities.
import 'package:block_survival/entities/zombies.dart';
import 'package:block_survival/game/day_night.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/host_sim.dart';
import 'package:block_survival/game/save.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter_test/flutter_test.dart';

Game solo({SaveData? restore}) => Game(
  seed: 7,
  local: const LocalPlayer(name: 'Teddy', userId: 1),
  role: Role.host,
  worldKind: WorldKind.own,
  restore: restore,
);

void frames(Game g, int n, [FrameInput input = const FrameInput()]) {
  for (var i = 0; i < n; i++) {
    g.update(1 / 60, input);
  }
}

void main() {
  test('sunset brings zombies that hunt the player; dawn burns them', () {
    final g = solo();
    g.dayNight.time = daySeconds - 0.1;
    frames(g, 6 * 60);
    expect(g.ui.phase, Phase.night);
    expect(g.ui.night, 1);
    expect(g.ui.zombies, greaterThan(0));
    expect(g.ui.message, isNot('Night 1 — they are coming')); // toast expired
    // they were placed on the ground around the player, out of sight
    for (final z in g.sim.zombies.zombies) {
      expect(z.y, greaterThan(0));
    }
    g.dayNight.time = daySeconds + nightSeconds - 0.1;
    frames(g, 12);
    expect(g.ui.phase, Phase.day);
    expect(g.ui.zombies, 0);
    expect(g.ui.nightsSurvived, 1);
    expect(g.ui.score, 100);
    expect(g.needsSave, isTrue);
  });

  test('a sword swing from the frame input kills the zombie in front', () {
    final g = solo();
    g.inventory.add('sword', 1);
    final s = g.player.state;
    // face -z (yaw 0) with a zombie two blocks ahead at the same height
    s.yaw = 0;
    s.pitch = 0;
    frames(g, 1);
    final z = g.sim.zombies.spawn(ZombieKind.basic, s.x, s.y, s.z - 2);
    frames(g, 1, const FrameInput(dig: true));
    expect(z.hp, lessThan(30));
    frames(g, 1, const FrameInput(dig: true));
    expect(z.state, ZombieState.dead);
    expect(g.ui.kills, 1);
    expect(g.me.anim, 'Swing');
  });

  test(
    'the rifle reloads on R, shows ammo, and holding fire keeps shooting',
    () {
      final g = solo();
      g.inventory.add('rifle', 1);
      g.inventory.add('ammo', 64);
      frames(g, 1);
      expect(g.ui.ammo, isNotNull);
      expect(g.ui.ammo!.mag, 0);
      expect(g.ui.ammo!.reserve, 64);
      frames(g, 1, const FrameInput(reload: true));
      expect(g.ui.reloading, isTrue);
      expect(g.ui.ammo!.reserve, 34);
      frames(g, (RifleTuning.reloadSeconds * 60).round() + 2);
      expect(g.ui.reloading, isFalse);
      expect(g.ui.ammo!.mag, rifleMag);
      frames(g, 60, const FrameInput(primaryHeld: true));
      // ~8 shots a second
      expect(g.ui.ammo!.mag, inInclusiveRange(rifleMag - 9, rifleMag - 7));
    },
  );

  test(
    'taking lethal damage shows the death screen, then respawns at the spawn',
    () {
      final g = solo();
      g.inventory.add('planks', 5);
      g.player.teleport(g.spawn.x + 6, g.spawn.y + 1, g.spawn.z);
      frames(g, 5);
      g.sim.hurt(g.me, 500, poison: false);
      frames(g, 1);
      expect(g.ui.dead, isTrue);
      expect(g.ui.respawnIn, 5);
      expect(g.ui.cameraMode, CameraMode.third);
      expect(g.sim.crates.crates, hasLength(1));
      expect(g.inventory.count('planks'), 0);
      frames(g, (respawnSeconds * 60).round() + 2);
      expect(g.ui.dead, isFalse);
      expect(g.ui.cameraMode, CameraMode.first);
      expect(g.ui.health, 100);
      expect(g.player.state.x, g.spawn.x);
      expect(g.ui.message, 'Your loot crate is where you fell');
    },
  );

  test('the save carries live zombies, drops and crates, and a restore brings them back', () {
    final g = solo();
    g.dayNight.time = daySeconds + 10;
    g.dayNight.phase = Phase.night;
    final s = g.player.state;
    g.sim.zombies.spawn(ZombieKind.worker, s.x + 5, s.y, s.z).hp = 12;
    g.sim.drops.spawn('dirt', 2, s.x + 3, s.y, s.z);
    g.inventory.add('cobble', 4);
    g.sim.die(g.me);
    final save = g.buildSave();
    expect(save.zombies, hasLength(1));
    expect(save.zombies[0].kind, 'Worker');
    expect(save.zombies[0].hp, 12);
    expect(save.drops, hasLength(1));
    expect(save.crates, hasLength(1));
    expect(save.crates[0].items, [const ItemStack('cobble', 4)]);

    final again = solo(restore: SaveData.fromJson(save.toJson()));
    expect(again.sim.zombies.zombies, hasLength(1));
    expect(again.sim.zombies.zombies[0].hp, 12);
    expect(again.sim.drops.drops, hasLength(1));
    expect(again.sim.crates.crates, hasLength(1));
    expect(again.me.dead, isFalse); // a restore never starts you dead
  });

  test('the host keeps the column of a zombie the player walked away from', () {
    final g = solo();
    final s = g.player.state;
    final z = g.sim.zombies.spawn(ZombieKind.basic, s.x + 3, s.y, s.z);
    frames(g, 2);
    final zx = z.x.floor();
    final zz = z.z.floor();
    g.player.teleport(s.x + 400, s.y, s.z + 400);
    frames(g, 60);
    expect(g.world.isColumnLoaded(zx, zz), isTrue);
    expect(z.alive, isTrue);
    expect(z.y, greaterThan(0));
    // once it is gone the column goes too
    g.sim.zombies.zombies.clear();
    frames(g, 1);
    expect(g.world.isColumnLoaded(zx, zz), isFalse);
  });

  test('a client sends its actions to the host and mirrors the snapshot', () {
    final g = Game(
      seed: 7,
      local: const LocalPlayer(name: 'Sam'),
      role: Role.client,
      worldKind: WorldKind.own,
    );
    final sent = <ClientMessage>[];
    g.onAction = sent.add;
    g.inventory.add('sword', 1);
    frames(g, 1, const FrameInput(dig: true, reload: true));
    expect(sent.whereType<Swing>(), hasLength(1));
    expect(sent.whereType<Reload>(), hasLength(1));
    g.sim.applySnapshot(
      Snapshot(
        time: 5,
        players: const [],
        zombies: const [
          ZombieSnap(
            id: 9,
            kind: 'Toxic',
            x: 1,
            y: 2,
            z: 3,
            yaw: 0.5,
            state: 'chase',
            attacked: false,
            burnTimer: 0,
          ),
        ],
        drops: const [DropSnap(id: 1, item: 'dirt', x: 0, y: 1, z: 0)],
        crates: const [CrateSnap(id: 1, x: 0, y: 1, z: 0, items: 3)],
      ),
    );
    frames(g, 1);
    expect(g.ui.zombies, 1);
    expect(g.sim.zombies.zombies[0].kind, ZombieKind.toxic);
    expect(g.sim.drops.drops, hasLength(1));
    expect(g.sim.crates.crates[0].count, 3);
    // the client never runs the sim: the zombie stays where the host put it
    frames(g, 30);
    expect(g.sim.zombies.zombies[0].x, 1);
  });
}
