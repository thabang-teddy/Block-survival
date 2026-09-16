import 'package:block_survival/app/settings.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('parseServerUrl accepts what a player would type', () {
    expect(
      parseServerUrl('block-survival.test').toString(),
      'http://block-survival.test',
    );
    expect(
      parseServerUrl(' https://play.example.com/ ').toString(),
      'https://play.example.com',
    );
    expect(
      parseServerUrl('http://10.0.0.5:8000/').toString(),
      'http://10.0.0.5:8000',
    );
    expect(
      parseServerUrl('https://host.example/sub/').toString(),
      'https://host.example/sub',
    );
    expect(parseServerUrl(''), isNull);
    expect(parseServerUrl('not a url'), isNull);
    expect(parseServerUrl('ftp://host'), isNull);
  });
}
