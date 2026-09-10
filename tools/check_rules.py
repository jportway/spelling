#!/usr/bin/env python3
"""Run firestore.rules against the Firestore emulator and see what it lets in.

The rules are the only thing standing between the internet and the practice
log - the project id and web api key in js/logbook.js are public by design -
so "I think this is right" is not good enough. This drives the real rules
engine with the records the game actually sends.

    npm install -g firebase-tools
    firebase emulators:start --only firestore --project spelling-logbook-test
    python3 tools/check_rules.py

Needs a firebase.json next to wherever you start the emulator, pointing at
this repository's firestore.rules:

    { "firestore": { "rules": "firestore.rules" },
      "emulators": { "firestore": { "port": 8710 }, "ui": { "enabled": false } } }

The project id is a throwaway; nothing here touches a real project. `Bearer
owner` is the emulator's admin escape hatch, used only to look at what landed
- the game itself never sends it.
"""

import base64, io, json, os, re, sys, urllib.error, urllib.request

PID  = "spelling-logbook-test"
EMU  = "http://127.0.0.1:8710"
BASE = EMU + "/v1/projects/%s/databases/(default)/documents" % PID
HERE  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULES = io.open(os.path.join(HERE, "firestore.rules"), encoding="utf-8").read()

def signed_in_as(uid):
    """A token for a signed-in user.

    The emulator accepts unsigned JWTs, which is exactly what is wanted here:
    the point is to exercise the rules, not Google's signing.
    """
    def part(obj):
        return base64.urlsafe_b64encode(
            json.dumps(obj, separators=(",", ":")).encode()).rstrip(b"=")

    header = part({"alg": "none", "typ": "JWT"})
    claims = part({
        "iss": "https://securetoken.google.com/%s" % PID, "aud": PID,
        "sub": uid, "user_id": uid,
        "email": "somebody@example.com", "email_verified": True,
    })
    return (header + b"." + claims + b".").decode()


