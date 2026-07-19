import { type PingPayload } from "./types";

// Local subscriber registry: the open GlobeApp subscribes so it can animate
// pings that arrive over the wire (or that it sends itself). The actual network
// emit lives in socket.ts (socketlib-aware, with a game.socket fallback).
type PingListener = (payload: PingPayload) => void;
const listeners = new Set<PingListener>();

export function onPing(fn: PingListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dispatchPing(payload: PingPayload): void {
  for (const fn of listeners) fn(payload);
}

export { sendPing } from "./socket";
