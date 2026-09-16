import 'dart:io';

import 'package:block_survival/app/app.dart';
import 'package:block_survival/app/session.dart';
import 'package:flutter/material.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final session = AppSession(
    serverUrl: Uri.parse(defaultServerUrl),
    deviceName: '${Platform.localHostname} (${Platform.operatingSystem})',
  );
  runApp(BlockSurvivalApp(session: session));
}
