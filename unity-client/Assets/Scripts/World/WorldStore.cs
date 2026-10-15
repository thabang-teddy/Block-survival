using System.Collections.Generic;

namespace BlockSurvival.World
{
    /// Sparse voxel world — twin of <c>World</c> in <c>server/resources/js/world/chunkStore.ts</c>.
    /// 16^3 chunks of block ids keyed by chunk coordinate; x/z horizontal, y up.
    ///
    /// Two modes:
    /// - <b>static</b> (tests, templates): <see cref="SetBlock"/> allocates chunks on demand.
    /// - <b>streamed</b> (the game): a generator produces any chunk on demand and
    ///   columns are loaded/unloaded by the streamer. Player edits are the source
    ///   of truth: they stay in <see cref="Edits"/> for the life of the world and
    ///   are re-applied on top of the generated chunk whenever a column loads.
    public delegate byte[] ChunkGeneratorFn(int cx, int cy, int cz);

    public readonly struct Edit
    {
        public readonly int X, Y, Z, Id;
        public Edit(int x, int y, int z, int id) { X = x; Y = y; Z = z; Id = id; }
    }

    /// Extra data for prop blocks (torch, workbench, bed).
    public sealed class PropMeta
    {
        public readonly int Id;
        public readonly int X, Y, Z;

        /// facing in radians, a multiple of pi/2
        public readonly double Yaw;

        /// for multi-cell props: the other cell; Primary cells own the model
        public readonly (int, int, int)? Partner;
        public readonly bool Primary;

        public PropMeta(int id, int x, int y, int z, double yaw, bool primary, (int, int, int)? partner = null)
        {
            Id = id;
            X = x;
            Y = y;
            Z = z;
            Yaw = yaw;
            Primary = primary;
            Partner = partner;
        }
    }

    public sealed class WorldStore
    {
        private readonly Dictionary<(int, int, int), byte[]> _chunks = new Dictionary<(int, int, int), byte[]>();
        private (int, int, int)? _lastKey;
        private byte[] _lastChunk;
        private readonly HashSet<(int, int, int)> _dirty = new HashSet<(int, int, int)>();
        private List<(int, int, int)> _removed = new List<(int, int, int)>();
        private ChunkGeneratorFn _generator;
        private int _chunksY;
        private readonly HashSet<(int, int)> _loadedColumns = new HashSet<(int, int)>();

        /// prop block metadata keyed by block coordinate; bumps PropsVersion on change
        public readonly Dictionary<(int, int, int), PropMeta> Props = new Dictionary<(int, int, int), PropMeta>();
        public int PropsVersion;

        /// when true, every block change is recorded in Edits (enable after generation)
        public bool TrackEdits;
        public readonly Dictionary<(int, int, int), Edit> Edits = new Dictionary<(int, int, int), Edit>();
        private readonly Dictionary<(int, int, int), Dictionary<(int, int, int), Edit>> _editsByChunk =
            new Dictionary<(int, int, int), Dictionary<(int, int, int), Edit>>();

        /// Switch to streamed mode: chunks come from <paramref name="generator"/>, columns via <see cref="LoadColumn"/>.
        public void SetGenerator(ChunkGeneratorFn generator, int chunksY)
        {
            _generator = generator;
            _chunksY = chunksY;
        }

        public bool IsStreamed => _generator != null;

        public byte[] GetChunk(int cx, int cy, int cz) => _chunks.TryGetValue((cx, cy, cz), out var c) ? c : null;

        public IEnumerable<(int, int, int)> ChunkKeys => _chunks.Keys;

        public int ChunkCount => _chunks.Count;

        public int LoadedColumnCount => _loadedColumns.Count;

        /// Static worlds count as fully loaded; streamed worlds only where a column was loaded.
        public bool IsColumnLoaded(int x, int z) =>
            _generator == null || _loadedColumns.Contains(((int)Chunk.CoordOf(x), (int)Chunk.CoordOf(z)));

        public bool IsChunkColumnLoaded(int cx, int cz) =>
            _generator == null || _loadedColumns.Contains((cx, cz));

        public byte GetBlock(int x, int y, int z)
        {
            var k = ((int)Chunk.CoordOf(x), (int)Chunk.CoordOf(y), (int)Chunk.CoordOf(z));
            byte[] c;
            if (_lastKey.HasValue && _lastKey.Value == k)
            {
                c = _lastChunk;
            }
            else
            {
                c = _chunks.TryGetValue(k, out var found) ? found : null;
                _lastKey = k;
                _lastChunk = c;
            }
            return c == null ? Block.Air : c[Chunk.LocalIndex(x, y, z)];
        }

        public bool HasBlock(int x, int y, int z) => GetBlock(x, y, z) != Block.Air;

        /// Write a block and mark affected chunks dirty. Static mode allocates the
        /// chunk if needed; streamed mode only records the edit when the column is
        /// not loaded (it is applied when the column loads).
        public void SetBlock(int x, int y, int z, byte id)
        {
            var cx = (int)Chunk.CoordOf(x);
            var cy = (int)Chunk.CoordOf(y);
            var cz = (int)Chunk.CoordOf(z);
            var key = (cx, cy, cz);
            var pk = (x, y, z);
            if (!_chunks.TryGetValue(key, out var c))
            {
                if (_generator != null && !_loadedColumns.Contains((cx, cz)))
                {
                    if (Props.Remove(pk)) PropsVersion++;
                    RecordEdit(key, pk, x, y, z, id);
                    return;
                }
                if (id == Block.Air) return;
                c = Allocate(key);
            }
            var i = Chunk.LocalIndex(x, y, z);
            if (c[i] == id) return;
            c[i] = id;
            if (Props.Remove(pk)) PropsVersion++;
            RecordEdit(key, pk, x, y, z, id);
            _dirty.Add(key);
            MarkNeighbourChunks(x, y, z, cx, cy, cz);
        }

