import { ref, shallowRef, type Ref } from "vue";
import { ApiError } from "@/lib/api";
import { toast } from "vue-sonner";

export type ResourceOptions = {
  quiet?: boolean;
  onError?: (error: unknown) => void;
};

export type Resource<T> = {
  data: Ref<T | null>;
  loading: Ref<boolean>;
  error: Ref<string | null>;
  load: () => Promise<T | null>;
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function useResource<T>(fetcher: () => Promise<T>, options: ResourceOptions = {}): Resource<T> {
  const data = shallowRef<T | null>(null) as Ref<T | null>;
  const loading = ref(false);
  const error = ref<string | null>(null);
  let sequence = 0;

  async function load(): Promise<T | null> {
    const current = ++sequence;
    loading.value = true;
    try {
      const value = await fetcher();
      if (current !== sequence) return null;
      data.value = value;
      error.value = null;
      return value;
    } catch (caught) {
      if (current !== sequence) return null;
      error.value = describeError(caught);
      options.onError?.(caught);
      if (!options.quiet) toast.error(error.value);
      return null;
    } finally {
      if (current === sequence) loading.value = false;
    }
  }

  return { data, loading, error, load };
}
