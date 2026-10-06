import type {
  ChroniclePanelInstanceV1,
  ChroniclePanelMountRequestV1,
  ChroniclePanelPluginV1,
  ChroniclePanelSnapshotV1,
} from "./sdk/host";

interface DamageRow {
  name: string;
  amount: number;
}

interface CastRow {
  encounterId: string;
  atMs: number;
  casterId: string;
  casterName: string;
  spellId: number | null;
  spellName: string;
  target: string | null;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

async function mountPanel(request: ChroniclePanelMountRequestV1): Promise<ChroniclePanelInstanceV1> {
  const { panelId, root, api } = request;
  const document = root.host.ownerDocument;
  let snapshot = request.snapshot;
  let damageRows: DamageRow[] = [];
  let castRows: CastRow[] = [];
  let destroyed = false;

  const app = document.createElement("div");
  app.className = "chronicle-example";
  root.append(app);

  const worker = api.workers.create();
  const streamType = panelId === "damage-summary" ? "damage" : "spell_go";

  function renderError(message: string): void {
    app.innerHTML = "";
    const error = document.createElement("div");
    error.className = "state error";
    error.textContent = message;
    app.append(error);
  }

  function renderDamage(): void {
    app.innerHTML = `
      <header>
        <div>
          <strong>Damage Summary</strong>
          <span>${snapshot.selection.encounterIds.length} encounter(s)</span>
        </div>
        <span class="badge">plugin worker</span>
      </header>
      <div class="table" role="table" aria-label="Damage by player"></div>
    `;
    const table = app.querySelector<HTMLDivElement>(".table")!;
    if (damageRows.length === 0) {
      table.innerHTML = '<div class="state">No damage in the selected encounters.</div>';
      return;
    }
    const max = damageRows[0]?.amount || 1;
    for (const [index, row] of damageRows.entries()) {
      const item = document.createElement("div");
      item.className = "damage-row";
      item.innerHTML = `
        <span class="rank">${index + 1}</span>
        <span class="name"></span>
        <span class="bar"><i style="width:${Math.max(2, (row.amount / max) * 100)}%"></i></span>
        <span class="value">${formatNumber(row.amount)}</span>
      `;
      item.querySelector<HTMLElement>(".name")!.textContent = row.name;
      table.append(item);
    }
  }

  function renderCasts(): void {
    const cutoff = snapshot.sync.enabled ? snapshot.sync.timestampMs : null;
    const visible = cutoff == null ? castRows : castRows.filter((row) => row.atMs <= cutoff);
    const rows = visible.slice(-100).reverse();
    app.innerHTML = `
      <header>
        <div>
          <strong>Replay Casts</strong>
          <span>${snapshot.sync.enabled ? "following replay" : "full encounter"}</span>
        </div>
        <span class="badge ${snapshot.sync.playing ? "live" : ""}">${snapshot.sync.playing ? "playing" : "paused"}</span>
      </header>
      <div class="cast-list" role="log" aria-live="polite"></div>
    `;
    const list = app.querySelector<HTMLDivElement>(".cast-list")!;
    if (rows.length === 0) {
      list.innerHTML = '<div class="state">No casts have occurred at this replay position.</div>';
      return;
    }
    for (const row of rows) {
      const encounter = snapshot.instance.encounters.find((item) => item.id === row.encounterId);
      const encounterStart = encounter ? new Date(encounter.startTime).getTime() : row.atMs;
      const elapsed = Math.max(0, row.atMs - encounterStart);
      const item = document.createElement("div");
      item.className = "cast-row";
      item.innerHTML = `
        <time>${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, "0")}</time>
        <span class="caster"></span>
        <span class="spell"></span>
        <span class="target"></span>
      `;
      item.querySelector<HTMLElement>(".caster")!.textContent = row.casterName;
      item.querySelector<HTMLElement>(".spell")!.textContent = row.spellName;
      item.querySelector<HTMLElement>(".target")!.textContent = row.target ? `→ ${snapshot.instance.units[row.target]?.name ?? row.target}` : "";
      list.append(item);
    }
  }

  function render(): void {
    if (panelId === "damage-summary") renderDamage();
    else renderCasts();
  }

  worker.onmessage = (event: MessageEvent) => {
    if (destroyed) return;
    if (event.data?.type === "damage-result") damageRows = event.data.rows as DamageRow[];
    if (event.data?.type === "casts-result") castRows = event.data.rows as CastRow[];
    render();
  };
  worker.onerror = (event) => renderError(`Plugin worker failed: ${event.message}`);

  app.innerHTML = '<div class="state">Loading Chronicle event stream…</div>';
  try {
    const [stream, classificationStream] = await Promise.all([
      api.events.getStream(streamType),
      panelId === "damage-summary" ? api.events.getStream("unit_classification") : Promise.resolve(null),
    ]);
    if (api.lifecycle.signal.aborted || destroyed) return { destroy() {} };
    const transfer = classificationStream ? [stream.data, classificationStream.data] : [stream.data];
    worker.postMessage(
      {
        type: "init",
        panelId,
        streamType,
        data: stream.data,
        classificationData: classificationStream?.data,
        selectedEncounterIds: snapshot.selection.encounterIds,
        players: snapshot.instance.players,
        units: snapshot.instance.units,
        sync: { enabled: snapshot.sync.enabled, timestampMs: snapshot.sync.timestampMs },
      },
      transfer,
    );
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }

  return {
    update(next) {
      snapshot = next;
      worker.postMessage({
        type: "update",
        selectedEncounterIds: next.selection.encounterIds,
        sync: { enabled: next.sync.enabled, timestampMs: next.sync.timestampMs },
      });
      if (panelId === "replay-casts") renderCasts();
    },
    destroy() {
      destroyed = true;
      worker.postMessage({ type: "dispose" });
      worker.terminate();
      app.remove();
    },
  };
}

const plugin: ChroniclePanelPluginV1 = {
  apiVersion: 1,
  mount: mountPanel,
};

export default plugin;
