import type { ChatProviderStatus } from "../../api/http.ts";

/** True when the provider the next conversation would use is set up and ready (19#choosing-a-provider). */
export function activeProviderReady(status: ChatProviderStatus | null): boolean {
  return status?.active != null && status.providers.some((provider) => provider.id === status.active?.provider && provider.ready);
}

/** True when any provider is set up, whether or not it is the chosen one. */
export const anyReady = (status: ChatProviderStatus): boolean => status.providers.some((provider) => provider.ready);

type ProviderId = ChatProviderStatus["providers"][number]["id"];

/**
 * Set up a model offers the picker only when a ready provider can be chosen there: something is ready, the chosen one isn't, and
 * no --provider or KEYLOOM_PROVIDER outranks the picker. Otherwise it offers the setup for the provider that has to answer.
 */
export const offersPicker = (status: ChatProviderStatus | null): boolean =>
  status !== null && status.lockedBy === null && anyReady(status) && !activeProviderReady(status);

/**
 * What a message refused for a missing key can do next. Sending it again goes to the conversation's own provider when it is
 * pinned (D-111), or to the one the next conversation uses, so it is offered only when that provider is ready. Otherwise a ready
 * provider can take the message in a new conversation, unless --provider or KEYLOOM_PROVIDER fixes the choice.
 */
export type RetryOffer = { kind: "send" } | { kind: "switch"; to: ProviderId[] } | { kind: "none" };

export function retryOffer(status: ChatProviderStatus | null, pinned: ProviderId | null): RetryOffer {
  if (status === null) return { kind: "none" };
  const answerer = pinned ?? status.active?.provider;
  if (status.providers.some((provider) => provider.id === answerer && provider.ready)) return { kind: "send" };
  const to = status.lockedBy === null ? status.providers.filter((provider) => provider.ready).map((provider) => provider.id) : [];
  return to.length === 0 ? { kind: "none" } : { kind: "switch", to };
}
