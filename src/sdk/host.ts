export type ChronicleStreamType =
  | "damage"
  | "extra_attack"
  | "heal"
  | "resource_change"
  | "slain"
  | "ressurection"
  | "cast"
  | "aura"
  | "spell_go"
  | "aura_cast"
  | "spell_start"
  | "spell_fail"
  | "unit_classification"
  | "combatant_info"
  | "dispel"
  | "interrupt"
  | "absorbed"
  | "companion_stats"
  | "consume"
  | "raid_group";

export interface PluginEventStreamV1 {
  type: ChronicleStreamType;
  encoding: "chronicle-event-stream-v1";
  data: ArrayBuffer;
  headers: Array<{
    encounterId: string;
    firstTimestampMs: number;
    count: number;
    dataLength: number;
  }>;
}

export interface PluginEncounterV1 {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface PluginPlayerV1 {
  id?: string;
  name: string;
  class?: string;
  class_name?: string;
}

export interface PluginUnitV1 {
  name: string;
  owner?: string | null;
  entry?: number;
}

export interface ChroniclePanelSnapshotV1 {
  instance: {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    capabilities: string[];
    encounters: PluginEncounterV1[];
    players: Record<string, PluginPlayerV1>;
    units: Record<string, PluginUnitV1>;
  };
  selection: {
    encounterIds: string[];
    playerIds: string[];
    enemyIds: string[];
  };
  sync: {
    enabled: boolean;
    playing: boolean;
    timestampMs: number | null;
  };
  panel: {
    panelInstanceId: string;
    option: string | null;
    width: number;
    height: number;
    renderMode: "default" | "layout_lab";
    poppedOut: boolean;
  };
  theme: { mode: "light" | "dark" };
}

export interface PluginItemMetadataV1 {
  entry: number;
  name: string;
  quality: number;
}

export interface ChroniclePanelHostAPIV1 {
  events: {
    getStream(type: ChronicleStreamType): Promise<PluginEventStreamV1>;
  };
  gameData: {
    getItemMetadata(itemIds: number[]): Promise<PluginItemMetadataV1[]>;
  };
  workers: {
    create(): Worker;
  };
  panel: {
    setOption(option: string | null): void;
    selectEncounters(ids: string[]): void;
    togglePlayer(id: string): void;
    togglePlayers(ids: string[]): void;
  };
  lifecycle: { signal: AbortSignal };
}

export interface ChroniclePanelMountRequestV1 {
  panelId: string;
  root: ShadowRoot;
  api: ChroniclePanelHostAPIV1;
  snapshot: ChroniclePanelSnapshotV1;
}

export interface ChroniclePanelInstanceV1 {
  update?(snapshot: ChroniclePanelSnapshotV1): void | Promise<void>;
  destroy?(): void | Promise<void>;
}

export interface ChroniclePanelPluginV1 {
  apiVersion: 1;
  mount(request: ChroniclePanelMountRequestV1): ChroniclePanelInstanceV1 | Promise<ChroniclePanelInstanceV1>;
}
