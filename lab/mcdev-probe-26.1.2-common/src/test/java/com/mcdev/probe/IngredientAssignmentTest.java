package com.mcdev.probe;

import java.util.Arrays;

public final class IngredientAssignmentTest {
    public static void main(String[] args) throws Exception {
        overlappingIngredientsUseTheSpecificStack();
        matchingBacktracksAcrossOverlappingGroups();
        repeatedIngredientsRespectStackCounts();
        missingIngredientsLeaveCountsUnchanged();
        craftingGridBoundsAreEnforced();
        System.out.println("IngredientAssignmentTest passed");
    }

    private static void overlappingIngredientsUseTheSpecificStack() throws Exception {
        int[] result = find(new boolean[][] {{true, true}, {true, false}}, new int[] {1, 1});
        check(Arrays.equals(result, new int[] {1, 0}), "reserve oak for the oak-only ingredient");
    }

    private static void matchingBacktracksAcrossOverlappingGroups() throws Exception {
        int[] result = find(new boolean[][] {
                {true, true, false}, {true, false, true}, {true, false, true}
        }, new int[] {1, 1, 1});
        check(result != null && result[0] == 1 && result[1] != result[2], "retry an initially valid choice");
    }

    private static void repeatedIngredientsRespectStackCounts() throws Exception {
        int[] counts = {2, 1};
        int[] result = find(new boolean[][] {{true, true}, {true, false}, {true, false}}, counts);
        check(Arrays.equals(result, new int[] {1, 0, 0}), "use each stack at most its count");
        check(Arrays.equals(counts, new int[] {2, 1}), "successful matching preserves counts");
    }

    private static void missingIngredientsLeaveCountsUnchanged() throws Exception {
        int[] counts = {1, 1, 4};
        int[] result = find(new boolean[][] {
                {true, true, false}, {true, true, false}, {true, true, false}
        }, counts);
        check(result == null, "reject insufficient compatible inventory");
        check(Arrays.equals(counts, new int[] {1, 1, 4}), "failed matching preserves counts");
    }

    private static void craftingGridBoundsAreEnforced() throws Exception {
        check(find(new boolean[10][1], new int[] {10}) == null, "reject more than nine ingredients");
        check(find(new boolean[1][37], new int[37]) == null, "reject more than 36 inventory slots");
    }

    private static int[] find(boolean[][] matches, int[] counts) {
        return IngredientAssignment.find(matches, counts);
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
