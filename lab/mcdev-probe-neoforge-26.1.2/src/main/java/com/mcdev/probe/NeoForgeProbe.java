package com.mcdev.probe;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.event.lifecycle.FMLClientSetupEvent;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.common.util.FakePlayerFactory;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

@Mod(McdevProbe.MODID)
public final class NeoForgeProbe {
    public NeoForgeProbe(IEventBus modBus, Dist dist) {
        McdevProbe.initialize("neoforge");
        FakePlayers.factory = FakePlayerFactory::get;
        NeoForge.EVENT_BUS.addListener((RegisterCommandsEvent e) -> ProbeCommands.register(e.getDispatcher()));
        NeoForge.EVENT_BUS.addListener((ServerStartedEvent e) -> McdevProbe.startServer(e.getServer()));
        NeoForge.EVENT_BUS.addListener((ServerStoppingEvent e) -> McdevProbe.stopServer());
        if (dist == Dist.CLIENT) {
            modBus.addListener((FMLClientSetupEvent e) -> e.enqueueWork(() -> {
                ClientProbeServer.start(Integer.getInteger("mcdev.probe.client.port", 39002),
                        System.getProperty("mcdev.probe.token", "mcdev"));
                Runtime.getRuntime().addShutdownHook(new Thread(ClientProbeServer::stop));
            }));
        }
    }
}
