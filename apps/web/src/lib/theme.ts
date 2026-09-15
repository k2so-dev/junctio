import { useColorMode } from "@vueuse/core";

const THEME_STORAGE_KEY = "junctio-theme";

export type ThemeMode = "light" | "dark" | "auto";

const colorMode = useColorMode({ storageKey: THEME_STORAGE_KEY, initialValue: "auto" });

export function useTheme() {
  return {
    /** Selected mode, including `auto`. */
    mode: colorMode.store,
    /** Mode actually applied to the document. */
    resolved: colorMode.state
  };
}
