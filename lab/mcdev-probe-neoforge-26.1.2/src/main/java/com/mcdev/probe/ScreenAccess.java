package com.mcdev.probe;

import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;

final class ScreenAccess {
    private ScreenAccess() {}
    static int left(AbstractContainerScreen<?> screen) { return screen.getLeftPos(); }
    static int top(AbstractContainerScreen<?> screen) { return screen.getTopPos(); }
}