        /// Place a prop block with its metadata.
        public void SetProp(PropMeta meta)
        {
            SetBlock(meta.X, meta.Y, meta.Z, (byte)meta.Id);
            Props[(meta.X, meta.Y, meta.Z)] = meta;
            PropsVersion++;
        }

        public PropMeta GetProp(int x, int y, int z) => Props.TryGetValue((x, y, z), out var m) ? m : null;

        /// Same as <see cref="SetBlock"/> but never overwrites an existing block.
        public void SetBlockIfAir(int x, int y, int z, byte id)
        {
            if (GetBlock(x, y, z) == Block.Air) SetBlock(x, y, z, id);
        }

        /// Recorded edits inside one chunk (streamed mode re-applies these on load).
        public IEnumerable<Edit> EditsInChunk(int cx, int cy, int cz) =>
            _editsByChunk.TryGetValue((cx, cy, cz), out var e) ? (IEnumerable<Edit>)e.Values : System.Array.Empty<Edit>();

        // ---------------------------------------------------------------- streaming

        /// Generate every chunk of a column, overlay its edits and mark it (and its
        /// neighbours) dirty.
        public void LoadColumn(int cx, int cz)
        {
            var gen = _generator ?? throw new System.InvalidOperationException("World.LoadColumn needs a generator");
            if (!_loadedColumns.Add((cx, cz))) return;
            for (var cy = 0; cy < _chunksY; cy++)
            {
                var key = (cx, cy, cz);
                var data = gen(cx, cy, cz);
                if (_editsByChunk.TryGetValue(key, out var chunkEdits))
                {
                    foreach (var e in chunkEdits.Values)
                    {
                        if (data == null)
                        {
                            if (e.Id == Block.Air) continue;
                            data = new byte[Chunk.Volume];
                        }
                        data[Chunk.LocalIndex(e.X, e.Y, e.Z)] = (byte)e.Id;
                    }
                }
                if (data == null) continue;
                _chunks[key] = data;
                _dirty.Add(key);
            }
            _lastKey = null;
            // neighbours meshed against a missing column drew border faces; rebuild them
            foreach (var (dx, dz) in new[] { (1, 0), (-1, 0), (0, 1), (0, -1) })
            {
                for (var cy = 0; cy < _chunksY; cy++)
                {
                    DirtyIfExists((cx + dx, cy, cz + dz));
                }
            }
        }

        /// Drop a column's chunk data; edits and props stay so a later load restores them.
        public void UnloadColumn(int cx, int cz)
        {
            if (!_loadedColumns.Remove((cx, cz))) return;
            for (var cy = 0; cy < _chunksY; cy++)
            {
                var key = (cx, cy, cz);
                if (!_chunks.Remove(key)) continue;
                _dirty.Remove(key);
                _removed.Add(key);
            }
            _lastKey = null;
        }

        /// Chunks whose data was dropped. Calling this clears the list.
        public List<(int, int, int)> TakeRemoved()
        {
            var o = _removed;
            _removed = new List<(int, int, int)>();
            return o;
        }

        /// Chunks whose mesh is stale. Calling this clears the set.
        public List<(int, int, int)> TakeDirty()
        {
            var o = new List<(int, int, int)>(_dirty);
            _dirty.Clear();
            return o;
        }

        public void MarkAllDirty()
        {
            foreach (var k in _chunks.Keys) _dirty.Add(k);
        }

        // ---------------------------------------------------------------- internals

        private byte[] Allocate((int, int, int) key)
        {
            var c = new byte[Chunk.Volume];
            _chunks[key] = c;
            _lastKey = null;
            return c;
        }

        private void RecordEdit((int, int, int) chunk, (int, int, int) pk, int x, int y, int z, byte id)
        {
            if (!TrackEdits) return;
            var e = new Edit(x, y, z, id);
            Edits[pk] = e;
            if (!_editsByChunk.TryGetValue(chunk, out var dict))
            {
                dict = new Dictionary<(int, int, int), Edit>();
                _editsByChunk[chunk] = dict;
            }
            dict[pk] = e;
        }

        private void MarkNeighbourChunks(int x, int y, int z, int cx, int cy, int cz)
        {
            const int mask = Chunk.Size - 1;
            var lx = x & mask;
            var ly = y & mask;
            var lz = z & mask;
            if (lx == 0) DirtyIfExists((cx - 1, cy, cz));
            if (lx == mask) DirtyIfExists((cx + 1, cy, cz));
            if (ly == 0) DirtyIfExists((cx, cy - 1, cz));
            if (ly == mask) DirtyIfExists((cx, cy + 1, cz));
            if (lz == 0) DirtyIfExists((cx, cy, cz - 1));
            if (lz == mask) DirtyIfExists((cx, cy, cz + 1));
        }

        private void DirtyIfExists((int, int, int) key)
        {
            if (_chunks.ContainsKey(key)) _dirty.Add(key);
        }
    }
}
