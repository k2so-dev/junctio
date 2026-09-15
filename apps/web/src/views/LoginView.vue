<script setup lang="ts">
import { Loader2 } from "@lucide/vue";
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import LogoMark from "@/components/layout/LogoMark.vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { safeInternalPath } from "@/lib/url";
import { useSession } from "@/stores/session";

const route = useRoute();
const router = useRouter();
const { session, login, setup } = useSession();

const password = ref("");
const confirmation = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

const isSetup = computed(() => session.value?.needsSetup ?? false);
const title = computed(() => (isSetup.value ? "Set an admin password" : "Sign in"));
const description = computed(() =>
  isSetup.value
    ? "This gateway has no password yet. Pick one — it is hashed with argon2id and stored locally."
    : "The password protects the admin UI and the REST API."
);

async function submit() {
  error.value = null;
  if (isSetup.value) {
    if (password.value.length < 8) {
      error.value = "Password must be at least 8 characters.";
      return;
    }
    if (password.value !== confirmation.value) {
      error.value = "Passwords do not match.";
      return;
    }
  }
  busy.value = true;
  try {
    if (isSetup.value) await setup(password.value);
    else await login(password.value);
    await router.replace(safeInternalPath(route.query.next, "/servers"));
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : "Something went wrong.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center p-6">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <LogoMark class="mb-2 size-9" />
        <CardTitle>{{ title }}</CardTitle>
        <CardDescription>{{ description }}</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <div class="grid gap-2">
            <Label for="password">Password</Label>
            <Input id="password" v-model="password" type="password" autocomplete="current-password" autofocus />
          </div>
          <div v-if="isSetup" class="grid gap-2">
            <Label for="confirmation">Confirm password</Label>
            <Input id="confirmation" v-model="confirmation" type="password" autocomplete="new-password" />
          </div>
          <p v-if="error" class="text-destructive">{{ error }}</p>
          <Button type="submit" :disabled="busy || password === ''">
            <Loader2 v-if="busy" class="animate-spin" />
            {{ isSetup ? "Create password" : "Sign in" }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
