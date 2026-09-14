<script setup lang="ts" generic="T extends string">
import { Check, ChevronsUpDown } from "@lucide/vue";
import { computed, ref } from "vue";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  hint?: string;
  mono?: boolean;
}

const props = withDefaults(
  defineProps<{
    options: SelectOption<T>[];
    placeholder?: string;
    searchPlaceholder?: string;
    emptyText?: string;
    searchThreshold?: number;
    disabled?: boolean;
    triggerClass?: string;
    contentClass?: string;
  }>(),
  {
    placeholder: "Select…",
    searchPlaceholder: "Search…",
    emptyText: "Nothing found.",
    searchThreshold: 5
  }
);

const model = defineModel<T>({ required: true });
const open = ref(false);

const selected = computed(() => props.options.find((option) => option.value === model.value));
const searchable = computed(() => props.options.length > props.searchThreshold);

function pick(value: T) {
  model.value = value;
  open.value = false;
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        role="combobox"
        :aria-expanded="open"
        :disabled="disabled"
        :class="cn('w-full min-w-0 justify-between font-normal', triggerClass)"
      >
        <span :class="cn('min-w-0 truncate', selected?.mono && 'font-mono', !selected && 'text-muted-foreground')">
          {{ selected?.label ?? placeholder }}
        </span>
        <ChevronsUpDown class="ml-2 size-3.5 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent :class="cn('w-(--reka-popper-anchor-width) p-0', contentClass)" align="start">
      <Command>
        <CommandInput v-if="searchable" :placeholder="searchPlaceholder" />
        <CommandList>
          <CommandEmpty>{{ emptyText }}</CommandEmpty>
          <CommandGroup>
            <CommandItem
              v-for="option in options"
              :key="option.value"
              :value="option.value"
              class="gap-2"
              @select="pick(option.value)"
            >
              <Check :class="cn('size-3.5', model === option.value ? 'opacity-100' : 'opacity-0')" />
              <span class="flex min-w-0 flex-1 flex-col">
                <span :class="cn('truncate', option.mono && 'font-mono text-xs')">{{ option.label }}</span>
                <span v-if="option.hint" class="truncate text-xs text-muted-foreground">{{ option.hint }}</span>
              </span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
