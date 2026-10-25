package com.mcdev.probe;

import net.minecraft.server.MinecraftServer;

public final class TickControl {
    private static MinecraftServer server;

    private TickControl() {}

    public static void bind(MinecraftServer value) { server = value; }
    public static boolean isFrozen() { return server.tickRateManager().isFrozen(); }
    public static int getStepBudget() { return server.tickRateManager().frozenTicksToRun(); }
    public static void setFrozen(boolean value) {
        server.tickRateManager().stopStepping();
        server.tickRateManager().setFrozen(value);
    }

    public static void step(int ticks) {
        setFrozen(true);
        server.tickRateManager().stepGameIfPaused(ticks);
    }
}
