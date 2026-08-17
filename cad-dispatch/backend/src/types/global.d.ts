import type { DispatchEventPayload } from './dispatch';

declare global {
  var broadcastDispatch: (payload: DispatchEventPayload) => void;
}

export {};
