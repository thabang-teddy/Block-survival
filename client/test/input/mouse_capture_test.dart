import 'package:block_survival/input/mouse_capture.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('block_survival/mouse');
  final calls = <String>[];

  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          calls.add(call.method);
          return switch (call.method) {
            'isSupported' => true,
            'capture' => true,
            _ => null,
          };
        });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  Future<void> fromRunner(String method, Object? args) async {
    final codec = const StandardMethodCodec();
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
          channel.name,
          codec.encodeMethodCall(MethodCall(method, args)),
          (_) {},
        );
  }

  test('capture asks the runner, sums its deltas, and Esc/release frees the cursor', () async {
    final mouse = ChannelMouseCapture(channel);
    expect(await mouse.isSupported, isTrue);
    expect(await mouse.capture(), isTrue);
    expect(mouse.state, CaptureState.captured);

    await fromRunner('delta', [3, -2]);
    await fromRunner('delta', [4, 1]);
    expect(mouse.takeDelta(), const Offset(7, -1));
    expect(mouse.takeDelta(), Offset.zero, reason: 'drained');

    await mouse.release();
    expect(mouse.state, CaptureState.released);
    expect(calls, ['isSupported', 'capture', 'release']);
    mouse.dispose();
  });

  test(
    'losing focus releases from the runner side and drops pending motion',
    () async {
      final mouse = ChannelMouseCapture(channel);
      final states = <CaptureState>[];
      mouse.onStateChanged.listen(states.add);
      await mouse.capture();
      await fromRunner('delta', [10, 10]);
      await fromRunner('released', null);
      await Future<void>.delayed(Duration.zero);
      expect(mouse.state, CaptureState.released);
      expect(mouse.takeDelta(), Offset.zero);
      expect(states, [CaptureState.captured, CaptureState.released]);
      mouse.dispose();
    },
  );

  test('deltas that arrive while released are ignored', () async {
    final mouse = ChannelMouseCapture(channel);
    await fromRunner('delta', [5, 5]);
    expect(mouse.takeDelta(), Offset.zero);
    mouse.dispose();
  });

  test('without a runner backend capture reports unsupported', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
    final mouse = ChannelMouseCapture(channel);
    expect(await mouse.isSupported, isFalse);
    expect(await mouse.capture(), isFalse);
    mouse.dispose();
  });

  test('the drag fallback accumulates what the gesture feeds it', () async {
    final mouse = DragMouseCapture();
    expect(await mouse.isSupported, isFalse);
    mouse.addDelta(const Offset(1, 2));
    mouse.addDelta(const Offset(3, 4));
    expect(mouse.takeDelta(), const Offset(4, 6));
    mouse.dispose();
  });
}
