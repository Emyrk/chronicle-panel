// src/time.ts
function formatElapsedTime(elapsedMs) {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const totalSeconds = Math.floor(safeElapsedMs / 1e3);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

// src/gearRarity.ts
var GEAR_RARITIES = [
  { quality: 0, key: "poor", label: "Poor", shortLabel: "Gray" },
  { quality: 1, key: "common", label: "Common", shortLabel: "White" },
  { quality: 2, key: "uncommon", label: "Uncommon", shortLabel: "Green" },
  { quality: 3, key: "rare", label: "Rare", shortLabel: "Blue" },
  { quality: 4, key: "epic", label: "Epic", shortLabel: "Purple" },
  { quality: 5, key: "legendary", label: "Legendary", shortLabel: "Orange" },
  { quality: 6, key: "artifact", label: "Artifact", shortLabel: "Artifact" }
];
function sortGearRarityRows(rows, key, direction) {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") {
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName * multiplier;
    } else {
      const difference = a.counts[key] - b.counts[key];
      if (difference !== 0) return difference * multiplier;
    }
    return a.name.localeCompare(b.name) || a.guid.localeCompare(b.guid);
  });
}

// src/panel.ts
function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}
function parseGearSort(option) {
  const match = option?.match(/^gear-rarity:(name|poor|common|uncommon|rare|epic|legendary|artifact|unknown):(asc|desc)$/);
  if (!match) return { key: "epic", direction: "desc" };
  return { key: match[1], direction: match[2] };
}
async function mountPanel(request) {
  const { panelId, root, api } = request;
  const document = root.host.ownerDocument;
  let snapshot = request.snapshot;
  let damageRows = [];
  let expandedDamagePlayerId = null;
  let gearRows = [];
  let gearSort = parseGearSort(snapshot.panel.option);
  let castRows = [];
  let destroyed = false;
  const app = document.createElement("div");
  app.className = "chronicle-example";
  root.append(app);
  const worker = api.workers.create();
  const streamType = panelId === "damage-summary" ? "damage" : panelId === "gear-rarity" ? "combatant_info" : "spell_go";
  function renderError(message) {
    app.innerHTML = "";
    const error = document.createElement("div");
    error.className = "state error";
    error.textContent = message;
    app.append(error);
  }
  function renderDamage() {
    if (expandedDamagePlayerId && !damageRows.some((row) => row.playerId === expandedDamagePlayerId)) {
      expandedDamagePlayerId = null;
    }
    app.innerHTML = `
      <header>
        <div>
          <strong>Damage Summary</strong>
          <span>${snapshot.selection.encounterIds.length} encounter(s)</span>
        </div>
        <span class="badge">click a player for details</span>
      </header>
      <div class="table" role="table" aria-label="Damage by player"></div>
    `;
    const table = app.querySelector(".table");
    if (damageRows.length === 0) {
      table.innerHTML = '<div class="state">No player damage in the selected encounters.</div>';
      return;
    }
    const max = damageRows[0]?.amount || 1;
    for (const [index, row] of damageRows.entries()) {
      const expanded = expandedDamagePlayerId === row.playerId;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "damage-row damage-row-button";
      item.setAttribute("aria-expanded", String(expanded));
      item.innerHTML = `
        <span class="rank">${expanded ? "\u25BE" : "\u25B8"} ${index + 1}</span>
        <span class="name"></span>
        <span class="bar"><i style="width:${Math.max(2, row.amount / max * 100)}%"></i></span>
        <span class="value">${formatNumber(row.amount)}</span>
      `;
      item.querySelector(".name").textContent = row.name;
      item.addEventListener("click", () => {
        expandedDamagePlayerId = expanded ? null : row.playerId;
        renderDamage();
      });
      table.append(item);
      if (!expanded) continue;
      const breakout = document.createElement("div");
      breakout.className = "damage-breakout";
      breakout.setAttribute("role", "table");
      breakout.setAttribute("aria-label", `${row.name} damage breakdown`);
      breakout.innerHTML = '<div class="damage-breakout-row damage-breakout-heading"><span>Source</span><span>Ability</span><span>Damage</span></div>';
      for (const detail of row.breakdown) {
        const detailRow = document.createElement("div");
        detailRow.className = "damage-breakout-row";
        detailRow.innerHTML = '<span class="actor"></span><span class="ability"></span><span class="value"></span>';
        detailRow.querySelector(".actor").textContent = detail.actorName;
        detailRow.querySelector(".ability").textContent = detail.abilityName;
        detailRow.querySelector(".value").textContent = formatNumber(detail.amount);
        breakout.append(detailRow);
      }
      table.append(breakout);
    }
  }
  function renderGear() {
    const rows = sortGearRarityRows(gearRows, gearSort.key, gearSort.direction);
    app.innerHTML = `
      <header>
        <div>
          <strong>Gear Rarity</strong>
          <span>${rows.length} player(s)</span>
        </div>
        <span class="badge">click a column to sort</span>
      </header>
      <div class="gear-table" role="table" aria-label="Equipped item rarity by player"></div>
    `;
    const table = app.querySelector(".gear-table");
    if (rows.length === 0) {
      table.innerHTML = '<div class="state">No combatant gear snapshots were found.</div>';
      return;
    }
    const columns = [
      { key: "name", label: "Player" },
      ...GEAR_RARITIES.map((rarity) => ({ key: rarity.key, label: rarity.shortLabel, className: `rarity-${rarity.key}` })),
      { key: "unknown", label: "?", className: "rarity-unknown" }
    ];
    const header = document.createElement("div");
    header.className = "gear-row gear-heading";
    for (const column of columns) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = column.className ?? "";
      button.textContent = `${column.label}${gearSort.key === column.key ? gearSort.direction === "desc" ? " \u2193" : " \u2191" : ""}`;
      button.title = column.key === "name" ? "Sort by player name" : `Sort by ${column.label} item count`;
      button.addEventListener("click", () => {
        gearSort = {
          key: column.key,
          direction: gearSort.key === column.key ? gearSort.direction === "desc" ? "asc" : "desc" : column.key === "name" ? "asc" : "desc"
        };
        api.panel.setOption(`gear-rarity:${gearSort.key}:${gearSort.direction}`);
        renderGear();
      });
      header.append(button);
    }
    table.append(header);
    for (const row of rows) {
      const item = document.createElement("div");
      item.className = "gear-row";
      const player = document.createElement("span");
      player.className = "gear-player";
      player.textContent = row.name;
      player.title = row.heroClass || row.guid;
      item.append(player);
      for (const rarity of GEAR_RARITIES) {
        const count = document.createElement("span");
        count.className = `gear-count rarity-${rarity.key}`;
        count.textContent = String(row.counts[rarity.key]);
        count.title = `${row.name}: ${row.counts[rarity.key]} ${rarity.label}`;
        item.append(count);
      }
      const unknown = document.createElement("span");
      unknown.className = "gear-count rarity-unknown";
      unknown.textContent = String(row.counts.unknown);
      unknown.title = `${row.name}: ${row.counts.unknown} unknown`;
      item.append(unknown);
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
      const item = document.createElement("div");
      item.className = "cast-row";
      item.innerHTML = `
        <time>${formatElapsedTime(row.elapsedMs)}</time>
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
    else if (panelId === "gear-rarity") renderGear();
    else renderCasts();
  }
  worker.onmessage = (event) => {
    if (destroyed) return;
    if (event.data?.type === "gear-item-ids") {
      const requestId = event.data.requestId;
      void api.gameData.getItemMetadata(event.data.itemIds).then((items) => {
        if (!destroyed) worker.postMessage({ type: "item-metadata", requestId, items });
      }).catch((error) => {
        if (!destroyed && error instanceof DOMException && error.name === "AbortError") return;
        if (!destroyed) renderError(error instanceof Error ? error.message : String(error));
      });
      return;
    }
    if (event.data?.type === "damage-result") damageRows = event.data.rows;
    if (event.data?.type === "casts-result") castRows = event.data.rows;
    if (event.data?.type === "gear-rarity-result") gearRows = event.data.rows;
    render();
  };
  worker.onerror = (event) => renderError(`Plugin worker failed: ${event.message}`);
  app.innerHTML = '<div class="state">Loading Chronicle event stream\u2026</div>';
  try {
    const [stream, classificationStream] = await Promise.all([
      api.events.getStream(streamType),
      panelId === "damage-summary" ? api.events.getStream("unit_classification") : Promise.resolve(null)
    ]);
    if (api.lifecycle.signal.aborted || destroyed) return { destroy() {
    } };
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
        sync: { enabled: snapshot.sync.enabled, timestampMs: snapshot.sync.timestampMs }
      },
      transfer
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
        sync: { enabled: next.sync.enabled, timestampMs: next.sync.timestampMs }
      });
      if (panelId === "gear-rarity") {
        gearSort = parseGearSort(next.panel.option);
        renderGear();
      } else if (panelId === "replay-casts") renderCasts();
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
