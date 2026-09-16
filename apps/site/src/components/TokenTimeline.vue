<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const progress = ref(0);
const refreshedAt = 0.72;
let frame = 0;
let start = 0;
const duration = 7000;

function step(now: number) {
  if (!start) start = now;
  progress.value = ((now - start) % duration) / duration;
  frame = requestAnimationFrame(step);
}

onMounted(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    progress.value = refreshedAt;
    return;
  }
  frame = requestAnimationFrame(step);
});

onUnmounted(() => cancelAnimationFrame(frame));
</script>

<template>
  <div class="space-y-6">
    <div>
      <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Without a gateway</span>
        <span>the client sees the failure</span>
      </div>
      <div class="relative h-9 overflow-hidden rounded-md border bg-card">
        <div class="absolute inset-y-0 left-0 bg-muted" :style="{ width: `${Math.min(progress, 0.9) * 100}%` }"></div>
        <div class="absolute inset-y-0 border-l border-dashed border-destructive" style="left: 90%"></div>
        <div
          v-if="progress > 0.9"
          class="absolute inset-y-0 flex items-center bg-destructive/15 pl-2 text-[11px] font-medium text-destructive"
          style="left: 90%; right: 0"
        >
          401
        </div>
        <span class="absolute inset-y-0 left-2 flex items-center text-[11px] text-muted-foreground">token lifetime</span>
      </div>
    </div>
    <div>
      <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Behind Junctio</span>
        <span>refreshed on schedule</span>
      </div>
      <div class="relative h-9 overflow-hidden rounded-md border bg-card">
        <div
          class="absolute inset-y-0 left-0 bg-success/25"
          :style="{ width: `${(progress < refreshedAt ? progress : 1) * 100}%` }"
        ></div>
        <div
          v-if="progress >= refreshedAt"
          class="absolute inset-y-0 left-0 bg-success/40"
          :style="{ width: `${(progress - refreshedAt) / (1 - refreshedAt) * 100}%` }"
        ></div>
        <div class="absolute inset-y-0 border-l border-dashed border-destructive/50" style="left: 90%"></div>
        <div class="absolute inset-y-0 border-l-2 border-success" :style="{ left: `${refreshedAt * 100}%` }"></div>
        <span
          class="absolute top-1/2 -translate-y-1/2 rounded bg-success px-1.5 py-0.5 text-[10px] font-medium text-white transition-opacity"
          :class="progress >= refreshedAt ? 'opacity-100' : 'opacity-0'"
          :style="{ left: `calc(${refreshedAt * 100}% + 6px)` }"
        >
          refreshed
        </span>
        <span class="absolute inset-y-0 left-2 flex items-center text-[11px] text-muted-foreground">token lifetime</span>
      </div>
    </div>
  </div>
</template>
