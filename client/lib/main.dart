import 'package:block_survival/ui/spike_page.dart';
import 'package:flutter/material.dart';

void main() {
  runApp(const BlockSurvivalApp());
}

class BlockSurvivalApp extends StatelessWidget {
  const BlockSurvivalApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Block Survival',
      theme: ThemeData.dark(useMaterial3: true),
      debugShowCheckedModeBanner: false,
      home: const SpikePage(),
    );
  }
}
