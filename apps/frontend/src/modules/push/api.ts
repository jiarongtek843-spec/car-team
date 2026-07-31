import { http } from "../../api/http";

export function fetchVapidPublicKey() {
  return http.get<{ publicKey: string | null }>("/api/driver/push/vapid-public-key");
}

export interface SubscribeInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function subscribePush(input: SubscribeInput) {
  return http.post<{ ok: true }>("/api/driver/push/subscribe", input);
}

export function unsubscribePush(endpoint: string) {
  return http.post<void>("/api/driver/push/unsubscribe", { endpoint });
}
