import type { ChatProviderStatus } from "../../api/http.ts";

/** True when the provider the next conversation would use is set up and ready (19#choosing-a-provider). */
export function activeProviderReady(status: ChatProviderStatus | null): boolean {
  return status?.active != null && status.providers.some((provider) => provider.id === status.active?.provider && provider.ready);
}
