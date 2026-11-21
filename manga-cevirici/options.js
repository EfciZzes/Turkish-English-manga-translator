'use strict';
const $ = (id) => document.getElementById(id);
const DEFAULT_FONT = '"Comic Neue","Comic Sans MS","Segoe UI",Arial,sans-serif';
const DEFAULTS = {
  ocrProvider: 'ocrspace', ocrspaceKey: '', visionKey: '',
  dir: 'en-tr', upper: 'auto', font: DEFAULT_FONT, minSize: 300,
  autoProper: true, skipSfx: true,
  glossaries: { Genel: '' }, activeSeries: {},
};
let glossaries = { Genel: '' };
let current = 'Genel';

function renderSeries() {
  $('series').innerHTML = '';
  for (const n of Object.keys(glossaries)) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    if (n === current) o.selected = true;
    $('series').appendChild(o);
  }
  $('gloss').value = glossaries[current] || '';
  $('delSeries').disabled = current === 'Genel';
}

function stash() { glossaries[current] = $('gloss').value; }

async function load() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  $('ocrProvider').value = s.ocrProvider;
  $('ocrspaceKey').value = s.ocrspaceKey;
  $('visionKey').value = s.visionKey;
  $('dir').value = s.dir;
  $('upper').value = s.upper;
  $('font').value = s.font;
  $('minSize').value = s.minSize;
  $('autoProper').checked = !!s.autoProper;
  $('skipSfx').checked = !!s.skipSfx;
  glossaries = { Genel: '', ...s.glossaries };
  current = 'Genel';
  renderSeries();
}

$('series').onchange = () => { stash(); current = $('series').value; renderSeries(); };

$('addSeries').onclick = () => {
  const name = $('newSeries').value.trim();
  if (!name) return;
  stash();
  if (!(name in glossaries)) glossaries[name] = '';
  current = name;
  $('newSeries').value = '';
  renderSeries();
};

$('delSeries').onclick = () => {
  if (current === 'Genel') return;
  if (!confirm('"' + current + '" serisinin sözlüğü silinsin mi?')) return;
  delete glossaries[current];
  current = 'Genel';
  renderSeries();
};

$('save').onclick = async () => {
  stash();
  const minSize = Math.max(100, Math.min(2000, parseInt($('minSize').value, 10) || 300));
  await chrome.storage.local.set({
    ocrProvider: $('ocrProvider').value,
    ocrspaceKey: $('ocrspaceKey').value.trim(),
    visionKey: $('visionKey').value.trim(),
    dir: $('dir').value,
    upper: $('upper').value,
    font: $('font').value.trim() || DEFAULT_FONT,
    minSize,
    autoProper: $('autoProper').checked,
    skipSfx: $('skipSfx').checked,
    glossaries,
  });
  $('minSize').value = minSize;
  $('saved').hidden = false;
  setTimeout(() => { $('saved').hidden = true; }, 2500);
};

$('clearCache').onclick = () => {
  chrome.runtime.sendMessage({ type: 'clearCache' }, (r) => {
    $('cacheMsg').textContent = r && !r.error ? ' Temizlendi.' : ' Temizlenemedi.';
  });
};

load();
