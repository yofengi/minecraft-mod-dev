"""Exercise a client connected to a disposable local test server."""

import argparse
import json
import time
from pathlib import Path
from smoke_probe import request


def run(client_port, server_port, game_port, loader):
    status = request(client_port, "/status")
    assert status["side"] == "client" and status["loader"] == loader, status
    assert status["version"] == "26.1.2", status
    ui = request(client_port, "/ui/snapshot")
    assert status.get("player") or ui.get("screen"), ui
    shot = request(client_port, "/screenshot")
    assert shot["exists"] and Path(shot["path"]).stat().st_size > 0, shot
    request(client_port, f"/connect?host=127.0.0.1&port={game_port}")
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        status = request(client_port, "/status")
        if status.get("player"):
            break
        time.sleep(0.5)
    player = status.get("player")
    assert player, status

    def command(cmd):
        return request(server_port, "/command", {"cmd": cmd})

    command(f"clear {player}")
    command(f"give {player} minecraft:oak_log 1")
    craft = request(server_port, f"/craft?recipe=minecraft:oak_planks&player={player}")
    assert craft["crafted"] and craft["result"]["count"] == 4, craft
    request(client_port, "/player/inventory")
    ui = request(client_port, "/ui/snapshot")
    assert ui["slots"], ui
    request(client_port, "/ui/hover_slot?slot=36")
    request(client_port, "/ui/click", {"slot": 36, "button": 0})
    request(client_port, "/ui/click", {"slot": 36, "button": 0})
    request(client_port, "/ui/close", {})
    command(f"gamemode survival {player}")
    command("forceload add 0 0")
    command("fill -2 98 -2 2 98 2 minecraft:stone")
    command("setblock 0 99 0 minecraft:stone")
    command(f"tp {player} 0.5 99 2.5 180 0")
    command(f"item replace entity {player} weapon.mainhand with minecraft:diamond_pickaxe")
    time.sleep(1)
    mining = request(client_port, "/player/mine?x=0&y=99&z=0&timeoutMs=8000")
    assert mining["broken"], mining
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        block = request(server_port, "/world/block?x=0&y=99&z=0")
        if block["block"] == "minecraft:air":
            break
        time.sleep(0.05)
    assert block["block"] == "minecraft:air", block
    shot = request(client_port, "/screenshot")
    assert shot["exists"] and shot["size"] > 0, shot
    print(json.dumps({"ok": True, "loader": loader, "player": player, "screenshot": shot["path"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--client-port", type=int, default=39002)
    parser.add_argument("--server-port", type=int, default=39001)
    parser.add_argument("--game-port", type=int, default=25566)
    parser.add_argument("--loader", required=True, choices=["forge", "neoforge"])
    args = parser.parse_args()
    run(args.client_port, args.server_port, args.game_port, args.loader)
