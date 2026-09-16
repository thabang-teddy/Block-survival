/// Draws the world's chunk meshes with Flutter GPU (Impeller). One render
/// pipeline (shaders/chunk.*), one device buffer per chunk geometry, opaque
/// geometry first with depth writes, then translucent with blending.
///
/// The frame is rendered into an offscreen texture that a widget paints; the
/// renderer itself has no widget dependency.
library;

import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:block_survival/render/camera.dart';
import 'package:block_survival/render/lighting.dart';
import 'package:block_survival/world/mesher.dart';
import 'package:block_survival/world/world.dart';
import 'package:flutter_gpu/gpu.dart' as gpu;
import 'package:vector_math/vector_math.dart' as vm32;
import 'package:vector_math/vector_math_64.dart';

const String _bundlePath = 'build/shaderbundles/block.shaderbundle';

/// a chunk geometry uploaded to the GPU
final class _GpuMesh {
  _GpuMesh(this.vertices, this.indices, this.indexCount, this.vertexCount);

  final gpu.DeviceBuffer vertices;
  final gpu.DeviceBuffer indices;
  final int indexCount;
  final int vertexCount;

  static _GpuMesh upload(MeshData mesh) {
    final v = gpu.gpuContext.createDeviceBufferWithCopy(
      ByteData.sublistView(mesh.vertices),
    );
    final i = gpu.gpuContext.createDeviceBufferWithCopy(
      ByteData.sublistView(mesh.indices),
    );
    return _GpuMesh(v, i, mesh.indices.length, mesh.vertexCount);
  }

  gpu.BufferView get vertexView => gpu.BufferView(
    vertices,
    offsetInBytes: 0,
    lengthInBytes: vertexCount * vertexBytes,
  );

  gpu.BufferView get indexView =>
      gpu.BufferView(indices, offsetInBytes: 0, lengthInBytes: indexCount * 4);
}

final class _ChunkGeometry {
  _ChunkGeometry({this.opaque, this.translucent});

  final _GpuMesh? opaque;
  final _GpuMesh? translucent;
}

final class RenderStats {
  const RenderStats({
    required this.chunks,
    required this.drawCalls,
    required this.triangles,
  });

  final int chunks;
  final int drawCalls;
  final int triangles;
}

final class ChunkRenderer {
  ChunkRenderer._(gpu.Shader vertex, gpu.Shader fragment)
    : _pipeline = gpu.gpuContext.createRenderPipeline(vertex, fragment),
      _frameSlot = vertex.getUniformSlot('FrameInfo'),
      _lightSlot = fragment.getUniformSlot('LightInfo');

  /// loads the shader bundle (an asset read, hence async) and builds the pipeline
  static Future<ChunkRenderer> create() async {
    final library = await gpu.ShaderLibrary.fromAsset(_bundlePath);
    if (library == null) {
      throw StateError('shader bundle $_bundlePath did not load');
    }
    final vertex = library['ChunkVertex'];
    final fragment = library['ChunkFragment'];
    if (vertex == null || fragment == null) {
      throw StateError('shader bundle $_bundlePath lacks the chunk shaders');
    }
    return ChunkRenderer._(vertex, fragment);
  }

  final gpu.RenderPipeline _pipeline;
  final gpu.UniformSlot _frameSlot;
  final gpu.UniformSlot _lightSlot;
  final gpu.HostBuffer _uniforms = gpu.gpuContext.createHostBuffer();

  final Map<ChunkKey, _ChunkGeometry> _geometry = {};
  gpu.Texture? _color;
  gpu.Texture? _depth;
  int _width = 0;
  int _height = 0;

  int get chunkCount => _geometry.length;

  /// Re-mesh every dirty chunk and drop the removed ones.
  void sync(World world) {
    for (final key in world.takeRemoved()) {
      _geometry.remove(key);
    }
    for (final key in world.takeDirty()) {
      final (cx, cy, cz) = key;
      final mesh = meshChunk(world, cx, cy, cz);
      if (mesh.isEmpty) {
        _geometry.remove(key);
        continue;
      }
      _geometry[key] = _ChunkGeometry(
        opaque: mesh.opaque == null ? null : _GpuMesh.upload(mesh.opaque!),
        translucent: mesh.translucent == null
            ? null
            : _GpuMesh.upload(mesh.translucent!),
      );
    }
  }

