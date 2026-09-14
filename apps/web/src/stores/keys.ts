import { reactive } from "vue";

const tokens = reactive(new Map<string, string>());

export function useFreshKeys() {
  return {
    tokens,
    remember(id: string, token: string) {
      tokens.set(id, token);
    }
  };
}
