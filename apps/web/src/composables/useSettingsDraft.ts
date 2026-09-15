import type { SettingsDto, SettingsPatch } from "@junctio/schema";
import { computed, onMounted, reactive, ref } from "vue";
import { toast } from "vue-sonner";
import { ApiError, api } from "@/lib/api";
import { useSession } from "@/stores/session";

type DraftKey = keyof SettingsPatch & keyof SettingsDto;

export function useSettingsDraft<K extends DraftKey>(keys: readonly K[]) {
  const { settings, refreshSettings } = useSession();

  const draft = reactive({}) as Pick<SettingsDto, K>;
  const busy = ref(false);
  const loaded = ref(false);

  function reset() {
    const current = settings.value;
    if (!current) return;
    for (const key of keys) {
      const value = current[key];
      draft[key] = (
        typeof value === "object" && value !== null ? (JSON.parse(JSON.stringify(value)) as unknown) : value
      ) as Pick<SettingsDto, K>[K];
    }
    loaded.value = true;
  }

  const dirty = computed(() => {
    const current = settings.value;
    if (!current || !loaded.value) return false;
    return keys.some((key) => JSON.stringify(draft[key]) !== JSON.stringify(current[key]));
  });

  async function save(): Promise<boolean> {
    busy.value = true;
    try {
      const patch: SettingsPatch = {};
      for (const key of keys) Object.assign(patch, { [key]: draft[key] });
      await api.settings.patch(patch);
      await refreshSettings();
      reset();
      toast.success("Settings saved");
      return true;
    } catch (error) {
      if (error instanceof ApiError) toast.error(error.message);
      return false;
    } finally {
      busy.value = false;
    }
  }

  onMounted(async () => {
    await refreshSettings().catch(() => undefined);
    reset();
  });

  return { draft, dirty, busy, reset, save, settings };
}
