// src/time.ts
function formatElapsedTime(elapsedMs) {
  const safeElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const totalSeconds = Math.floor(safeElapsedMs / 1e3);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

// src/firstCasts.ts
function formatOffset(offsetMs) {
  const safe = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0;
  const abs = Math.abs(safe);
  const minutes = Math.floor(abs / 6e4);
  const seconds = (abs % 6e4 / 1e3).toFixed(3).padStart(6, "0");
  return `${safe < 0 ? "-" : ""}${minutes}:${seconds}`;
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

// node_modules/.pnpm/@emyrk+chronicle-panel-sdk@0.2.0_@bufbuild+protobuf@2.16.0/node_modules/@emyrk/chronicle-panel-sdk/dist/v1/contracts.js
var CUSTOM_PANEL_MAX_BREAKOUTS = 8;
var CUSTOM_PANEL_BREAKOUT_TITLE_MAX_LENGTH = 100;

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
  const damageBreakouts = /* @__PURE__ */ new Map();
  let gearRows = [];
  let gearSort = parseGearSort(snapshot.panel.option);
  let castRows = [];
  let firstCastEncounters = [];
  let destroyed = false;
  const app = document.createElement("div");
  app.className = "chronicle-example";
  root.append(app);
  const worker = api.workers.create();
  const streamType = panelId === "damage-summary" || panelId === "first-casts" ? "damage" : panelId === "gear-rarity" ? "combatant_info" : "spell_go";
  function renderError(message) {
    app.innerHTML = "";
    const error = document.createElement("div");
    error.className = "state error";
    error.textContent = message;
    app.append(error);
  }
  function renderDamageBreakout(playerId, handle) {
    const row = damageRows.find((candidate) => candidate.playerId === playerId);
    handle.root.querySelector(".damage-breakout")?.remove();
    const breakout = document.createElement("div");
    breakout.className = "damage-breakout";
    if (!row || row.breakdown.length === 0) {
      breakout.innerHTML = '<div class="state">No damage from this player in the selected encounters.</div>';
      handle.root.append(breakout);
      return;
    }
    const total = document.createElement("div");
    total.className = "damage-breakout-total";
    total.textContent = `${formatNumber(row.amount)} total damage`;
    const table = document.createElement("div");
    table.setAttribute("role", "table");
    table.setAttribute("aria-label", `${row.name} damage breakdown`);
    table.innerHTML = '<div class="damage-breakout-row damage-breakout-heading"><span>Source</span><span>Ability</span><span>Damage</span></div>';
    for (const detail of row.breakdown) {
      const detailRow = document.createElement("div");
      detailRow.className = "damage-breakout-row";
      detailRow.innerHTML = '<span class="actor"></span><span class="ability"></span><span class="value"></span>';
      detailRow.querySelector(".actor").textContent = detail.actorName;
      detailRow.querySelector(".ability").textContent = detail.abilityName;
      detailRow.querySelector(".value").textContent = formatNumber(detail.amount);
      table.append(detailRow);
    }
    breakout.append(total, table);
    handle.root.append(breakout);
  }
  function openDamageBreakout(row, event) {
    for (const [playerId, handle2] of damageBreakouts) {
      if (!handle2.root.host.isConnected) damageBreakouts.delete(playerId);
    }
    if (damageBreakouts.has(row.playerId)) return;
    if (damageBreakouts.size >= CUSTOM_PANEL_MAX_BREAKOUTS) {
      const [oldestId, oldest] = damageBreakouts.entries().next().value;
      oldest.close();
      damageBreakouts.delete(oldestId);
    }
    let handle;
    try {
      handle = api.breakouts.open({
        title: `${row.name} damage`.slice(0, CUSTOM_PANEL_BREAKOUT_TITLE_MAX_LENGTH),
        initialPosition: { x: event.clientX + 12, y: event.clientY + 12 },
        initialSize: { width: 440, height: 320 }
      });
    } catch (error) {
      renderError(error instanceof Error ? error.message : String(error));
      return;
    }
    damageBreakouts.set(row.playerId, handle);
    renderDamageBreakout(row.playerId, handle);
  }
  function renderDamage() {
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
    for (const [playerId, handle] of damageBreakouts) renderDamageBreakout(playerId, handle);
    const table = app.querySelector(".table");
    if (damageRows.length === 0) {
      table.innerHTML = '<div class="state">No player damage in the selected encounters.</div>';
      return;
    }
    const max = damageRows[0]?.amount || 1;
    for (const [index, row] of damageRows.entries()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "damage-row damage-row-button";
      item.setAttribute("aria-haspopup", "dialog");
      item.innerHTML = `
        <span class="rank">${index + 1}</span>
        <span class="name"></span>
        <span class="bar"><i style="width:${Math.max(2, row.amount / max * 100)}%"></i></span>
        <span class="value">${formatNumber(row.amount)}</span>
      `;
      item.querySelector(".name").textContent = row.name;
      item.addEventListener("click", (event) => openDamageBreakout(row, event));
      table.append(item);
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
  function renderFirstCasts() {
    const cutoff = snapshot.sync.enabled ? snapshot.sync.timestampMs : null;
    const encountersById = new Map(snapshot.instance.encounters.map((encounter) => [encounter.id, encounter]));
    app.innerHTML = `
      <header>
        <div>
          <strong>First Casts</strong>
          <span>${firstCastEncounters.length} encounter(s)</span>
        </div>
        <span class="badge">first damage or heal</span>
      </header>
      <div class="first-cast-list" role="table" aria-label="First effective cast by player"></div>
    `;
    const list = app.querySelector(".first-cast-list");
    if (firstCastEncounters.length === 0) {
      list.innerHTML = '<div class="state">No player damage or healing in the selected encounters.</div>';
      return;
    }
    for (const encounter of firstCastEncounters) {
      const info = encountersById.get(encounter.encounterId);
      const parsedStart = info ? Date.parse(info.startTime) : Number.NaN;
      const startMs = Number.isFinite(parsedStart) ? parsedStart : encounter.firstTimestampMs;
      const heading = document.createElement("div");
      heading.className = "first-cast-encounter";
      heading.setAttribute("role", "rowgroup");
      heading.textContent = `${info?.name ?? encounter.encounterId} \xB7 ${encounter.rows.length} player(s)`;
      list.append(heading);
      for (const [index, row] of encounter.rows.entries()) {
        const item = document.createElement("div");
        item.className = `first-cast-row${cutoff != null && row.atMs > cutoff ? " pending" : ""}`;
        item.setAttribute("role", "row");
        item.innerHTML = `
          <span class="rank">${index + 1}</span>
          <time></time>
          <span class="caster"></span>
          <span class="spell"></span>
          <span class="target"></span>
        `;
        const time = item.querySelector("time");
        time.textContent = formatOffset(row.atMs - startMs);
        time.dateTime = new Date(row.atMs).toISOString();
        time.title = new Date(row.atMs).toLocaleTimeString(void 0, { hour12: false, fractionalSecondDigits: 3 });
        item.querySelector(".caster").textContent = row.name;
        const spell = item.querySelector(".spell");
        spell.textContent = row.spellName;
        spell.classList.add(row.kind);
        spell.title = `${row.kind === "heal" ? "Heal" : "Damage"}${row.spellId ? ` \xB7 spell ${row.spellId}` : ""}`;
        item.querySelector(".target").textContent = row.target ? `\u2192 ${snapshot.instance.units[row.target]?.name ?? snapshot.instance.players[row.target]?.name ?? row.target}` : "";
        list.append(item);
      }
    }
  }
  function render() {
    if (panelId === "damage-summary") renderDamage();
    else if (panelId === "first-casts") renderFirstCasts();
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
    if (event.data?.type === "first-casts-result") firstCastEncounters = event.data.encounters;
    if (event.data?.type === "casts-result") castRows = event.data.rows;
    if (event.data?.type === "gear-rarity-result") gearRows = event.data.rows;
    render();
  };
  worker.onerror = (event) => renderError(`Plugin worker failed: ${event.message}`);
  app.innerHTML = '<div class="state">Loading Chronicle event stream\u2026</div>';
  try {
    const [stream, classificationStream, healStream] = await Promise.all([
      api.events.getStream(streamType),
      panelId === "damage-summary" ? api.events.getStream("unit_classification") : Promise.resolve(null),
      panelId === "first-casts" ? api.events.getStream("heal") : Promise.resolve(null)
    ]);
    if (api.lifecycle.signal.aborted || destroyed) return { destroy() {
    } };
    const transfer = [stream.data];
    if (classificationStream) transfer.push(classificationStream.data);
    if (healStream) transfer.push(healStream.data);
    worker.postMessage(
      {
        type: "init",
        panelId,
        streamType,
        data: stream.data,
        classificationData: classificationStream?.data,
        healData: healStream?.data,
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
      else if (panelId === "first-casts") renderFirstCasts();
    },
    destroy() {
      destroyed = true;
      for (const handle of damageBreakouts.values()) handle.close();
      damageBreakouts.clear();
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
