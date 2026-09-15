<script setup lang="ts">
import { Check, Monitor, Moon, Sun } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { type ThemeMode, useTheme } from "@/lib/theme";

const { mode, resolved } = useTheme();

const OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "System", icon: Monitor }
];

function select(value: ThemeMode) {
  mode.value = value;
}
</script>

<template>
  <DropdownMenu>
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon-sm" aria-label="Change theme">
        <Sun v-if="resolved === 'light'" />
        <Moon v-else />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="min-w-36">
      <DropdownMenuItem v-for="option in OPTIONS" :key="option.value" @select="select(option.value)">
        <component :is="option.icon" />
        {{ option.label }}
        <Check v-if="mode === option.value" class="ml-auto size-4" />
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
