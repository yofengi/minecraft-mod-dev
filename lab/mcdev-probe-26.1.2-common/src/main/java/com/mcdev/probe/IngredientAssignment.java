package com.mcdev.probe;

import java.util.Arrays;

final class IngredientAssignment {
    private IngredientAssignment() {}

    static int[] find(boolean[][] matches, int[] counts) {
        if (matches.length > 9 || counts.length > 36) return null;
        for (boolean[] ingredient : matches) {
            if (ingredient.length != counts.length) return null;
        }
        int[] remaining = counts.clone();
        int[] selected = new int[matches.length];
        Arrays.fill(selected, -1);
        return assign(matches, remaining, selected, matches.length) ? selected : null;
    }

    private static boolean assign(boolean[][] matches, int[] remaining, int[] selected, int unassigned) {
        if (unassigned == 0) return true;
        int next = -1;
        int fewest = Integer.MAX_VALUE;
        boolean[] usable = new boolean[remaining.length];
        for (int ingredient = 0; ingredient < matches.length; ingredient++) {
            if (selected[ingredient] >= 0) continue;
            int candidates = 0;
            for (int slot = 0; slot < remaining.length; slot++) {
                if (remaining[slot] > 0 && matches[ingredient][slot]) {
                    candidates++;
                    usable[slot] = true;
                }
            }
            if (candidates == 0) return false;
            if (candidates < fewest) {
                next = ingredient;
                fewest = candidates;
            }
        }
        long available = 0;
        for (int slot = 0; slot < remaining.length; slot++) {
            if (usable[slot]) available += remaining[slot];
        }
        if (available < unassigned) return false;
        for (int slot = 0; slot < remaining.length; slot++) {
            if (remaining[slot] <= 0 || !matches[next][slot]) continue;
            selected[next] = slot;
            remaining[slot]--;
            if (assign(matches, remaining, selected, unassigned - 1)) return true;
            remaining[slot]++;
            selected[next] = -1;
        }
        return false;
    }
}
