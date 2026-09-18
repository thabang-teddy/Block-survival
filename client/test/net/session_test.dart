// HostSession + ClientSession over the in-memory transport: a joiner gets an
// avatar in the host sim, its actions are applied by the host, snapshots
// carry the entities and its own score, and private state reaches only it.
import 'package:block_survival/entities/zombies.dart';
import 'package:block_survival/game/game.dart';
import 'package:block_survival/game/ui_state.dart';
import 'package:block_survival/net/client_session.dart';
import 'package:block_survival/net/host_session.dart';
import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/world/seed.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));

void main() {
  test('a joiner is simulated by the host and mirrors what it is sent', () async {
    final mailbox = FakeMailbox();
    final rtc = FakeRtc();
    final api = FakeSignalApi(mailbox);
    final hostGame = Game(
      seed: 7,
      local: const LocalPlayer(name: 'Teddy', userId: 1),
      role: Role.host,
      worldKind: WorldKind.own,
    );
    final host = HostSession(api, rtc, code: 'ABCDEF')..attach(hostGame);
    await host.listen('Teddy', WorldKind.own);

    final client = ClientSession(api, rtc, 'ABCDEF', 'Sam', userId: 2);
    final welcome = await client.connect(timeout: const Duration(seconds: 5));
    expect(welcome.seed, 7);
    await settle();
    expect(host.players.keys, [welcome.you]);
    final sam = hostGame.sim.avatars[welcome.you]!;
    expect(sam.name, 'Sam');
    expect(hostGame.remotePlayers.single.name, 'Sam');

    final clientGame = Game(
      seed: welcome.seed,
      local: const LocalPlayer(name: 'Sam', userId: 2),
      role: Role.client,
      worldKind: WorldKind.own,
    );
    client.attach(clientGame);
    await settle();
    // the welcome's private state seeded the client's avatar
    expect(clientGame.me.spawn.x, hostGame.spawn.x);

    // the host gives Sam a sword and a zombie to hit; Sam swings from its game
    sam.inventory.add('sword', 1);
    final z = hostGame.sim.zombies.spawn(
      ZombieKind.basic,
      sam.x,
      sam.y,
      sam.z - 2,
    );
    sam.yaw = 0;
    clientGame.player.state.yaw = 0;
    // one snapshot period on the host: entities and private state go out
    host.tick(1 / snapshotHz + 0.001);
    await settle();
    expect(clientGame.sim.zombies.zombies.map((x) => x.id), [z.id]);
    expect(clientGame.inventory.count('sword'), 1); // inventory sync
    clientGame.update(1 / 60, const FrameInput(dig: true));
    await settle();
    expect(z.hp, 10);
    expect(sam.kills, 0);
    host.tick(1 / snapshotHz + 0.001);
    await settle();
    expect(clientGame.remotePlayers.map((p) => p.name), ['Teddy']);
    expect(client.players.where((p) => p.you).single.name, 'Sam');

    // the host hurts Sam: the private state carries health and the flash
    hostGame.sim.hurt(sam, 30, poison: true);
    host.tick(1 / snapshotHz + 0.001);
    await settle();
    clientGame.update(1 / 60, const FrameInput());
    expect(clientGame.ui.health, 70);
    expect(clientGame.ui.poisoned, isTrue);
    expect(clientGame.me.hurtAt, isNot(-10)); // the flash was triggered

    // Sam dies: the client shows the death screen, then comes back at its spawn
    hostGame.sim.hurt(sam, 500, poison: false);
    hostGame.sim.tick(1 / 60);
    host.tick(1 / snapshotHz + 0.001);
    await settle();
    clientGame.update(1 / 60, const FrameInput());
    expect(clientGame.ui.dead, isTrue);
    expect(clientGame.ui.respawnIn, 5);
    expect(hostGame.sim.crates.crates, hasLength(1));
    hostGame.dayNight.time += 6;
    hostGame.sim.tick(1 / 60);
    host.tick(1 / snapshotHz + 0.001);
    await settle();
    clientGame.update(1 / 60, const FrameInput());
    expect(clientGame.ui.dead, isFalse);
    expect(clientGame.ui.message, 'Your loot crate is where you fell');
    expect(clientGame.player.state.x, sam.spawn.x);

    // leaving keeps Sam's gear in the host's save
    await client.dispose();
    await settle();
    expect(host.players, isEmpty);
    expect(hostGame.savedVisitor(2)?.deaths, 1);
    await host.dispose();
  });
}
