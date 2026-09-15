import type { ServerDto } from "@junctio/schema";
import { ref } from "vue";
import { toast } from "vue-sonner";
import { api } from "@/lib/api";
import { describeError } from "./useResource";

export type ServerAction = "start" | "stop" | "restart" | "reset";

export function useServerActions(onDone?: () => unknown) {
  const busy = ref<string | null>(null);

  async function act(server: ServerDto, action: ServerAction): Promise<void> {
    busy.value = `${server.id}:${action}`;
    try {
      await api.servers[action](server.id);
      toast.success(`${server.name} ${action}ed`);
    } catch (error) {
      toast.error(describeError(error));
    } finally {
      busy.value = null;
      await onDone?.();
    }
  }

  async function reauth(server: ServerDto): Promise<void> {
    try {
      const { authorizationUrl } = await api.servers.oauthStart(server.id);
      window.location.href = authorizationUrl;
    } catch (error) {
      toast.error(describeError(error));
    }
  }

  return { busy, act, reauth };
}
