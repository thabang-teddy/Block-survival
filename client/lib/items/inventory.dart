/// 36-slot inventory — twin of `items/inventory.ts`: slots 0–8 are the hotbar,
/// 9–35 the backpack.
library;

import 'dart:math' as math;

import 'package:block_survival/items/registry.dart';
import 'package:flutter/foundation.dart';

final class ItemStack {
  const ItemStack(this.id, this.count);

  factory ItemStack.fromJson(Map<String, dynamic> j) =>
      ItemStack(j['id'] as String, (j['count'] as num).toInt());

  Map<String, dynamic> toJson() => {'id': id, 'count': count};

  final String id;
  final int count;

  @override
  bool operator ==(Object other) =>
      other is ItemStack && other.id == id && other.count == count;

  @override
  int get hashCode => Object.hash(id, count);

  @override
  String toString() => '$id×$count';
}

const int hotbarSize = 9;
const int inventorySize = 36;

/// notifies listeners on every change (the HUD and crafting panel rebuild)
final class Inventory extends ChangeNotifier {
  final List<ItemStack?> _slots = List.filled(inventorySize, null);

  /// bumped on every change so callers can cheaply detect it
  int version = 0;

  ItemStack? get(int slot) =>
      slot >= 0 && slot < inventorySize ? _slots[slot] : null;

  List<ItemStack?> hotbar() => List.unmodifiable(_slots.sublist(0, hotbarSize));

  List<ItemStack?> all() => List.unmodifiable(_slots);

  int count(String id) {
    var n = 0;
    for (final s in _slots) {
      if (s?.id == id) n += s!.count;
    }
    return n;
  }

  /// Add items; returns how many did not fit.
  int add(String id, int count) {
    final max = getItem(id).maxStack;
    var left = count;
    for (var i = 0; i < inventorySize && left > 0; i++) {
      final s = _slots[i];
      if (s != null && s.id == id && s.count < max) {
        final take = math.min(max - s.count, left);
        _slots[i] = ItemStack(id, s.count + take);
        left -= take;
      }
    }
    for (var i = 0; i < inventorySize && left > 0; i++) {
      if (_slots[i] != null) continue;
      final take = math.min(max, left);
      _slots[i] = ItemStack(id, take);
      left -= take;
    }
    if (left != count) _changed();
    return left;
  }

  /// Remove up to `count` from one slot; returns how many were removed.
  int takeFromSlot(int slot, int count) {
    final s = _slots[slot];
    if (s == null) return 0;
    final n = math.min(count, s.count);
    _slots[slot] = s.count - n > 0 ? ItemStack(s.id, s.count - n) : null;
    _changed();
    return n;
  }

  /// Remove `count` of an item from anywhere; false (and no change) if short.
  bool remove(String id, int count) {
    if (this.count(id) < count) return false;
    var left = count;
    for (var i = inventorySize - 1; i >= 0 && left > 0; i--) {
      final s = _slots[i];
      if (s?.id != id) continue;
      final n = math.min(s!.count, left);
      _slots[i] = s.count - n > 0 ? ItemStack(id, s.count - n) : null;
      left -= n;
    }
    _changed();
    return true;
  }

  /// Replace every slot (client mirror of the host's copy).
  void replace(List<ItemStack?> slots) {
    for (var i = 0; i < inventorySize; i++) {
      _slots[i] = i < slots.length ? slots[i] : null;
    }
    _changed();
  }

  void swap(int a, int b) {
    final tmp = _slots[a];
    _slots[a] = _slots[b];
    _slots[b] = tmp;
    _changed();
  }

  void _changed() {
    version++;
    notifyListeners();
  }
}
