import { computed, type ComputedRef, type Ref } from "vue";
import { useRoute } from "vue-router";

export function useSelectedFromRoute<T extends { id: string }>(
  items: Ref<T[]>,
  param = "id"
): { selectedId: ComputedRef<string | null>; current: ComputedRef<T | null> } {
  const route = useRoute();

  const selectedId = computed(() => {
    const value = route.params[param];
    const wanted = typeof value === "string" ? value : null;
    if (wanted && items.value.some((item) => item.id === wanted)) return wanted;
    return items.value[0]?.id ?? null;
  });

  const current = computed(() => items.value.find((item) => item.id === selectedId.value) ?? null);

  return { selectedId, current };
}
