"""Exercise a probe in a disposable test world."""

import argparse
import json
import time
import urllib.error
import urllib.request
import urllib.parse


def request(port, path, body=None, token="mcdev"):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data,
        headers={"X-Mcdev-Token": token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = json.load(response)
    assert payload["ok"], payload
    return payload["data"]


def run(port, loader):
    status = request(port, "/status")
    assert status["side"] == "server", status
    assert status["version"] == "26.1.2", status
    assert status["loader"] == loader, status
    try:
        request(port, "/status", token="wrong")
        raise AssertionError("Invalid token accepted")
    except urllib.error.HTTPError as error:
        assert error.code == 401

    def command(cmd):
        return request(port, "/command", {"cmd": cmd})

    command("forceload add 0 0")
    command("setblock 0 100 0 minecraft:air")
    assert command("setblock 0 100 0 minecraft:stone")["result"] > 0
    block = request(port, "/world/block?x=0&y=100&z=0")
    assert block["block"] == "minecraft:stone", block
    assert command("not_a_valid_command")["result"] == 0
    recipe = request(port, "/recipe?id=minecraft:oak_planks")
    assert recipe["found"] and recipe["item"] == "minecraft:oak_planks", recipe
    assert recipe["count"] == 4, recipe
    assert not request(port, "/recipe?id=mcdev_probe:missing")["found"]
    assert not request(port, "/item?item=mcdev_probe:missing")["found"]
    item = request(port, "/item?item=minecraft:diamond_pickaxe&components=minecraft:damage=100")
    assert item["found"] and item["visible"], item
    assert 0 < item["width"] < 13, item
    components = urllib.parse.quote('minecraft:custom_data={label:"A&B+%"}')
    assert request(port, f"/item?item=minecraft:stick&components={components}")["found"]
    try:
        request(port, "/world/block?dim=mcdev_probe:missing")
        raise AssertionError("Unknown dimension accepted")
    except urllib.error.HTTPError as error:
        assert error.code in (400, 404)
    loot = request(port, "/loot?block=minecraft:oak_planks")
    assert loot["found"] and loot["total"] == 1, loot
    assert command("mcdev freeze true")["result"] > 0
    try:
        before = request(port, "/status")["gameTime"]
        time.sleep(0.2)
        assert request(port, "/status")["gameTime"] == before
        assert command("mcdev step 2")["result"] > 0
        time.sleep(0.3)
        assert request(port, "/status")["gameTime"] == before + 2
        command("mcdev step 10000")
        command("mcdev freeze false")
        command("mcdev freeze true")
        assert request(port, "/status")["stepBudget"] == 0
    finally:
        command("mcdev freeze false")
    assert request(port, "/run/dump?n=5")["path"]
    assert command("mcdev fakeplayer spawn ProbeTest")["result"] > 0
    assert command("mcdev fakeplayer use ProbeTest 0 100 0")["result"] > 0
    print(json.dumps({"ok": True, "loader": loader, "version": "26.1.2"}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=39001)
    parser.add_argument("--loader", choices=["forge", "neoforge"], required=True)
    args = parser.parse_args()
    run(args.port, args.loader)
