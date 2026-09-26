"use strict";

const KANPO_STORAGE_KEY = "drug-tanaoroshi:kanpo-ledger:v1";
const $ = id => document.getElementById(id);
const state = { items: [], selected: null, ledger: loadLedger() };

function normalizeSearch(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, char =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  ).replace(/[\s　・･]/g, "");
}

function searchTerms(value) {
  return String(value).normalize("NFKC").trim().split(/[\s　]+/).filter(Boolean).map(normalizeSearch);
}

function loadLedger() {
  try {
    const saved = JSON.parse(localStorage.getItem(KANPO_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter(row => row && typeof row.id === "string" && Number.isSafeInteger(row.packets) && row.packets >= 0) : [];
  } catch { return []; }
}

function saveLedger() {
  try { localStorage.setItem(KANPO_STORAGE_KEY, JSON.stringify(state.ledger)); return true; }
  catch { $("kanpo-error").textContent = "ブラウザーに保存できませんでした。印刷して記録を残してください。"; return false; }
}

function grams(value) { return `${Number(value).toFixed(3)}g`; }

function renderResults() {
  const terms = searchTerms($("kanpo-search").value);
  const matches = state.items.filter(item => {
    const text = normalizeSearch(`${item.name} ${item.shelf} ${item.yj}`);
    return terms.every(term => text.includes(term));
  });
  $("kanpo-result-count").textContent = `${matches.length}件`;
  const root = $("kanpo-results"); root.replaceChildren();
  if (!matches.length) {
    const message = document.createElement("p"); message.className = "results-message";
    message.textContent = "該当する漢方薬がありません。"; root.append(message); return;
  }
  for (const item of matches) {
    const button = document.createElement("button"); button.type = "button";
    button.className = `result${state.selected?.id === item.id ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", state.selected?.id === item.id ? "true" : "false");
    const name = document.createElement("span"); name.className = "result-name"; name.textContent = item.name;
    const meta = document.createElement("span"); meta.className = "result-meta";
    const recorded = state.ledger.find(row => row.id === item.id);
    meta.textContent = `棚1 ${item.shelf} · 1包 ${grams(item.gramsPerPacket)}${recorded ? ` · 記録済み ${recorded.packets}包` : ""}`;
    button.append(name, meta);
    button.addEventListener("click", () => {
      state.selected = item;
      $("packet-count").value = state.ledger.find(row => row.id === item.id)?.packets ?? "";
      $("kanpo-status").textContent = "";
      renderSelected(); renderResults(); $("packet-count").focus();
    });
    root.append(button);
  }
}

function renderSelected() {
  const root = $("kanpo-selected"); root.replaceChildren();
  const item = state.selected;
  if (!item) {
    root.className = "selected empty";
    root.textContent = "左の一覧から漢方薬を選択してください。";
    updateCalculation(); return;
  }
  root.className = "selected";
  const name = document.createElement("strong"); name.textContent = item.name;
  const detail = document.createElement("small");
  detail.textContent = `棚1 ${item.shelf} · 1包 ${grams(item.gramsPerPacket)} · YJ ${item.yj}`;
  root.append(name, detail); updateCalculation();
}

function calculate() {
  if (!state.selected) return null;
  const input = $("packet-count").value.normalize("NFKC").trim();
  if (!/^\d+$/.test(input)) return null;
  const packets = Number(input);
  if (!Number.isSafeInteger(packets) || !Number.isFinite(packets * state.selected.gramsPerPacket)) return null;
  return { packets, totalGrams: packets * state.selected.gramsPerPacket };
}

function updateCalculation() {
  const result = calculate(); const box = $("kanpo-calculation");
  $("kanpo-add").disabled = !result;
  box.className = "calculation";
  if (!result) { box.textContent = "漢方薬と包数を入力すると合計gが表示されます。"; return; }
  box.classList.add("ready");
  const label = document.createElement("span"); label.textContent = "薬剤の合計重量";
  const total = document.createElement("strong"); total.textContent = grams(result.totalGrams);
  const detail = document.createElement("small");
  detail.textContent = `${result.packets.toLocaleString("ja-JP")}包 × 1包 ${grams(state.selected.gramsPerPacket)}`;
  box.replaceChildren(label, total, detail);
}

function renderLedger() {
  const root = $("kanpo-ledger"); root.replaceChildren();
  const byId = new Map(state.items.map(item => [item.id, item]));
  const rows = state.ledger.filter(row => byId.has(row.id)).sort((a, b) => byId.get(a.id).sourceLine - byId.get(b.id).sourceLine);
  for (const row of rows) {
    const item = byId.get(row.id); const tr = document.createElement("tr");
    const shelf = document.createElement("td"); shelf.textContent = item.shelf;
    const name = document.createElement("td"); name.textContent = item.name;
    const packet = document.createElement("td"); packet.textContent = `${row.packets.toLocaleString("ja-JP")}包`;
    const perPacket = document.createElement("td"); perPacket.textContent = grams(item.gramsPerPacket);
    const total = document.createElement("td"); total.textContent = grams(row.packets * item.gramsPerPacket);
    const action = document.createElement("td"); action.className = "no-print";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove";
    remove.textContent = "削除"; remove.setAttribute("aria-label", `${item.name}の記録を削除`);
    remove.addEventListener("click", () => {
      if (!confirm(`${item.name}の記録を削除しますか？`)) return;
      state.ledger = state.ledger.filter(saved => saved.id !== item.id);
      saveLedger(); renderLedger(); renderResults();
    });
    action.append(remove); tr.append(shelf, name, packet, perPacket, total, action); root.append(tr);
  }
  $("kanpo-empty").hidden = rows.length > 0;
  $("kanpo-print").disabled = rows.length === 0;
  $("kanpo-total").textContent = rows.length ? `${rows.length}品目 · ${rows.reduce((sum, row) => sum + row.packets, 0).toLocaleString("ja-JP")}包` : "";
  $("kanpo-printed-at").textContent = `印刷日時：${new Date().toLocaleString("ja-JP")}`;
}

$("kanpo-search").addEventListener("input", renderResults);
$("kanpo-clear-search").addEventListener("click", () => {
  $("kanpo-search").value = ""; renderResults(); $("kanpo-search").focus();
});
$("packet-count").addEventListener("input", event => {
  $("kanpo-status").textContent = "";
  const input = event.currentTarget; const before = input.value;
  const cursor = input.selectionStart; const after = before.normalize("NFKC");
  if (before !== after) {
    input.value = after;
    if (cursor !== null) input.setSelectionRange(before.slice(0, cursor).normalize("NFKC").length, before.slice(0, cursor).normalize("NFKC").length);
  }
  updateCalculation();
});
$("kanpo-form").addEventListener("submit", event => {
  event.preventDefault(); $("kanpo-error").textContent = "";
  const result = calculate(); const item = state.selected;
  if (!result || !item) { $("kanpo-error").textContent = "漢方薬と包数を確認してください。"; return; }
  state.ledger = state.ledger.filter(row => row.id !== item.id);
  state.ledger.push({ id: item.id, packets: result.packets });
  saveLedger(); renderLedger(); renderResults();
  $("kanpo-status").textContent = `${item.name}を${result.packets.toLocaleString("ja-JP")}包、${grams(result.totalGrams)}で記録しました。`;
});
$("kanpo-print").addEventListener("click", () => { renderLedger(); window.print(); });
$("kanpo-clear-ledger").addEventListener("click", () => {
  if (!state.ledger.length || !confirm("漢方薬の棚卸し一覧をすべて削除しますか？")) return;
  state.ledger = []; saveLedger(); renderLedger(); renderResults();
  $("kanpo-status").textContent = "棚卸し一覧を削除しました。";
});

async function init() {
  try {
    const response = await fetch("kanpo.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(); state.items = data.items;
    $("kanpo-coverage").textContent = `対象 ${state.items.length}品目`;
    $("kanpo-data-date").textContent = ` データ抽出日：${data.updated}`;
    renderResults(); renderLedger();
  } catch {
    $("kanpo-results").textContent = "漢方薬データを読み込めませんでした。ページを再読み込みしてください。";
    $("kanpo-coverage").textContent = "データ読み込みエラー";
  }
}
init();