  void _ensureTargets(int width, int height) {
    if (_color != null && width == _width && height == _height) return;
    _width = width;
    _height = height;
    _color = gpu.gpuContext.createTexture(
      gpu.StorageMode.devicePrivate,
      width,
      height,
    );
    _depth = gpu.gpuContext.createTexture(
      gpu.StorageMode.deviceTransient,
      width,
      height,
      format: gpu.gpuContext.defaultDepthStencilFormat,
    );
  }

  /// Render one frame and return it as an image the widget layer can draw.
  (ui.Image, RenderStats) render(
    Camera camera,
    Lighting lighting,
    int width,
    int height,
  ) {
    _ensureTargets(width, height);
    _uniforms.reset();
    final sky = lighting.palette.sky;
    final target = gpu.RenderTarget.singleColor(
      gpu.ColorAttachment(
        texture: _color!,
        // flutter_gpu speaks the 32-bit vector_math flavour
        clearValue: vm32.Vector4(sky.x, sky.y, sky.z, 1),
      ),
      depthStencilAttachment: gpu.DepthStencilAttachment(
        texture: _depth!,
        depthClearValue: 1.0,
      ),
    );

    final commands = gpu.gpuContext.createCommandBuffer();
    final pass = commands.createRenderPass(target);
    pass.bindPipeline(_pipeline);
    pass.setCullMode(gpu.CullMode.backFace);
    pass.setWindingOrder(gpu.WindingOrder.counterClockwise);
    pass.setDepthCompareOperation(gpu.CompareFunction.less);

    final frame = _uniforms.emplace(
      _frameBytes(camera.viewProjection(width / height)),
    );
    final light = _uniforms.emplace(_lightBytes(lighting));
    pass.bindUniform(_frameSlot, frame);
    pass.bindUniform(_lightSlot, light);

    var draws = 0;
    var triangles = 0;
    void draw(_GpuMesh mesh) {
      pass.bindVertexBuffer(mesh.vertexView);
      pass.bindIndexBuffer(mesh.indexView, gpu.IndexType.int32);
      pass.drawIndexed(mesh.indexCount);
      draws++;
      triangles += mesh.indexCount ~/ 3;
    }

    pass.setDepthWriteEnable(true);
    pass.setColorBlendEnable(false);
    for (final g in _geometry.values) {
      if (g.opaque != null) draw(g.opaque!);
    }

    pass.setDepthWriteEnable(false);
    pass.setColorBlendEnable(true);
    pass.setColorBlendEquation(
      gpu.ColorBlendEquation(
        sourceColorBlendFactor: gpu.BlendFactor.sourceAlpha,
        destinationColorBlendFactor: gpu.BlendFactor.oneMinusSourceAlpha,
        sourceAlphaBlendFactor: gpu.BlendFactor.one,
        destinationAlphaBlendFactor: gpu.BlendFactor.oneMinusSourceAlpha,
      ),
    );
    for (final g in _geometry.values) {
      if (g.translucent != null) draw(g.translucent!);
    }

    commands.submit();
    return (
      _color!.asImage(),
      RenderStats(
        chunks: _geometry.length,
        drawCalls: draws,
        triangles: triangles,
      ),
    );
  }

  ByteData _frameBytes(Matrix4 mvp) {
    final data = ByteData(64);
    final floats = Float32List.view(data.buffer);
    for (var i = 0; i < 16; i++) {
      floats[i] = mvp.storage[i];
    }
    return data;
  }

  ByteData _lightBytes(Lighting l) {
    final p = l.palette;
    final floats = Float32List(24);
    void put(int at, Vector3 v, double w) {
      floats[at] = v.x;
      floats[at + 1] = v.y;
      floats[at + 2] = v.z;
      floats[at + 3] = w;
    }

    put(0, l.sunDirection, 0);
    put(4, p.sun * p.sunIntensity, 0);
    put(8, p.hemiSky * p.hemi, 0);
    put(12, p.hemiGround * p.hemi, 0);
    put(16, p.sky, 1);
    floats[20] = fogNear;
    floats[21] = fogFar;
    return ByteData.sublistView(floats);
  }
}
