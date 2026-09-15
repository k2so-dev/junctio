import { useClipboard } from "@vueuse/core";
import { toast } from "vue-sonner";

export function useCopy(copiedDuring = 1600) {
  const { copy, copied, isSupported } = useClipboard({ legacy: true, copiedDuring });

  async function write(value: string): Promise<void> {
    try {
      await copy(value);
      if (!isSupported.value) toast.error("copying is not available here, select the text instead");
    } catch {
      toast.error("could not copy to the clipboard");
    }
  }

  return { copy: write, copied };
}
