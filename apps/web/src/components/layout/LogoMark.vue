<script setup lang="ts">
import { useId } from "vue";

const gradientId = useId();
</script>

<template>
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6366f1" />
        <stop offset="1" stop-color="#06b6d4" />
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="7" :fill="`url(#${gradientId})`" />
    <g
      transform="translate(2.5 2.5) scale(1.083)"
      stroke="#fff"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4.35 12h3" />
      <path d="M11.7 12H19" />
      <path d="M11.7 12c3.2 0 4.7-6.5 7.3-6.5" />
      <path d="M11.7 12c3.2 0 4.7 6.5 7.3 6.5" />
      <circle cx="2.75" cy="12" r="1.6" fill="#fff" stroke="none" />
      <circle cx="9.5" cy="12" r="2.2" fill="#fff" stroke="none" />
      <circle cx="20.6" cy="5.5" r="1.6" fill="#fff" stroke="none" />
      <circle cx="20.6" cy="12" r="1.6" fill="#fff" stroke="none" />
      <circle cx="20.6" cy="18.5" r="1.6" fill="#fff" stroke="none" />
    </g>
  </svg>
</template>
