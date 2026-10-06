// src/panel.ts
function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}
function sameSelection(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
async function mountPanel(request) {
  const { panelId, root, api } = request;
  const document = root.host.ownerDocument;
  let snapshot = request.snapshot;
  let damageRows = [];
  let castRows = [];
  let destroyed = false;
  const app = document.createElement("div");
  app.className = "chronicle-example";
  root.append(app);
  const worker = api.workers.create();
  const streamType = panelId === "damage-summary" ? "damage" : "spell_go";
  function renderError(message) {
    app.innerHTML = "";
    const error = document.createElement("div");
    error.className = "state error";
    error.textContent = message;
    app.append(error);
  }
  function renderDamage() {
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
    const table = app.querySelector(".table");
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
        <span class="bar"><i style="width:${Math.max(2, row.amount / max * 100)}%"></i></span>
        <span class="value">${formatNumber(row.amount)}</span>
      `;
      item.querySelector(".name").textContent = row.name;
      table.append(item);
    }
  }
  function renderCasts() {
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
    const list = app.querySelector(".cast-list");
    if (rows.length === 0) {
      list.innerHTML = '<div class="state">No casts have occurred at this replay position.</div>';
      return;
    }
    for (const row of rows) {
      const encounter = snapshot.instance.encounters.find((item2) => item2.id === row.encounterId);
      const encounterStart = encounter ? new Date(encounter.startTime).getTime() : row.atMs;
      const elapsed = Math.max(0, row.atMs - encounterStart);
      const item = document.createElement("div");
      item.className = "cast-row";
      item.innerHTML = `
        <time>${Math.floor(elapsed / 6e4)}:${String(Math.floor(elapsed / 1e3) % 60).padStart(2, "0")}</time>
        <span class="caster"></span>
        <span class="spell"></span>
        <span class="target"></span>
      `;
      item.querySelector(".caster").textContent = row.casterName;
      item.querySelector(".spell").textContent = row.spellName;
      item.querySelector(".target").textContent = row.target ? `\u2192 ${snapshot.instance.units[row.target]?.name ?? row.target}` : "";
      list.append(item);
    }
  }
  function render() {
    if (panelId === "damage-summary") renderDamage();
    else renderCasts();
  }
  worker.onmessage = (event) => {
    if (destroyed) return;
    if (event.data?.type === "damage-result") damageRows = event.data.rows;
    if (event.data?.type === "casts-result") castRows = event.data.rows;
    render();
  };
  worker.onerror = (event) => renderError(`Plugin worker failed: ${event.message}`);
  app.innerHTML = '<div class="state">Loading Chronicle event stream\u2026</div>';
  try {
    const stream = await api.events.getStream(streamType);
    if (api.lifecycle.signal.aborted || destroyed) return { destroy() {
    } };
    worker.postMessage(
      {
        type: "init",
        panelId,
        streamType,
        data: stream.data,
        selectedEncounterIds: snapshot.selection.encounterIds,
        players: snapshot.instance.players
      },
      [stream.data]
    );
  } catch (error) {
    renderError(error instanceof Error ? error.message : String(error));
  }
  return {
    update(next) {
      const selectionChanged = !sameSelection(snapshot.selection.encounterIds, next.selection.encounterIds);
      snapshot = next;
      if (selectionChanged) {
        worker.postMessage({ type: "selection", selectedEncounterIds: next.selection.encounterIds });
      } else if (panelId === "replay-casts") {
        renderCasts();
      }
    },
    destroy() {
      destroyed = true;
      worker.postMessage({ type: "dispose" });
      worker.terminate();
      app.remove();
    }
  };
}
var plugin = {
  apiVersion: 1,
  mount: mountPanel
};
var panel_default = plugin;
export {
  panel_default as default
};
//# sourceMappingURL=panel.js.map
