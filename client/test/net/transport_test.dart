/// The signalling cadence (mirrors net/__tests__/signaller.test.ts) and the
/// host/client handshake over in-memory peers, ending in one protocol message
/// each way — the S4 flow without a network.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:block_survival/net/protocol.dart';
import 'package:block_survival/net/signaller.dart';
import 'package:block_survival/net/transport.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes.dart';

final class Recorder implements TransportEvents {
  final List<String> opened = [];
  final List<String> closed = [];
  final List<(String, Uint8List)> data = [];

  @override
  void onOpen(Link link) => opened.add(link.id);

  @override
  void onData(Link link, Uint8List bytes) => data.add((link.id, bytes));

  @override
  void onClose(Link link) => closed.add(link.id);
}

void main() {
  group('Signaller', () {
    test(
      'delivers rows addressed to us in server order and advances the cursor',
      () {
        fakeAsync((async) {
          final mailbox = FakeMailbox();
          final api = FakeSignalApi(mailbox);
          mailbox.post('clientBBBBBB', 'hostAAAAAAAA', 'offer', {'n': 1});
          mailbox.post('clientBBBBBB', 'hostAAAAAAAA', 'candidate', {'n': 2});
          mailbox.post('clientBBBBBB', 'someoneElse', 'candidate', {'n': 3});
          final got = <SignalMessage>[];
          final s = Signaller(api, 'ABCDEF', 'hostAAAAAAAA');
          s.messages.listen(got.add);
          s.start();

          async.elapse(Duration.zero);
          expect(got.map((m) => m.type), ['offer', 'candidate']);
          expect(got.first.from, 'clientBBBBBB');
          expect(got.first.to, 'hostAAAAAAAA');
          expect(s.cursor, 2);

          mailbox.post('clientBBBBBB', 'hostAAAAAAAA', 'candidate', {'n': 4});
          async.elapse(pollActive);
          expect(got.length, 3);
          expect(s.cursor, 4);
          s.leave();
        });
      },
    );

    test('polls quickly while a handshake is in flight, then relaxes', () {
      fakeAsync((async) {
        final mailbox = FakeMailbox();
        final api = FakeSignalApi(mailbox);
        final s = Signaller(
          api,
          'ABCDEF',
          'hostAAAAAAAA',
          now: () => async.getClock(DateTime(2026)).now(),
        );
        s.start();
        async.elapse(Duration.zero);
        expect(mailbox.polls, 1);

        // nothing has ever arrived: idle cadence
        async.elapse(pollActive);
        expect(mailbox.polls, 1);
        async.elapse(pollIdle - pollActive);
        expect(mailbox.polls, 2);

        // a signal arrives: active cadence for the window
        mailbox.post('x', 'hostAAAAAAAA', 'candidate', {});
        async.elapse(pollIdle);
        expect(mailbox.polls, 3);
        async.elapse(pollActive);
        expect(mailbox.polls, 4);

        // the window passes: back to idle
        async.elapse(pollActiveWindow);
        final before = mailbox.polls;
        async.elapse(pollActive);
        expect(mailbox.polls, before);
        async.elapse(pollIdle);
        expect(mailbox.polls, before + 1);
        s.leave();
      });
    });

    test(
      'a failed poll backs off, a 404 is remembered as the room being gone',
      () {
        fakeAsync((async) {
          final mailbox = FakeMailbox();
          final api = FakeSignalApi(mailbox);
          mailbox.pollFailures.addAll([500, 0, 404]);
          final s = Signaller(api, 'ABCDEF', 'me', alwaysActive: true);
          s.start();
          async.elapse(Duration.zero);
          expect(mailbox.polls, 1);
          expect(s.gone, isNull);
          async.elapse(const Duration(seconds: 1)); // backoff 1 s
          expect(mailbox.polls, 2);
          async.elapse(const Duration(seconds: 2)); // backoff 2 s
          expect(mailbox.polls, 3);
          expect(s.gone, isA<RoomGone>());
          async.elapse(const Duration(seconds: 3)); // backoff 3 s, then success
          expect(mailbox.polls, 4);
          expect(s.gone, isNull);
          async.elapse(pollActive);
          expect(mailbox.polls, 5, reason: 'back to the normal cadence');
          s.leave();
        });
      },
    );

    test(
      'sends retry transient failures and give up on client errors',
      () async {
        final mailbox = FakeMailbox();
        final api = FakeSignalApi(mailbox);
        final s = Signaller(api, 'ABCDEF', 'me', sleep: (_) async {});
        mailbox.sendFailures.addAll([503, 0]);
        await s.send('host', 'offer', {'sdp': 'x'});
        expect(mailbox.sent.single.type, 'offer');

        mailbox.sendFailures.addAll([503, 503, 503]);
        await expectLater(s.send('host', 'offer', {}), throwsA(anything));

        mailbox.sendFailures.add(404);
        await expectLater(s.send('host', 'offer', {}), throwsA(anything));
        expect(mailbox.sent.length, 1);
        s.leave();
      },
    );
  });

  group('HostTransport + ClientTransport', () {
    test(
      'a client offers, the host answers, and protocol messages flow both ways',
      () async {
        final mailbox = FakeMailbox();
        final rtc = FakeRtc();
        final hostEvents = Recorder();
        final clientEvents = Recorder();
        final host = HostTransport(
          FakeSignalApi(mailbox),
          rtc,
          hostEvents,
          id: 'hostAAAAAAAA',
        );
        host.listen('ABCDEF');
        final client = ClientTransport(
          FakeSignalApi(mailbox, hostPeerId: host.id),
          rtc,
          clientEvents,
          id: 'clientBBBBBB',
        );

        final link = await client.connect(
          'ABCDEF',
          timeout: const Duration(seconds: 5),
        );
        expect(link.id, host.id);
        expect(clientEvents.opened, [host.id]);
        // the host learns of the client once its mirrored channel opens
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(hostEvents.opened, ['clientBBBBBB']);
        expect(host.links.keys, ['clientBBBBBB']);

        // the mailbox saw offer → answer, with candidates from both sides
        expect(
          mailbox.sent.map((s) => s.type).toList(),
          containsAll(['offer', 'answer', 'candidate']),
        );
        expect(mailbox.sent.firstWhere((s) => s.type == 'offer').to, host.id);
        expect(
          mailbox.sent.firstWhere((s) => s.type == 'answer').to,
          'clientBBBBBB',
        );

        // hello up, welcome down — real protocol bytes
        link.send(
          encodeClient(
            const Hello(v: protocolVersion, name: 'Teddy', userId: 7),
          ),
        );
        await Future<void>.delayed(Duration.zero);
        final hello = decodeClient(hostEvents.data.single.$2);
        expect(hello, isA<Hello>().having((h) => h.name, 'name', 'Teddy'));

        host.broadcast(
          encodeHost(
            const Welcome(
              v: 1,
              you: 'clientBBBBBB',
              seed: 11,
              time: 0,
              edits: [],
              spawn: Vec3(0.5, 37, 0.5),
            ),
          ),
        );
        await Future<void>.delayed(Duration.zero);
        final welcome = decodeHost(clientEvents.data.single.$2);
        expect(welcome, isA<Welcome>().having((w) => w.seed, 'seed', 11));

        // dropping the connection closes the link on both sides exactly once
        rtc.peers.first.dropConnection();
        rtc.peers.last.dropConnection();
        await Future<void>.delayed(Duration.zero);
        expect(clientEvents.closed, [host.id]);
        expect(hostEvents.closed, ['clientBBBBBB']);
        expect(host.links, isEmpty);
        await client.dispose();
        await host.dispose();
      },
    );

    test('a joiner whose host never answers times out with the room state', () {
      fakeAsync((async) {
        final mailbox = FakeMailbox();
        final rtc = FakeRtc();
        final client = ClientTransport(
          FakeSignalApi(mailbox),
          rtc,
          Recorder(),
          id: 'clientBBBBBB',
        );
        Object? error;
        client
            .connect('ABCDEF', timeout: const Duration(seconds: 2))
            .catchError((Object e) {
              error = e;
              throw e;
            })
            .ignore();
        async.elapse(Duration.zero);
        expect(mailbox.sent.map((s) => s.type), contains('offer'));
        async.elapse(const Duration(seconds: 3));
        expect(error, isA<StateError>());

        // the same, but the room vanished mid-handshake
        mailbox.pollFailures.addAll(List.filled(20, 404));
        final gone = ClientTransport(
          FakeSignalApi(mailbox),
          FakeRtc(),
          Recorder(),
          id: 'clientCCCCCC',
        );
        Object? goneError;
        gone.connect('ABCDEF', timeout: const Duration(seconds: 2)).catchError((
          Object e,
        ) {
          goneError = e;
          throw e;
        }).ignore();
        async.elapse(const Duration(seconds: 3));
        expect(goneError, isA<RoomGone>());
      });
    });
  });
}
