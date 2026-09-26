"use strict";

const STORAGE_KEY = "drug-tanaoroshi:ledger:v1";
const MANUAL_WEIGHT_KEY = "drug-tanaoroshi:manual-weights:v1";
const $ = (id) => document.getElementById(id);
const state = { drugs: [], selected: null, ledger: loadLedger(), manualWeights: loadManualWeights() };

function normalizeSearch(value) {
  return String(value).normalize("NFKC").toLowerCase().replace(/[ァ-ヶ]/g, char =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  ).replace(/[\s　・･]/g, "");
}

function searchTerms(value) {
  return String(value).normalize("NFKC").trim().split(/[\s　]+/).filter(Boolean).map(normalizeSearch);
}

function normalizeNumber(value) {
  return String(value).normalize("NFKC").replace(/[，,\s　]/g, "").replace(/[．。]/g, ".");
}

function parseWeight(value, optional = false) {
  const normalized = normalizeNumber(value);
  if (optional && normalized === "") return 0;
  if (!/^(?:\d+)(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function loadLedger() {
  try {
    const rows = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(rows) ? rows.filter(row => row && typeof row.id === "string" && Number.isSafeInteger(row.quantity) && row.quantity > 0) : [];
  } catch { return []; }
}

function loadManualWeights() {
  try {
    const saved = JSON.parse(localStorage.getItem(MANUAL_WEIGHT_KEY) || "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([id, weight]) =>
      /^[A-Z0-9]+$/.test(id) && Number.isFinite(weight) && weight > 0
    ));
  } catch { return {}; }
}

function saveLedger() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.ledger)); }
  catch { $("form-error").textContent = "ブラウザーに保存できませんでした。印刷して記録を残してください。"; }
}

function displayWeight(value) { return `${Number(value).toFixed(3)}g`; }
function displayMeasuredWeight(value) { return `${Number(value).toLocaleString("ja-JP", { minimumFractionDigits: 3, maximumFractionDigits: 4 })}g`; }
function displayAmount(value) { return `${Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 4 })}g`; }

