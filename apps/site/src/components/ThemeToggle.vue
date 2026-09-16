<script setup lang="ts">
import { Moon, Sun } from "@lucide/vue";
import { onMounted, ref } from "vue";

const dark = ref(false);

onMounted(() => {
  dark.value = document.documentElement.classList.contains("dark");
});

function toggle() {
  dark.value = !dark.value;
  document.documentElement.classList.toggle("dark", dark.value);
  try {
    localStorage.setItem("junctio-theme", dark.value ? "dark" : "light");
  } catch {}
}
</script>

<template>
  <button
    type="button"
    class="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    :aria-label="dark ? 'Switch to light theme' : 'Switch to dark theme'"
    @click="toggle"
  >
    <Sun v-if="dark" class="size-4" />
    <Moon v-else class="size-4" />
  </button>
</template>
