/// A* over "standing cells" of the voxel world — twin of
/// `entities/pathfinding.ts`. A cell is one a 2-block-tall walker can occupy
/// (air at y and y+1, solid at y-1). Moves are the 4 horizontal neighbours
/// with a step up of 1 (jump) or a drop of up to 3. Bounded by `maxNodes`;
/// when the goal is not reached the path to the closest explored cell is
/// returned so a chaser still makes progress (and can start breaking blocks
/// when it is stuck).
library;

import 'package:block_survival/world/palette.dart';
import 'package:block_survival/world/world.dart';

final class Cell {
  const Cell(this.x, this.y, this.z);

  final int x;
  final int y;
  final int z;

  @override
  bool operator ==(Object other) =>
      other is Cell && other.x == x && other.y == y && other.z == z;

  @override
  int get hashCode => Object.hash(x, y, z);

  @override
  String toString() => '($x, $y, $z)';
}

const List<(int, int)> _dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)];
const List<int> _steps = [0, 1, -1, -2, -3];

/// visited-set key relative to the search start (searches are local; the world is not)
int _relKey(int x, int y, int z) =>
    ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);

bool isStanding(World world, int x, int y, int z) =>
    !isSolid(world.getBlock(x, y, z)) &&
    !isSolid(world.getBlock(x, y + 1, z)) &&
    isSolid(world.getBlock(x, y - 1, z));

/// Drop a point onto the standing cell it is in / above (up to 4 blocks down).
Cell standingCellAt(World world, double px, double py, double pz) {
  final x = px.floor();
  final z = pz.floor();
  var y = (py + 0.01).floor();
  for (var i = 0; i < 4; i++) {
    if (isStanding(world, x, y, z)) return Cell(x, y, z);
    y--;
  }
  return Cell(x, py.floor(), z);
}

final class _Node {
  _Node(this.x, this.y, this.z, this.g, this.f, this.parent);

  final int x;
  final int y;
  final int z;
  final double g;
  final double f;
  final _Node? parent;
}

/// Minimal binary heap keyed on f.
final class _Heap {
  final List<_Node> _a = [];

  int get size => _a.length;

  void push(_Node n) {
    final a = _a;
    a.add(n);
    var i = a.length - 1;
    while (i > 0) {
      final p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      final t = a[p];
      a[p] = a[i];
      a[i] = t;
      i = p;
    }
  }

  _Node pop() {
    final a = _a;
    final top = a[0];
    final last = a.removeLast();
    if (a.isNotEmpty) {
      a[0] = last;
      var i = 0;
      for (;;) {
        final l = i * 2 + 1;
        final r = l + 1;
        var m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m == i) break;
        final t = a[m];
        a[m] = a[i];
        a[i] = t;
        i = m;
      }
    }
    return top;
  }
}

final class PathResult {
  const PathResult(this.path, {required this.reached});

  /// cells to walk through, excluding the start; empty when already adjacent
  final List<Cell> path;
  final bool reached;
}

PathResult findPath(World world, Cell start, Cell goal, {int maxNodes = 800}) {
  double h(int x, int y, int z) =>
      (x - goal.x).abs() + (z - goal.z).abs() + (y - goal.y).abs() * 0.5;
  int key(int x, int y, int z) =>
      _relKey(x - start.x, y - start.y, z - start.z);
  final open = _Heap();
  final best = <int, double>{};
  final startNode = _Node(
    start.x,
    start.y,
    start.z,
    0,
    h(start.x, start.y, start.z),
    null,
  );
  open.push(startNode);
  best[key(start.x, start.y, start.z)] = 0;
  var closest = startNode;
  var closestH = startNode.f;
  var expanded = 0;

  while (open.size > 0 && expanded < maxNodes) {
    final n = open.pop();
    expanded++;
    final hn = h(n.x, n.y, n.z);
    if (hn < closestH) {
      closest = n;
      closestH = hn;
    }
    // adjacent (or on) the goal cell counts as arrived
    if ((n.x - goal.x).abs() + (n.z - goal.z).abs() <= 1 &&
        (n.y - goal.y).abs() <= 1) {
      return PathResult(_unwind(n), reached: true);
    }
    for (final (dx, dz) in _dirs) {
      final nx = n.x + dx;
      final nz = n.z + dz;
      for (final dy in _steps) {
        final ny = n.y + dy;
        if (!isStanding(world, nx, ny, nz)) continue;
        // no headroom to jump
        if (dy == 1 && isSolid(world.getBlock(n.x, n.y + 2, n.z))) break;
        final g = n.g + 1 + (dy == 1 ? 0.5 : (dy < 0 ? 0.2 * -dy : 0));
        final k = key(nx, ny, nz);
        final prev = best[k];
        if (prev != null && prev <= g) break;
        best[k] = g;
        open.push(_Node(nx, ny, nz, g, g + h(nx, ny, nz), n));
        break; // one vertical option per direction
      }
    }
  }
  return PathResult(_unwind(closest), reached: false);
}

List<Cell> _unwind(_Node n) {
  final out = <Cell>[];
  for (_Node? c = n; c != null && c.parent != null; c = c.parent) {
    out.add(Cell(c.x, c.y, c.z));
  }
  return out.reversed.toList();
}
