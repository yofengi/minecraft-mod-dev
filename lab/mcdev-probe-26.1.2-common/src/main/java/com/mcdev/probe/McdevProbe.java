package com.mcdev.probe;

import net.minecraft.server.MinecraftServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class McdevProbe {
    public static final String MODID = "mcdev_probe";
    public static final Logger LOGGER = LoggerFactory.getLogger(MODID);
    private static String loader;

    private McdevProbe() {}

    public static void initialize(String name) {
        loader = name;
        ProbeLogs.install();
    }

    public static String loader() { return loader; }

    public static void startServer(MinecraftServer server) {
        TickControl.bind(server);
        RunRecorder.start(server);
        ProbeServer.start(server, Integer.getInteger("mcdev.probe.port", 39001),
                System.getProperty("mcdev.probe.token", "mcdev"));
    }

    public static void stopServer() {
        ProbeServer.stop();
        RunRecorder.finish();
        TickControl.bind(null);
        FakePlayers.clear();
    }
}
