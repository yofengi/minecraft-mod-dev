package com.mcdev.probe;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.event.lifecycle.FMLClientSetupEvent;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import net.minecraftforge.fml.loading.FMLEnvironment;

@Mod(McdevProbe.MODID)
public final class ForgeProbe {
    public ForgeProbe(FMLJavaModLoadingContext context) {
        McdevProbe.initialize("forge");
        FakePlayers.factory = ForgeProbePlayer::create;
        RegisterCommandsEvent.BUS.addListener(e -> ProbeCommands.register(e.getDispatcher()));
        ServerStartedEvent.BUS.addListener(e -> McdevProbe.startServer(e.getServer()));
        ServerStoppingEvent.BUS.addListener(e -> McdevProbe.stopServer());
        if (FMLEnvironment.dist == Dist.CLIENT) {
            FMLClientSetupEvent.getBus(context.getModBusGroup()).addListener(e -> e.enqueueWork(() -> {
                ClientProbeServer.start(Integer.getInteger("mcdev.probe.client.port", 39002),
                        System.getProperty("mcdev.probe.token", "mcdev"));
                Runtime.getRuntime().addShutdownHook(new Thread(ClientProbeServer::stop));
            }));
        }
    }
}
