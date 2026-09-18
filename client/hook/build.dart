// Compiles shaders/*.vert|frag into build/shaderbundles/block.shaderbundle with
// the SDK's impellerc; Flutter runs this hook on every build.
import 'package:flutter_gpu_shaders/build.dart';
import 'package:hooks/hooks.dart';

void main(List<String> args) async {
  await build(args, (input, output) async {
    await buildShaderBundleJson(
      buildInput: input,
      buildOutput: output,
      manifestFileName: 'block.shaderbundle.json',
    );
  });
}
