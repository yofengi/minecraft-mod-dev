package com.mcdev.probe;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.ConnectScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.TitleScreen;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.client.multiplayer.resolver.ServerAddress;
import net.minecraft.client.player.LocalPlayer;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.inventory.ContainerInput;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;
import net.minecraft.core.registries.BuiltInRegistries;
import org.lwjgl.glfw.GLFW;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Callable;

public final class ClientProbeServer {
    private static final Gson GSON = new Gson();
    private static HttpServer server;
    private static ExecutorService executor;
    private static String token = "mcdev";
    private static MiningSession activeMining;

    private ClientProbeServer() {
    }

    public static synchronized void start(int port, String tokenIn) {
        if (server != null) {
            return;
        }
        token = tokenIn == null ? "" : tokenIn;
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
            register("/status", ClientProbeServer::handleStatus);
            register("/connect", ClientProbeServer::handleConnect);
            register("/log/tail", ClientProbeServer::handleLogTail);
            register("/ui/snapshot", ClientProbeServer::handleUiSnapshot);
            register("/ui/click", ClientProbeServer::handleUiClick);
            register("/ui/close", ClientProbeServer::handleUiClose);
            register("/ui/hover", ClientProbeServer::handleUiHover);
            register("/ui/hover_slot", ClientProbeServer::handleUiHoverSlot);
            register("/player/inventory", ClientProbeServer::handlePlayerInventory);
            register("/command", ClientProbeServer::handleCommand);
            register("/player/use", ClientProbeServer::handlePlayerUse);
            register("/player/use_item", ClientProbeServer::handlePlayerUseItem);
            register("/player/break", ClientProbeServer::handlePlayerBreak);
            register("/player/mine", ClientProbeServer::handlePlayerMine);
            register("/item/mainhand", ClientProbeServer::handleMainhandItem);
            register("/screenshot", ClientProbeServer::handleScreenshot);
            register("/quit", ClientProbeServer::handleQuit);
            executor = Executors.newFixedThreadPool(2);
            server.setExecutor(executor);
            server.start();
            McdevProbe.LOGGER.info("Mcdev Client Probe listening on 127.0.0.1:{}", port);
        } catch (IOException e) {
            McdevProbe.LOGGER.error("Failed to start Mcdev Client Probe", e);
        }
    }

    public static synchronized void stop() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
        if (executor != null) {
            executor.shutdownNow();
            executor = null;
        }
    }

    private static void handleConnect(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        String host = strQuery(ex, "host", "127.0.0.1");
        int port = intQuery(ex, "port", 25566);
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("host", host);
                d.put("port", port);
                if (mc.player != null) {
                    d.put("alreadyInWorld", true);
                    return d;
                }
                if (mc.screen != null && mc.screen.getClass().getName().contains("AccessibilityOnboarding")) {
                    mc.setScreen(new TitleScreen());
                }
                ConnectScreen.startConnecting(new TitleScreen(), mc,
                        new ServerAddress(host, port),
                        new ServerData("mcdev", host + ":" + port, ServerData.Type.OTHER), false, null);
                d.put("connecting", true);
                d.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "connect failed: " + e.getMessage());
        }
    }

    private static void handleStatus(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("side", "client");
                d.put("version", net.minecraft.SharedConstants.getCurrentVersion().name());
                d.put("loader", McdevProbe.loader());
                d.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
                d.put("title", mc.screen == null ? null : mc.screen.getTitle().getString());
                d.put("fps", mc.getFps());
                d.put("width", mc.getWindow().getGuiScaledWidth());
                d.put("height", mc.getWindow().getGuiScaledHeight());
                d.put("player", mc.player == null ? null : mc.player.getName().getString());
                d.put("dimension", mc.level == null ? null
                        : mc.level.dimension().identifier().toString());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "status failed: " + e.getMessage());
        }
    }

    private static void handleLogTail(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        int n = intQuery(ex, "n", 100);
        JsonObject data = new JsonObject();
        data.add("lines", ProbeLogs.tail(n));
        ok(ex, data);
    }

    private static void handleUiSnapshot(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Screen screen = mc.screen;
                Map<String, Object> d = new LinkedHashMap<>();
                if (screen == null) {
                    d.put("screen", null);
                    return d;
                }
                d.put("screen", screen.getClass().getName());
                d.put("title", screen.getTitle().getString());
                List<Map<String, Object>> widgets = new ArrayList<>();
                for (GuiEventListener listener : screen.children()) {
                    if (listener instanceof AbstractWidget w) {
                        Map<String, Object> o = new LinkedHashMap<>();
                        o.put("class", w.getClass().getName());
                        o.put("x", w.getX());
                        o.put("y", w.getY());
                        o.put("width", w.getWidth());
                        o.put("height", w.getHeight());
                        o.put("message", w.getMessage().getString());
                        o.put("active", w.isActive());
                        o.put("visible", w.visible);
                        widgets.add(o);
                    }
                }
                d.put("widgets", widgets);
                if (screen instanceof AbstractContainerScreen<?> c) {
                    List<Map<String, Object>> slots = new ArrayList<>();
                    for (Slot s : c.getMenu().slots) {
                        Map<String, Object> o = new LinkedHashMap<>();
                        o.put("index", s.index);
                        o.put("x", s.x);
                        o.put("y", s.y);
                        o.put("screenX", ScreenAccess.left(c) + s.x + 8);
                        o.put("screenY", ScreenAccess.top(c) + s.y + 8);
                        o.put("item", s.getItem().isEmpty() ? null
                                : s.getItem().getHoverName().getString());
                        o.put("count", s.getItem().getCount());
                        slots.add(o);
                    }
                    d.put("slots", slots);
                    d.put("guiLeft", ScreenAccess.left(c));
                    d.put("guiTop", ScreenAccess.top(c));
                }
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "ui snapshot failed: " + e.getMessage());
        }
    }

    private static void handleUiClick(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            error(ex, 405, "POST required");
            return;
        }
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        final int x;
        final int y;
        final int button;
        final int slot;
        final boolean shift;
        try {
            JsonObject obj = JsonParser.parseString(body).getAsJsonObject();
            x = obj.has("x") ? obj.get("x").getAsInt() : 0;
            y = obj.has("y") ? obj.get("y").getAsInt() : 0;
            button = obj.has("button") ? obj.get("button").getAsInt() : 0;
            slot = obj.has("slot") ? obj.get("slot").getAsInt() : -1;
            shift = obj.has("shift") && obj.get("shift").getAsBoolean();
        } catch (Exception e) {
            error(ex, 400, "invalid json: " + e.getMessage());
            return;
        }
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Screen screen = mc.screen;
                Map<String, Object> d = new LinkedHashMap<>();
                if (screen == null) {
                    d.put("clicked", false);
                    d.put("reason", "no screen");
                    return d;
                }
                if (slot >= 0 && screen instanceof AbstractContainerScreen<?> c) {
                    if (slot >= c.getMenu().slots.size()) {
                        d.put("clicked", false);
                        d.put("reason", "slot out of range");
                        return d;
                    }
                    Slot s = c.getMenu().slots.get(slot);
                    int sx = ScreenAccess.left(c) + s.x + 8;
                    int sy = ScreenAccess.top(c) + s.y + 8;
                    if (shift) {
                        mc.gameMode.handleContainerInput(
                                c.getMenu().containerId, slot, button,
                                ContainerInput.QUICK_MOVE, mc.player);
                    } else {
                        screen.mouseClicked(mouseEvent(sx, sy, button), false);
                        screen.mouseReleased(mouseEvent(sx, sy, button));
                    }
                    d.put("clicked", true);
                    d.put("slot", slot);
                    d.put("x", sx);
                    d.put("y", sy);
                    d.put("shift", shift);
                    return d;
                }
                screen.mouseClicked(mouseEvent(x, y, button), false);
                screen.mouseReleased(mouseEvent(x, y, button));
                d.put("clicked", true);
                d.put("x", x);
                d.put("y", y);
                d.put("button", button);
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "ui click failed: " + e.getMessage());
        }
    }

    private static void handleUiClose(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            error(ex, 405, "POST required");
            return;
        }
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                if (mc.player == null) {
                    d.put("closed", false);
                    d.put("reason", "no player");
                    return d;
                }
                mc.player.closeContainer();
                mc.setScreen(null);
                d.put("closed", true);
                d.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "ui close failed: " + e.getMessage());
        }
    }

    private static void handleUiHover(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        int x = intQuery(ex, "x", 0);
        int y = intQuery(ex, "y", 0);
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("x", x);
                d.put("y", y);
                if (mc.screen == null) {
                    d.put("hovered", false);
                    d.put("error", "no screen");
                    return d;
                }
                mc.screen.mouseMoved(x, y);
                d.put("hovered", true);
                d.put("screen", mc.screen.getClass().getName());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "ui hover failed: " + e.getMessage());
        }
    }

    private static void handleUiHoverSlot(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        int slotIndex = intQuery(ex, "slot", 0);
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("slot", slotIndex);
                if (!(mc.screen instanceof AbstractContainerScreen<?> screen)) {
                    d.put("hovered", false);
                    d.put("error", "not a container screen");
                    return d;
                }
                if (slotIndex < 0 || slotIndex >= screen.getMenu().slots.size()) {
                    d.put("hovered", false);
                    d.put("error", "slot out of range");
                    return d;
                }
                Slot slot = screen.getMenu().slots.get(slotIndex);
                Field field = AbstractContainerScreen.class.getDeclaredField("hoveredSlot");
                field.setAccessible(true);
                field.set(screen, slot);
                double guiX = ScreenAccess.left(screen) + slot.x + 8;
                double guiY = ScreenAccess.top(screen) + slot.y + 8;
                double scale = mc.getWindow().getGuiScale();
                GLFW.glfwSetCursorPos(mc.getWindow().handle(), guiX * scale, guiY * scale);
                screen.mouseMoved(guiX, guiY);
                d.put("hovered", true);
                d.put("item", slot.getItem().isEmpty()
                        ? null : String.valueOf(BuiltInRegistries.ITEM.getKey(slot.getItem().getItem())));
                d.put("count", slot.getItem().getCount());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "hover slot failed: " + e.getMessage());
        }
    }

    private static void handlePlayerInventory(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                if (mc.player == null) {
                    d.put("opened", false);
                    d.put("error", "player not in world");
                    return d;
                }
                mc.setScreen(new InventoryScreen(mc.player));
                d.put("opened", true);
                d.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "open inventory failed: " + e.getMessage());
        }
    }

    private static void handleCommand(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            error(ex, 405, "POST required");
            return;
        }
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        String cmd;
        try {
            JsonObject obj = JsonParser.parseString(body).getAsJsonObject();
            cmd = obj.get("cmd").getAsString();
        } catch (Exception e) {
            error(ex, 400, "invalid json: " + e.getMessage());
            return;
        }
        if (cmd.startsWith("/")) {
            cmd = cmd.substring(1);
        }
        final String command = cmd;
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                if (mc.player == null) {
                    d.put("sent", false);
                    d.put("reason", "no player");
                    return d;
                }
                mc.player.connection.sendCommand(command);
                d.put("sent", true);
                d.put("cmd", command);
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "command failed: " + e.getMessage());
        }
    }

    private static void handlePlayerUse(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            error(ex, 405, "POST required");
            return;
        }
        String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        final int x;
        final int y;
        final int z;
        String faceName = "up";
        try {
            JsonObject obj = JsonParser.parseString(body).getAsJsonObject();
            x = obj.get("x").getAsInt();
            y = obj.get("y").getAsInt();
            z = obj.get("z").getAsInt();
            if (obj.has("face")) {
                faceName = obj.get("face").getAsString();
            }
        } catch (Exception e) {
            error(ex, 400, "invalid json: " + e.getMessage());
            return;
        }
        Direction parsed = Direction.byName(faceName);
        final Direction face = parsed == null ? Direction.UP : parsed;
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                if (mc.player == null) {
                    d.put("used", false);
                    d.put("reason", "no player");
                    return d;
                }
                BlockPos pos = new BlockPos(x, y, z);
                BlockHitResult hit = new BlockHitResult(
                        Vec3.atCenterOf(pos), face, pos, false);
                InteractionResult result = mc.gameMode.useItemOn(
                        mc.player, InteractionHand.MAIN_HAND, hit);
                d.put("used", true);
                d.put("result", result.toString());
                d.put("pos", x + "," + y + "," + z);
                d.put("face", face.getName());
                d.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "use failed: " + e.getMessage());
        }
    }

    private static void handlePlayerUseItem(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        if (!"POST".equalsIgnoreCase(ex.getRequestMethod())) {
            error(ex, 405, "POST required");
            return;
        }
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                if (mc.player == null) {
                    d.put("used", false);
                    d.put("reason", "no player");
                    return d;
                }
                InteractionResult result = mc.gameMode.useItem(
                        mc.player, InteractionHand.MAIN_HAND);
                d.put("used", true);
                d.put("result", result.toString());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "use item failed: " + e.getMessage());
        }
    }

    private static void handlePlayerBreak(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        int x = intQuery(ex, "x", 0);
        int y = intQuery(ex, "y", 64);
        int z = intQuery(ex, "z", 0);
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                if (mc.player == null || mc.level == null || mc.gameMode == null) {
                    d.put("ok", false);
                    d.put("error", "player not in world");
                    return d;
                }
                BlockPos pos = new BlockPos(x, y, z);
                d.put("pos", x + "," + y + "," + z);
                d.put("before", String.valueOf(BuiltInRegistries.BLOCK.getKey(mc.level.getBlockState(pos).getBlock())));
                d.put("started", mc.gameMode.startDestroyBlock(pos, Direction.UP));
                boolean continued = false;
                for (int i = 0; i < 10; i++) {
                    continued = mc.gameMode.continueDestroyBlock(pos, Direction.UP);
                }
                mc.gameMode.stopDestroyBlock();
                d.put("continued", continued);
                d.put("after", String.valueOf(BuiltInRegistries.BLOCK.getKey(mc.level.getBlockState(pos).getBlock())));
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "player break failed: " + e.getMessage());
        }
    }

    private static void handlePlayerMine(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        int x = intQuery(ex, "x", 0);
        int y = intQuery(ex, "y", 64);
        int z = intQuery(ex, "z", 0);
        int timeoutMs = Math.min(15000, Math.max(1000, intQuery(ex, "timeoutMs", 6000)));
        BlockPos pos = new BlockPos(x, y, z);
        MiningSession session = null;
        try {
            session = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                if (mc.player == null || mc.level == null || mc.gameMode == null || mc.getConnection() == null) {
                    return null;
                }
                if (activeMining != null) throw new IllegalStateException("another mining request is active");
                MiningSession started = new MiningSession(mc, pos);
                activeMining = started;
                return started;
            });
            if (session == null) {
                error(ex, 409, "player not in world");
                return;
            }
            MiningSession current = session;
            long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
            while (System.nanoTime() < deadline && !onClient(current::advance)) {
                Thread.sleep(50L);
            }
            ok(ex, onClient(current::finish));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (Exception e) {
            error(ex, 500, "player mine failed: " + e.getMessage());
        } finally {
            if (session != null) {
                MiningSession current = session;
                Minecraft.getInstance().execute(current::cancel);
            }
        }
    }

    private static final class MiningSession {
        private final Minecraft mc;
        private final ClientLevel level;
        private final LocalPlayer player;
        private final MultiPlayerGameMode gameMode;
        private final ClientPacketListener connection;
        private final BlockPos pos;
        private final Screen previousScreen;
        private final Screen miningScreen = new MiningScreen();
        private final boolean attackWasDown;
        private final Map<String, Object> data = new LinkedHashMap<>();
        private long lastTick = Long.MIN_VALUE;
        private int ticks;
        private boolean started;
        private boolean done;

        MiningSession(Minecraft mc, BlockPos pos) {
            this.mc = mc;
            this.level = mc.level;
            this.player = mc.player;
            this.gameMode = mc.gameMode;
            this.connection = mc.getConnection();
            this.pos = pos;
            this.previousScreen = mc.screen;
            this.attackWasDown = mc.options.keyAttack.isDown();
            data.put("pos", pos.getX() + "," + pos.getY() + "," + pos.getZ());
            data.put("before", blockId());
            data.put("after", blockId());
            data.put("connection", true);
            data.put("broken", false);
            snapshot();
            mc.setScreen(miningScreen);
        }

        private boolean isCurrent() {
            return mc.level == level && mc.player == player && mc.gameMode == gameMode
                    && mc.getConnection() == connection;
        }

        boolean advance() {
            if (done) return true;
            if (!isCurrent()) {
                data.put("error", "world or connection changed while mining");
                done = true;
                return true;
            }
            if (mc.screen != miningScreen) {
                data.put("error", "mining was cancelled by a screen change");
                done = true;
                return true;
            }
            if (!level.getBlockState(pos).isAir() && level.getGameTime() != lastTick) {
                lastTick = level.getGameTime();
                ticks++;
                if (!started) {
                    started = true;
                    if (!gameMode.startDestroyBlock(pos, Direction.UP)) {
                        data.put("error", "mining was rejected");
                        done = true;
                    }
                } else {
                    gameMode.continueDestroyBlock(pos, Direction.UP);
                }
            }
            if (level.getBlockState(pos).isAir()) {
                data.put("broken", true);
                done = true;
            }
            data.put("after", blockId());
            return done;
        }

        Map<String, Object> finish() {
            if (isCurrent()) {
                data.put("after", blockId());
                data.put("broken", level.getBlockState(pos).isAir());
                snapshot();
            } else {
                data.put("error", "world or connection changed while mining");
            }
            if (!done && !Boolean.TRUE.equals(data.get("broken"))) data.put("error", "mining timed out");
            data.put("ticks", ticks);
            cancel();
            data.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
            return data;
        }

        void cancel() {
            if (activeMining != this) return;
            try {
                if (started && isCurrent()) gameMode.stopDestroyBlock();
            } finally {
                activeMining = null;
                done = true;
                if (isCurrent()) {
                    if (mc.screen == miningScreen) mc.setScreen(previousScreen);
                    mc.options.keyAttack.setDown(attackWasDown);
                }
            }
        }

        private String blockId() {
            return BuiltInRegistries.BLOCK.getKey(level.getBlockState(pos).getBlock()).toString();
        }

        private void snapshot() {
            data.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
            data.put("playerCreative", player.isCreative());
            data.put("localMode", gameMode.getPlayerMode().getName());
            data.put("hitType", mc.hitResult == null ? null : mc.hitResult.getType().name());
            data.put("hitPos", mc.hitResult instanceof BlockHitResult hit ? hit.getBlockPos().toShortString() : null);
            data.put("playerPos", player.blockPosition().toShortString());
            data.put("look", player.getYRot() + "/" + player.getXRot());
        }
    }

    private static final class MiningScreen extends Screen {
        MiningScreen() { super(Component.literal("Mcdev mining")); }

        @Override
        public boolean isPauseScreen() { return false; }
    }

    private static void handleMainhandItem(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        try {
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                Map<String, Object> d = new LinkedHashMap<>();
                if (mc.player == null) {
                    d.put("found", false);
                    return d;
                }
                ItemStack stack = mc.player.getMainHandItem();
                d.put("found", true);
                d.put("item", stack.isEmpty() ? null
                        : String.valueOf(BuiltInRegistries.ITEM.getKey(stack.getItem())));
                d.put("nbt", stack.getComponentsPatch().toString());
                d.put("count", stack.getCount());
                d.put("barVisible", stack.isBarVisible());
                d.put("barWidth", stack.getBarWidth());
                d.put("barColor", stack.getBarColor());
                return d;
            });
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "mainhand item query failed: " + e.getMessage());
        }
    }

    private static void handleScreenshot(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        try {
            CompletableFuture<Void> captured = new CompletableFuture<>();
            Map<String, Object> data = onClient(() -> {
                Minecraft mc = Minecraft.getInstance();
                String name = "mcdev-" + System.currentTimeMillis() + ".png";
                Screenshot.grab(mc.gameDirectory, name, mc.getMainRenderTarget(), 1,
                        c -> captured.complete(null));
                java.nio.file.Path path = new File(
                        new File(mc.gameDirectory, "screenshots"), name)
                        .toPath().toAbsolutePath().normalize();
                Map<String, Object> d = new LinkedHashMap<>();
                d.put("path", path.toString());
                d.put("screen", mc.screen == null ? null : mc.screen.getClass().getName());
                d.put("width", mc.getWindow().getWidth());
                d.put("height", mc.getWindow().getHeight());
                return d;
            });
            java.nio.file.Path path = java.nio.file.Path.of((String) data.get("path"));
            captured.get(10, TimeUnit.SECONDS);
            data.put("exists", java.nio.file.Files.isRegularFile(path));
            data.put("size", java.nio.file.Files.isRegularFile(path)
                    ? java.nio.file.Files.size(path) : 0L);
            ok(ex, data);
        } catch (Exception e) {
            error(ex, 500, "screenshot failed: " + e.getMessage());
        }
    }

    private static void handleQuit(HttpExchange ex) throws IOException {
        if (!authorized(ex)) {
            return;
        }
        ok(ex, Map.of("quitting", true));
        Minecraft.getInstance().execute(() -> Minecraft.getInstance().stop());
    }

    private static net.minecraft.client.input.MouseButtonEvent mouseEvent(double x, double y, int button) {
        return new net.minecraft.client.input.MouseButtonEvent(x, y,
                new net.minecraft.client.input.MouseButtonInfo(button, 0));
    }

    private static <T> T onClient(Callable<T> task) throws Exception {
        CompletableFuture<T> future = new CompletableFuture<>();
        Minecraft.getInstance().execute(() -> {
            try {
                future.complete(task.call());
            } catch (Throwable t) {
                future.completeExceptionally(t);
            }
        });
        return future.get(10, TimeUnit.SECONDS);
    }

    private static void register(String path, HttpHandler handler) {
        server.createContext(path, ex -> {
            try {
                handler.handle(ex);
            } catch (IllegalArgumentException e) {
                error(ex, 400, "invalid request: " + e.getMessage());
            }
        });
    }
    private static boolean authorized(HttpExchange ex) throws IOException {
        if (token.isEmpty()) {
            return true;
        }
        String got = ex.getRequestHeaders().getFirst("X-Mcdev-Token");
        if (token.equals(got)) {
            return true;
        }
        error(ex, 401, "invalid token");
        return false;
    }

    private static void ok(HttpExchange ex, Object data) throws IOException {
        JsonObject root = new JsonObject();
        root.addProperty("ok", true);
        root.add("data", GSON.toJsonTree(data));
        send(ex, 200, root);
    }

    private static void error(HttpExchange ex, int code, String message) throws IOException {
        JsonObject root = new JsonObject();
        root.addProperty("ok", false);
        JsonObject err = new JsonObject();
        err.addProperty("message", message);
        root.add("error", err);
        send(ex, code, root);
    }

    private static void send(HttpExchange ex, int code, JsonObject body) throws IOException {
        byte[] bytes = GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }

    private static int intQuery(HttpExchange ex, String key, int def) {
        String raw = strQuery(ex, key, null);
        if (raw == null) {
            return def;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            return def;
        }
    }

    private static String strQuery(HttpExchange ex, String key, String def) {
        String query = ex.getRequestURI().getRawQuery();
        if (query == null || query.isEmpty()) {
            return def;
        }
        for (String part : query.split("&")) {
            int eq = part.indexOf('=');
            if (eq < 0) {
                continue;
            }
            String k = URLDecoder.decode(part.substring(0, eq), StandardCharsets.UTF_8);
            if (k.equals(key)) {
                return URLDecoder.decode(part.substring(eq + 1), StandardCharsets.UTF_8);
            }
        }
        return def;
    }
}
