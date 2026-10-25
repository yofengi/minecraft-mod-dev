package com.mcdev.probe;

import com.mojang.authlib.GameProfile;
import io.netty.channel.ChannelFutureListener;
import net.minecraft.network.Connection;
import net.minecraft.network.protocol.Packet;
import net.minecraft.network.protocol.PacketFlow;
import net.minecraft.server.level.ClientInformation;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.server.network.CommonListenerCookie;
import net.minecraft.server.network.ServerGamePacketListenerImpl;

final class ForgeProbePlayer {
    private ForgeProbePlayer() {}

    static ServerPlayer create(ServerLevel level, GameProfile profile) {
        var server = level.getServer();
        var player = new ServerPlayer(server, level, profile, ClientInformation.createDefault());
        var connection = new Connection(PacketFlow.SERVERBOUND) {
            @Override
            public void send(Packet<?> packet, ChannelFutureListener listener, boolean flush) {}
        };
        player.connection = new ServerGamePacketListenerImpl(server, connection, player,
                CommonListenerCookie.createInitial(profile, false));
        return player;
    }
}
