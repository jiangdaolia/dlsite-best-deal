import type { RuntimeResponse } from './types';

export async function sendRuntimeMessage<T>(message: unknown): Promise<RuntimeResponse<T>> {
  return chrome.runtime.sendMessage(message);
}
