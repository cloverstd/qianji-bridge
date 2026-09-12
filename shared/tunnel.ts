export interface TunnelConfig {
  ownerUid: string;
  tunnelId: string;
  apiKey: string;
  enabled: boolean;
}
export interface TunnelStatus {
  available: boolean;
  locked: boolean;
  configured: boolean;
  enabled: boolean;
  tunnelId: string;
  hasKey: boolean;
  state:
    | "unavailable"
    | "unconfigured"
    | "stopped"
    | "connecting"
    | "ready"
    | "error";
  message: string;
  checkedAt: string;
  lastPollAt: string | null;
}
