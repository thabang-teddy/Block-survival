using System;
using System.Collections.Generic;

namespace BlockSurvival.World
{
    /// A bounded cache that evicts the least-recently-used entry once it grows past
    /// <c>capacity</c>. Mirrors the hand-rolled "remove then reinsert to refresh,
    /// evict the first key when over capacity" pattern the Dart port uses on
    /// <c>LinkedHashMap</c> (see <c>client/lib/world/island_field.dart</c>,
    /// <c>underground.dart</c>, <c>terrain_gen.dart</c>) — eviction order never
    /// affects generated world content, only memory, so it is not part of the
    /// cross-play contract.
    public sealed class LruCache<TKey, TValue>
    {
        private readonly int _capacity;
        private readonly Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>> _map;
        private readonly LinkedList<(TKey Key, TValue Value)> _order = new LinkedList<(TKey Key, TValue Value)>();

        public LruCache(int capacity)
        {
            _capacity = capacity;
            _map = new Dictionary<TKey, LinkedListNode<(TKey Key, TValue Value)>>();
        }

        public bool TryGet(TKey key, out TValue value)
        {
            if (_map.TryGetValue(key, out var node))
            {
                _order.Remove(node);
                _order.AddLast(node);
                value = node.Value.Value;
                return true;
            }
            value = default;
            return false;
        }

        public TValue GetOrAdd(TKey key, Func<TValue> create)
        {
            if (TryGet(key, out var existing)) return existing;
            var value = create();
            var node = new LinkedListNode<(TKey Key, TValue Value)>((key, value));
            _order.AddLast(node);
            _map[key] = node;
            if (_map.Count > _capacity)
            {
                var oldest = _order.First;
                _order.RemoveFirst();
                _map.Remove(oldest.Value.Key);
            }
            return value;
        }
    }
}