function activeUnitWeight() {
  const drug = state.selected;
  if (!drug) return null;
  if (drug.weightG !== null) return drug.weightG;
  const value = normalizeNumber($("manual-weight").value);
  return /^\d+(?:\.\d{1,4})?$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

function renderResults() {
  const terms = searchTerms($("search").value);
  const matches = state.drugs.filter(drug => {
    const target = normalizeSearch(`${drug.name} ${drug.id}`);
    return terms.every(term => {
      if (/^\d+(?:\.\d+)?(?:mg|μg|ug)$/.test(term)) {
        const position = target.indexOf(term);
        return position >= 0 && (position === 0 || !/[\d.]/.test(target[position - 1]));
      }
      return target.includes(term);
    });
  });
  $("result-count").textContent = `${matches.length}件`;
  const root = $("results");
  root.replaceChildren();
  if (!matches.length) {
    const p = document.createElement("p"); p.className = "results-message"; p.textContent = "該当する医薬品がありません。"; root.append(p); return;
  }
  for (const drug of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `result${state.selected?.id === drug.id ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", state.selected?.id === drug.id ? "true" : "false");
    const name = document.createElement("span"); name.className = "result-name"; name.textContent = drug.name;
    const meta = document.createElement("span"); meta.className = "result-meta";
    meta.textContent = drug.weightG === null
      ? state.manualWeights[drug.id] ? `実測重量 ${displayMeasuredWeight(state.manualWeights[drug.id])}（このブラウザーに保存） · YJ ${drug.id}` : "重量未登録・実測値を入力できます"
      : `${drug.unit}剤重量 ${displayWeight(drug.weightG)}${drug.approx ? "（約）" : ""}${drug.status === "user-provided" ? "（利用者確認値）" : ""} · YJ ${drug.id}`;
    button.append(name, meta);
    button.addEventListener("click", () => { state.selected = drug; $("form-status").textContent = ""; renderSelected(); renderResults(); $("gross").focus(); });
    root.append(button);
  }
}

function renderSelected() {
  const root = $("selected"); root.replaceChildren();
  const drug = state.selected;
  $("manual-weight-field").hidden = !drug || drug.weightG !== null;
  $("manual-weight").value = drug?.weightG === null && state.manualWeights[drug.id] ? state.manualWeights[drug.id] : "";
  $("clear-manual-weight").hidden = !drug || !state.manualWeights[drug.id];
  if (!drug) { root.className = "selected empty"; root.textContent = "左の一覧から医薬品を選択してください。"; updateCalculation(); return; }
  root.className = "selected";
  const name = document.createElement("strong"); name.textContent = drug.name;
  const detail = document.createElement("small");
  detail.textContent = drug.weightG === null ? `添付文書の重量は未登録です。実測した1${drug.unit}の重量で計算できます。 · YJ ${drug.id}` : `1${drug.unit}当たり ${displayWeight(drug.weightG)}${drug.approx ? "（添付文書では約）" : ""}${drug.status === "user-provided" ? "（利用者確認値・出典未登録）" : ""} · YJ ${drug.id}`;
  root.append(name, detail);
  if (drug.source) {
    const link = document.createElement("a"); link.href = drug.source; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "PMDA添付文書を確認 ↗";
    const source = document.createElement("small"); source.append(link);
    if (drug.sourceText) source.append(document.createTextNode(` · 記載値: ${drug.sourceText}`));
    root.append(source);
  }
  updateCalculation();
}

function calculate() {
  const unitWeight = activeUnitWeight();
  if (unitWeight === null) return null;
  const gross = parseWeight($("gross").value);
  const tare = parseWeight($("tare").value, true);
  if (gross === null || tare === null || gross <= 0 || tare < 0 || gross <= tare) return null;
  const net = gross - tare;
  const raw = net / unitWeight;
  const quantity = Math.round(raw);
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null;
  return { gross, tare, net, raw, quantity, unitWeight };
}

function updateCalculation() {
  const result = calculate(); const box = $("calculation"); const drug = state.selected;
  $("add").disabled = !result;
  box.className = "calculation";
  if (drug?.weightG === null && activeUnitWeight() === null) { box.classList.add("warning"); box.textContent = "1個の実測重量を入力してください。"; return; }
  if (!result) { box.textContent = "医薬品と重量を入力すると推定数量が表示されます。"; return; }
  box.classList.add("ready");
  const quantity = document.createElement("strong"); quantity.textContent = `${result.quantity.toLocaleString("ja-JP")}${drug.unit}`;
  const label = document.createElement("span"); label.textContent = "推定数量";
  const details = document.createElement("small");
  details.textContent = `正味 ${displayAmount(result.net)} ÷ 1${drug.unit} ${drug.weightG === null ? displayMeasuredWeight(result.unitWeight) + "（実測）" : displayWeight(result.unitWeight)} ＝ ${result.raw.toFixed(2)}`;
  box.replaceChildren(label, quantity, details);
}

function groupedRows() {
  const grouped = new Map();
  for (const row of state.ledger) {
    const key = row.id;
    if (!grouped.has(key)) grouped.set(key, { ...row, quantity: 0, net: 0, measurements: 0, measuredWeights: new Set() });
    const current = grouped.get(key);
    current.quantity += row.quantity;
    current.net += row.net;
    current.measurements++;
    if (row.weightSource === "measured") current.measuredWeights.add(row.unitWeight);
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

function renderLedger() {
  const root = $("ledger"); root.replaceChildren();
  const rows = groupedRows();
  for (const row of rows) {
    const tr = document.createElement("tr");
    const name = document.createElement("td"); name.textContent = row.name;
    const detail = document.createElement("small");
    const weights = [...row.measuredWeights];
    detail.textContent = `YJ ${row.id}${weights.length ? ` · 実測1${row.unit} ${weights.map(displayMeasuredWeight).join(" / ")}` : ""}`;
    name.append(detail);
    const qty = document.createElement("td"); qty.textContent = `${row.quantity.toLocaleString("ja-JP")}${row.unit}`;
    const net = document.createElement("td"); net.className = "no-print"; net.textContent = `${displayAmount(row.net)}${row.measurements > 1 ? `（${row.measurements}回）` : ""}`;
    const action = document.createElement("td"); action.className = "no-print";
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove"; remove.textContent = "削除"; remove.setAttribute("aria-label", `${row.name}の記録を削除`);
    remove.addEventListener("click", () => { if (confirm(`${row.name}の記録をすべて削除しますか？`)) { state.ledger = state.ledger.filter(item => item.id !== row.id); saveLedger(); renderLedger(); } });
    action.append(remove); tr.append(name, qty, net, action); root.append(tr);
  }
  $("ledger-empty").hidden = rows.length > 0;
  $("ledger-total").textContent = rows.length ? `${rows.length}品目 · 測定記録 ${state.ledger.length}件` : "";
  $("print").disabled = rows.length === 0;
  $("printed-at").textContent = `印刷日時：${new Date().toLocaleString("ja-JP")}`;
}

function normalizeNumericInput(event) {
  $("form-status").textContent = "";
  const input = event.currentTarget;
  const before = input.value;
  const cursor = input.selectionStart;
  const after = normalizeNumber(before);
  if (after !== before) {
    input.value = after;
    if (cursor !== null) {
      const pos = normalizeNumber(before.slice(0, cursor)).length;
      input.setSelectionRange(pos, pos);
    }
  }
  updateCalculation();
}

$("search").addEventListener("input", renderResults);
$("clear-search").addEventListener("click", () => { $("search").value = ""; renderResults(); $("search").focus(); });
for (const id of ["gross", "tare", "manual-weight"]) $(id).addEventListener("input", normalizeNumericInput);
$("measure-form").addEventListener("submit", event => {
  event.preventDefault(); $("form-error").textContent = "";
  const result = calculate();
  if (!result) { $("form-error").textContent = "医薬品、測定重量、容器の重さを確認してください。"; return; }
  const drug = state.selected;
  const measured = drug.weightG === null;
  if (measured) {
    state.manualWeights[drug.id] = result.unitWeight;
    try { localStorage.setItem(MANUAL_WEIGHT_KEY, JSON.stringify(state.manualWeights)); }
    catch { $("form-error").textContent = "実測重量をブラウザーに保存できませんでした。"; }
    $("clear-manual-weight").hidden = false;
    renderResults();
  }
  state.ledger.push({ id: drug.id, name: drug.name, unit: drug.unit, quantity: result.quantity, net: result.net,
    weightSource: measured ? "measured" : drug.status, unitWeight: result.unitWeight, createdAt: new Date().toISOString() });
  saveLedger(); renderLedger();
  $("gross").value = ""; $("tare").value = ""; updateCalculation(); $("gross").focus();
  $("form-status").textContent = `${drug.name}を${result.quantity.toLocaleString("ja-JP")}${drug.unit}追加しました。`;
});
$("print").addEventListener("click", () => { renderLedger(); window.print(); });
$("clear-manual-weight").addEventListener("click", () => {
  const drug = state.selected;
  if (!drug || drug.weightG !== null || !state.manualWeights[drug.id]) return;
  if (!confirm(`${drug.name}の保存済み実測重量を消去しますか？ 既に追加した棚卸し記録は残ります。`)) return;
  delete state.manualWeights[drug.id];
  try { localStorage.setItem(MANUAL_WEIGHT_KEY, JSON.stringify(state.manualWeights)); }
  catch { $("form-error").textContent = "実測重量の保存情報を更新できませんでした。"; }
  $("manual-weight").value = "";
  $("clear-manual-weight").hidden = true;
  $("form-status").textContent = "保存済みの実測重量を消去しました。";
  renderResults(); updateCalculation();
});
$("clear-ledger").addEventListener("click", () => { if (state.ledger.length && confirm("棚卸し一覧をすべて削除しますか？")) { state.ledger = []; saveLedger(); renderLedger(); } });

async function init() {
  try {
    const response = await fetch("drugs.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.drugs = data.drugs;
    const available = state.drugs.filter(drug => drug.weightG !== null).length;
    $("coverage").textContent = `登録 ${state.drugs.length}品目 / 重量確認 ${available}品目`;
    $("data-date").textContent = ` データ確認日：${data.updated}`;
    renderResults(); renderLedger();
  } catch {
    $("results").textContent = "医薬品データを読み込めませんでした。ページを再読み込みしてください。";
    $("coverage").textContent = "データ読み込みエラー";
  }
}
init();