def req(method, url, body=None, owner=False, token=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if owner: r.add_header("Authorization", "Bearer owner")
    elif token: r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:    return e.code, json.loads(e.read() or b"{}")
        except Exception: return e.code, {}

st, body = req("PUT", EMU + "/emulator/v1/projects/%s:securityRules" % PID,
               {"rules": {"files": [{"name": "firestore.rules", "content": RULES}]}})
print("load firestore.rules:", st, "" if st == 200 else json.dumps(body)[:400])
if st != 200: sys.exit(1)

# Start from empty, all the way - a single page would leave a big collection
# behind and every count below would then be measuring the leftovers.
while True:
    found = req("GET", BASE + "/logs?pageSize=300", owner=True)[1].get("documents", [])
    if not found:
        break
    for d in found:
        req("DELETE", EMU + "/v1/" + d["name"], owner=True)

def S(v): return {"stringValue": v}
def I(v): return {"integerValue": str(v)}
def L(vs): return {"arrayValue": {"values": vs}}
def M(f): return {"mapValue": {"fields": f}}

def commit(docs):
    return req("POST", BASE + ":commit", {"writes": [
        {"update": {"name": "projects/%s/databases/(default)/documents/logs/%s" % (PID, i),
                    "fields": f}} for i, f in docs]})

def count():
    return len(req("GET", BASE + "/logs?pageSize=300", owner=True)[1].get("documents", []))

DEV = "d_abc123ab"
ROUND_START = {"k": S("round-start"), "minutes": I(5), "game": S("missing"),
               "d": S(DEV), "r": S("r_zz1"), "t": I(1757000000000), "n": I(1)}
WORD = {"k": S("word"), "w": S("bandit"), "g": I(1), "lv": I(2),
        "h": L([I(0), I(3)]),
        "tries": L([M({"hole": I(3), "got": S("p"), "ms": I(616)}),
                    M({"hole": I(3), "got": S("d"), "ms": I(900)}),
                    M({"hole": I(0), "got": S("b"), "ms": I(899)})]),
        "solved": {"booleanValue": True}, "skipped": {"booleanValue": False},
        "puffs": I(2), "d": S(DEV), "r": S("r_zz1"), "t": I(1757000000001), "n": I(2)}
ROUND_END = {"k": S("round-end"), "words": I(4), "firstGo": I(2), "tricky": I(3),
             "fill": I(41), "popped": {"booleanValue": False},
             "d": S(DEV), "r": S("r_zz1"), "t": I(1757000000002), "n": I(3)}

fails = []
def check(name, got, want):
    ok = got == want
    print("  %-52s %s (%s)" % (name, "ok" if ok else "FAIL", got))
    if not ok: fails.append("%s: expected %s, got %s" % (name, want, got))

print("\nwhat the game actually sends:")
st, _ = commit([(DEV + "_1", ROUND_START), (DEV + "_2", WORD), (DEV + "_3", ROUND_END)])
check("a real round commits", st, 200)
check("three documents landed", count(), 3)

print("\nsending it twice does not duplicate it:")
st, _ = commit([(DEV + "_1", ROUND_START), (DEV + "_2", WORD), (DEV + "_3", ROUND_END)])
check("the retry is accepted", st, 200)
check("still three documents", count(), 3)

print("\nwhat a signed-in reader can and cannot do:")
# Republish the rules with one reader allowed, which is what the analytics
# page asks you to paste in once you have signed in.
READER = "a-reader-uid"
with_reader = re.sub(r"return \[[^\]]*\];",
                     'return ["%s"];' % READER, RULES, count=1)
assert with_reader != RULES, "readers() no longer looks the way this test expects"
st, _ = req("PUT", EMU + "/emulator/v1/projects/%s:securityRules" % PID,
            {"rules": {"files": [{"name": "firestore.rules", "content": with_reader}]}})
check("the rules still compile with a reader in them", st, 200)

check("the named reader can list the log",
      req("GET", BASE + "/logs?pageSize=5", token=signed_in_as(READER))[0], 200)
check("a different signed-in account cannot",
      req("GET", BASE + "/logs?pageSize=5", token=signed_in_as("somebody-else"))[0], 403)
# Reading is the privilege being granted here; writing was already open to
# anyone with the public key, and being signed in neither adds nor removes
# that. What matters is that it still goes through the same shape checks.
check("a reader writing is still shape-checked",
      req("POST", BASE + ":commit", {"writes": [{"update": {
          "name": "projects/%s/databases/(default)/documents/logs/wrong-id" % PID,
          "fields": ROUND_START}}]},
          token=signed_in_as(READER))[0], 403)
check("the reader still cannot delete",
      req("DELETE", BASE + "/logs/" + DEV + "_1", token=signed_in_as(READER))[0], 403)

# Back to the shipped rules - readers() empty - for the rest.
st, _ = req("PUT", EMU + "/emulator/v1/projects/%s:securityRules" % PID,
            {"rules": {"files": [{"name": "firestore.rules", "content": RULES}]}})
check("the shipped rules reload", st, 200)
check("an account not on the list cannot read, even signed in",
      req("GET", BASE + "/logs?pageSize=5", token=signed_in_as(READER))[0], 403)

# And the list as it actually ships: whoever is really named in it can read.
# This is the check that says the line pasted into the console works, rather
# than that some invented uid works.
shipped = re.findall(r'return \[([^\]]*)\];', RULES)
named = re.findall(r'"([^"]+)"', shipped[0] if shipped else "")
if named:
    for uid in named:
        check("the reader named in firestore.rules can read (%s…)" % uid[:8],
              req("GET", BASE + "/logs?pageSize=5", token=signed_in_as(uid))[0], 200)
else:
    print("  %-52s %s" % ("readers() is empty, so nobody can read", "(by design)"))

print("\nwhat the key must not be able to do:")
check("read one back",  req("GET", BASE + "/logs/" + DEV + "_1")[0], 403)
check("list the collection", req("GET", BASE + "/logs")[0], 403)
check("delete one", req("DELETE", BASE + "/logs/" + DEV + "_1")[0], 403)
check("write outside logs", req("POST",
      BASE.replace("/documents", "/documents") + ":commit",
      {"writes": [{"update": {"name": "projects/%s/databases/(default)/documents/other/x" % PID,
                              "fields": {"a": S("b")}}}]})[0], 403)

print("\njunk is refused:")
bad = dict(ROUND_START)
check("an id that does not match the record", commit([("somethingelse", bad)])[0], 403)
no_d = {k: v for k, v in ROUND_START.items() if k != "d"}
check("no device id", commit([(DEV + "_9", no_d)])[0], 403)
no_n = {k: v for k, v in ROUND_START.items() if k != "n"}
check("no sequence number", commit([(DEV + "_9", no_n)])[0], 403)
future = dict(ROUND_START); future["t"] = I(99999999999999)
check("a timestamp years in the future", commit([(DEV + "_1", future)])[0], 403)
wordy = dict(WORD); wordy["w"] = S("x" * 400)
check("a 400 character word", commit([(DEV + "_2", wordy)])[0], 403)
spam = dict(WORD)
spam["tries"] = L([M({"hole": I(0), "got": S("b"), "ms": I(5)})] * 400)
check("400 attempts on one word", commit([(DEV + "_2", spam)])[0], 403)
fat = dict(ROUND_START)
for i in range(20): fat["x%d" % i] = S("y")
check("a record with twenty extra fields", commit([(DEV + "_1", fat)])[0], 403)

print("\nan iPad that queued for a week still gets in:")
old = dict(ROUND_START); old["t"] = I(1757000000000 - 7 * 86400000); old["n"] = I(4)
check("a week-old record", commit([(DEV + "_4", old)])[0], 200)

print()
print("ERRORS: none" if not fails else "ERRORS:\n  " + "\n  ".join(fails))
sys.exit(1 if fails else 0)
