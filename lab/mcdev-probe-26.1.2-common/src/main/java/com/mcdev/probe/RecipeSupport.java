package com.mcdev.probe;

import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.CraftingInput;
import net.minecraft.world.item.crafting.CraftingRecipe;
import net.minecraft.world.item.crafting.Ingredient;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.ShapedRecipe;
import net.minecraft.world.item.crafting.display.SlotDisplayContext;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class RecipeSupport {
    private RecipeSupport() {}

    public static ItemStack preview(Recipe<?> recipe, ServerLevel level) {
        return recipe.display().stream()
                .flatMap(d -> d.result().resolveForStacks(SlotDisplayContext.fromLevel(level)).stream())
                .findFirst().orElse(ItemStack.EMPTY);
    }

    public static Map<String, Object> craft(Recipe<?> recipe, ServerPlayer player) {
        if (!(recipe instanceof CraftingRecipe crafting) || recipe.placementInfo().isImpossibleToPlace()) {
            return Map.of("crafted", false, "error", "Only placeable crafting recipes are supported");
        }
        var inventory = player.getInventory().getNonEquipmentItems();
        var placement = recipe.placementInfo();
        int width = recipe instanceof ShapedRecipe shaped ? shaped.getWidth() : 3;
        int height = recipe instanceof ShapedRecipe shaped ? shaped.getHeight() : 3;
        if (width < 1 || width > 3 || height < 1 || height > 3
                || placement.slotsToIngredientIndex().size() > width * height) {
            return Map.of("crafted", false, "error", "Recipe exceeds a 3x3 crafting grid");
        }
        List<Ingredient> ingredients = new ArrayList<>();
        for (int index : placement.slotsToIngredientIndex()) {
            if (index >= 0) ingredients.add(placement.ingredients().get(index));
        }
        int inventorySize = Math.min(36, inventory.size());
        int[] counts = new int[inventorySize];
        boolean[][] matches = new boolean[ingredients.size()][inventorySize];
        for (int slot = 0; slot < inventorySize; slot++) {
            ItemStack stack = inventory.get(slot);
            counts[slot] = stack.getCount();
            for (int ingredient = 0; ingredient < ingredients.size(); ingredient++) {
                matches[ingredient][slot] = !stack.isEmpty() && ingredients.get(ingredient).test(stack);
            }
        }
        int[] selected = IngredientAssignment.find(matches, counts);
        if (selected == null) {
            return Map.of("crafted", false, "missing", ingredients.stream().map(Object::toString).toList(),
                    "consumed", List.of());
        }
        List<ItemStack> grid = new ArrayList<>();
        int ingredient = 0;
        for (int index : placement.slotsToIngredientIndex()) {
            grid.add(index < 0 ? ItemStack.EMPTY : inventory.get(selected[ingredient++]).copyWithCount(1));
        }
        while (grid.size() < width * height) grid.add(ItemStack.EMPTY);
        CraftingInput input = CraftingInput.of(width, height, grid);
        if (!crafting.matches(input, player.level())) {
            return Map.of("crafted", false, "error", "Selected ingredients do not match the recipe");
        }
        ItemStack output = crafting.assemble(input);
        if (output.isEmpty()) return Map.of("crafted", false, "error", "Recipe produced no output");
        var remainders = crafting.getRemainingItems(input);
        List<Map<String, Object>> consumed = new ArrayList<>();
        for (int slot : selected) {
            ItemStack stack = inventory.get(slot);
            consumed.add(Map.of("item", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(), "count", 1));
            stack.shrink(1);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("crafted", true);
        result.put("result", Map.of("item", BuiltInRegistries.ITEM.getKey(output.getItem()).toString(), "count", output.getCount()));
        result.put("consumed", consumed);
        result.put("missing", List.of());
        player.getInventory().placeItemBackInInventory(output);
        for (ItemStack remainder : remainders) {
            if (!remainder.isEmpty()) player.getInventory().placeItemBackInInventory(remainder);
        }
        player.containerMenu.broadcastChanges();
        return result;
    }
}
