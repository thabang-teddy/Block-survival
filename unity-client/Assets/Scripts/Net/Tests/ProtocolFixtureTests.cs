using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace BlockSurvival.Net.Tests
{
    /// Verifies the C# msgpack codec reproduces every message shape in
    /// <c>shared/fixtures/protocol/messages.json</c> byte for byte, the same
    /// contract <c>client/test/net/</c> enforces on the Dart port (see
    /// <c>docs/flutter-client-plan.md</c> §2 S4 / §7 S4). A mismatch here means
    /// this Unity port can't actually talk to the host/browser/Flutter peers.
    public class ProtocolFixtureTests
    {
        private sealed class Fixture
        {
            public string Side;
            public string Name;
            public object Message; // canonical msgpack value (MsgpackMap / List<object> / long / double / string / bool / null)
            public byte[] Expected;
        }

        private static List<Fixture> _fixtures;

        private static List<Fixture> Fixtures
        {
            get
            {
                if (_fixtures != null) return _fixtures;
                var projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
                var path = Path.Combine(projectRoot, "shared", "fixtures", "protocol", "messages.json");
                var doc = JObject.Parse(File.ReadAllText(path));
                var list = new List<Fixture>();
                foreach (var entry in (JArray)doc["messages"])
                {
                    list.Add(new Fixture
                    {
                        Side = (string)entry["side"],
                        Name = (string)entry["name"],
                        Message = FromJToken(entry["message"]),
                        Expected = Convert.FromBase64String((string)entry["base64"]),
                    });
                }
                _fixtures = list;
                return _fixtures;
            }
        }

        private static IEnumerable<string> FixtureNames() => Fixtures.Select(f => $"{f.Side}/{f.Name}");

        private static object FromJToken(JToken token)
        {
            switch (token.Type)
            {
                case JTokenType.Object:
                    var map = new MsgpackMap();
                    foreach (var prop in ((JObject)token).Properties())
                    {
                        map.Add(prop.Name, FromJToken(prop.Value));
                    }
                    return map;
                case JTokenType.Array:
                    return ((JArray)token).Select(FromJToken).ToList();
                case JTokenType.Integer:
                    return (long)token;
                case JTokenType.Float:
                    return (double)token;
                case JTokenType.String:
                    return (string)token;
                case JTokenType.Boolean:
                    return (bool)token;
                case JTokenType.Null:
                    return null;
                default:
                    throw new InvalidOperationException($"unsupported JTokenType {token.Type}");
            }
        }

        private static bool ValuesEqual(object a, object b)
        {
            if (a == null || b == null) return a == null && b == null;
            switch (a)
            {
                case long la: return b is long lb && la == lb;
                case double da: return b is double db && da.Equals(db);
                case string sa: return b is string sb && sa == sb;
                case bool ba: return b is bool bb && ba == bb;
                case byte[] bina: return b is byte[] binb && bina.SequenceEqual(binb);
                case List<object> lista:
                    if (!(b is List<object> listb) || lista.Count != listb.Count) return false;
                    for (var i = 0; i < lista.Count; i++)
                    {
                        if (!ValuesEqual(lista[i], listb[i])) return false;
                    }
                    return true;
                case MsgpackMap mapa:
                    if (!(b is MsgpackMap mapb) || mapa.Count != mapb.Count) return false;
                    for (var i = 0; i < mapa.Entries.Count; i++)
                    {
                        if (mapa.Entries[i].Key != mapb.Entries[i].Key) return false;
                        if (!ValuesEqual(mapa.Entries[i].Value, mapb.Entries[i].Value)) return false;
                    }
                    return true;
                default:
                    return false;
            }
        }

        private static string Hex(byte[] bytes) => string.Join(" ", bytes.Select(b => b.ToString("x2")));

        [TestCaseSource(nameof(FixtureNames))]
        public void Encode_matches_fixture_bytes(string key)
        {
            var fx = Fixtures.First(f => $"{f.Side}/{f.Name}" == key);
            var actual = Msgpack.Encode(fx.Message);
            CollectionAssert.AreEqual(fx.Expected, actual, $"{key}\nexpected: {Hex(fx.Expected)}\nactual:   {Hex(actual)}");
        }

        [TestCaseSource(nameof(FixtureNames))]
        public void Decode_matches_fixture_message(string key)
        {
            var fx = Fixtures.First(f => $"{f.Side}/{f.Name}" == key);
            var decoded = Msgpack.Decode(fx.Expected);
            Assert.IsTrue(ValuesEqual(fx.Message, decoded), $"{key}: decoded value does not match fixture message");
        }

        [TestCaseSource(nameof(FixtureNames))]
        public void Decode_then_reencode_is_byte_identical(string key)
        {
            var fx = Fixtures.First(f => $"{f.Side}/{f.Name}" == key);
            var decoded = Msgpack.Decode(fx.Expected);
            var reencoded = Msgpack.Encode(decoded);
            CollectionAssert.AreEqual(fx.Expected, reencoded, $"{key}: round-trip re-encode drifted from the fixture bytes");
        }
    }
}
