'use strict';
const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  dir: 'en-tr', glossaries: { Genel: '' }, activeSeries: {},
  ocrProvider: 'ocrspace', ocrspaceKey: '', visionKey: '',
};
let tab = null;
let host = '';
let cache = { ...DEFAULTS };

async function ask(type) {
  try { return await chrome.tabs.sendMessage(tab.id, { type }); } catch (e) { return null; }
}

function renderSeries() {
  const names = Object.keys(cache.glossaries);
  if (!names.includes('Genel')) names.unshift('Genel');
  const active = cache.activeSeries[host] || 'Genel';
  $('series').innerHTML = '';
  for (const n of names) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n === 'Genel' ? 'Genel (her yerde geçerli)' : n;
    if (n === active) o.selected = true;
    $('series').appendChild(o);
  }
}

async function refresh() {
  const s = await ask('getState');
  const startBtn = $('start');
  if (!s) {
    $('status').textContent = 'Bu sayfada çalışmıyor. Sayfayı yenileyip tekrar dene.';
    startBtn.disabled = true;
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = s.auto ? 'Çeviriyor…' : 'Sayfayı çevir';
  $('status').textContent = s.auto
    ? 'Açık · çevrilen: ' + s.translated + ' · sırada: ' + s.busy + (s.failed ? ' · hata: ' + s.failed : '')
    : 'Kapalı';
}

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { host = new URL(tab.url).hostname; } catch (e) { host = ''; }
  cache = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  $('dir').value = cache.dir;
  renderSeries();
  const key = cache.ocrProvider === 'vision' ? cache.visionKey : cache.ocrspaceKey;
  $('warn').hidden = !!key;
  refresh();
  setInterval(refresh, 1500);
}

$('start').onclick = async () => { await ask('start'); refresh(); };
$('stop').onclick = async () => { await ask('stop'); refresh(); };
$('dir').onchange = () => chrome.storage.local.set({ dir: $('dir').value });

$('series').onchange = async () => {
  cache.activeSeries[host] = $('series').value;
  await chrome.storage.local.set({ activeSeries: cache.activeSeries });
};

$('addSeries').onclick = async () => {
  const name = $('newSeries').value.trim();
  if (!name) return;
  if (!cache.glossaries[name]) cache.glossaries[name] = '';
  cache.activeSeries[host] = name;
  await chrome.storage.local.set({ glossaries: cache.glossaries, activeSeries: cache.activeSeries });
  $('newSeries').value = '';
  renderSeries();
};

$('addTerm').onclick = async () => {
  const term = $('term').value.trim();
  if (!term) return;
  const name = $('series').value || 'Genel';
  const cur = cache.glossaries[name] || '';
  cache.glossaries[name] = cur ? cur.replace(/\s+$/, '') + '\n' + term : term;
  await chrome.storage.local.set({ glossaries: cache.glossaries });
  $('term').value = '';
  $('status').textContent = '"' + term + '" sözlüğe eklendi.';
};

$('term').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addTerm').click(); });
$('newSeries').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addSeries').click(); });
$('openOpt1').onclick = () => chrome.runtime.openOptionsPage();
$('openOpt2').onclick = () => chrome.runtime.openOptionsPage();

init();
