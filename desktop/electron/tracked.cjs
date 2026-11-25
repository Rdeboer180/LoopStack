// The portable tracked-record rules, mirrored from src/lib/tracking/transfer.ts
// (cleanItems, mergeItems) because the main process cannot import TypeScript.
// Keep the two in step. Pure; nothing here touches disk, a pump, a pod or Loop.
const MAX_HISTORY = 60;
const CONF = ['good', 'limited', 'unusable'];
const STATES = ['tracked', 'staged', 'built', 'dismissed'];
const BAD_ID = ['__proto__', 'constructor', 'prototype'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^(isf|carbRatio|basal-\d{2}|food-[a-z0-9-]{1,60})$/;
const RANK = { built: 3, dismissed: 3, staged: 2, tracked: 1 };

/** Anything damaged or foreign is dropped, never repaired. */
function cleanItems(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const r of value) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.id !== 'string' || !ID.test(r.id) || BAD_ID.includes(r.id)) continue;
    if (!STATES.includes(r.state) || typeof r.since !== 'string' || !DAY.test(r.since)) continue;
    const updated = typeof r.updated === 'string' && DAY.test(r.updated) ? r.updated : r.since;
    const history = (Array.isArray(r.history) ? r.history : [])
      .filter((h) => !!h && typeof h.date === 'string' && DAY.test(h.date) && CONF.includes(h.confidence) && (h.reading === null || (typeof h.reading === 'number' && Number.isFinite(h.reading))))
      .map((h) => ({ date: h.date, confidence: h.confidence, reading: h.reading }))
      .slice(-MAX_HISTORY);
    const item = { id: r.id, state: r.state, since: r.since, updated, history };
    if (r.state === 'built') {
      if (typeof r.builtAt === 'string' && DAY.test(r.builtAt)) item.builtAt = r.builtAt;
      if (typeof r.commit === 'string') item.commit = r.commit.slice(0, 40);
    }
    out.push(item);
  }
  return out;
}

function joinHistory(a, b) {
  const byDate = new Map();
  for (const r of b) byDate.set(r.date, r);
  for (const r of a) byDate.set(r.date, r);
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-MAX_HISTORY);
}

/** Histories join by date, the side changed later wins, a tie keeps `local`, and 'built' is final. */
function mergeItems(local, incoming) {
  const map = new Map(local.map((i) => [i.id, i]));
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const cur = map.get(inc.id);
    if (!cur) { map.set(inc.id, inc); added++; continue; }
    const winner = cur.state === 'built' && inc.state === 'built' ? ((inc.builtAt ?? '') > (cur.builtAt ?? '') ? inc : cur) : cur.state === 'built' ? cur : inc.state === 'built' ? inc : inc.updated > cur.updated ? inc : inc.updated === cur.updated && RANK[inc.state] > RANK[cur.state] ? inc : cur;
    const merged = {
      ...winner,
      since: cur.since < inc.since ? cur.since : inc.since,
      updated: cur.updated > inc.updated ? cur.updated : inc.updated,
      history: joinHistory(cur.history, inc.history),
    };
    if (JSON.stringify(merged) !== JSON.stringify(cur)) { map.set(inc.id, merged); updated++; }
  }
  return { items: [...map.values()], added, updated };
}

module.exports = { cleanItems, mergeItems, MAX_HISTORY };
