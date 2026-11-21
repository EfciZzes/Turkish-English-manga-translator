/* Manga Çevirici — arka plan (service worker)
   Görseli indirir, parçalara böler, OCR yapar, çeviri servisini çağırır. */
'use strict';

const DEFAULTS = { ocrProvider: 'ocrspace', ocrspaceKey: '', visionKey: '' };

/* ---------- OCR önbelleği (görselin içeriğine göre) ve kullanım sayacı ---------- */

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const r = indexedDB.open('mc-ocr', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('ocr', { keyPath: 'k' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbPromise;
}

async function cacheGet(k) {
  try {
    const d = await openDb();
    return await new Promise((res) => {
      const q = d.transaction('ocr').objectStore('ocr').get(k);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => res(null);
    });
  } catch (e) { return null; }
}

async function cachePut(v) {
  try {
    const d = await openDb();
    await new Promise((res) => {
      const t = d.transaction('ocr', 'readwrite');
      t.objectStore('ocr').put(v);
      t.oncomplete = res;
      t.onerror = res;
      t.onabort = res;
    });
  } catch (e) { /* önbellek en iyi çaba */ }
}

async function clearCache() {
  const d = await openDb();
  await new Promise((res) => {
    const t = d.transaction('ocr', 'readwrite');
    t.objectStore('ocr').clear();
    t.oncomplete = res;
    t.onerror = res;
    t.onabort = res;
  });
  return true;
}

async function hashBlob(blob) {
  const h = await crypto.subtle.digest('SHA-1', await blob.arrayBuffer());
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let usageChain = Promise.resolve();
function bump(kind) {
  usageChain = usageChain.then(async () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const day = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    const month = day.slice(0, 7);
    const { usage } = await chrome.storage.local.get({ usage: {} });
    const u = { day: '', dayCount: 0, cacheDay: 0, pageDay: 0, month: '', monthCount: 0, ...usage };
    if (u.day !== day) { u.day = day; u.dayCount = 0; u.cacheDay = 0; u.pageDay = 0; }
    if (u.month !== month) { u.month = month; u.monthCount = 0; }
    if (kind === 'ocr') { u.dayCount++; u.monthCount++; }
    else if (kind === 'page') { u.pageDay++; }
    else { u.cacheDay++; }
    await chrome.storage.local.set({ usage: u });
  }).catch(() => {});
  return usageChain;
}

/* ---------- Kurulum, menü, kısayol ---------- */

chrome.runtime.onInstalled.addListener((d) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'mc-image',
      title: 'Bu görseli çevir (Manga Çevirici)',
      contexts: ['image'],
    });
  });
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'mc-image' && tab && tab.id != null) {
    chrome.tabs.sendMessage(tab.id, { type: 'translateSrc', srcUrl: info.srcUrl }).catch(() => {});
  }
});

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'translate-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, { type: 'toggle' }).catch(() => {});
});

/* ---------- Mesajlaşma ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      let data;
      if (msg.type === 'processUrl') data = await processUrl(msg);
      else if (msg.type === 'processData') data = await processData(msg);
      else if (msg.type === 'translate') data = await translateAll(msg.texts, msg.sl, msg.tl);
      else if (msg.type === 'clearCache') data = await clearCache();
      else { sendResponse({ error: 'Bilinmeyen istek' }); return; }
      sendResponse({ data });
    } catch (e) {
      sendResponse({ error: e && e.message ? e.message : String(e) });
    }
  })();
  return true; // yanıt asenkron
});

/* ---------- Yardımcılar ---------- */

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  }
  return btoa(bin);
}

async function blobToDataUrl(blob) {
  const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  return 'data:' + type + ';base64,' + bufToB64(await blob.arrayBuffer());
}

/* Bazı manga siteleri görseli sadece kendi sayfasından (Referer) verir. */
const hostRule = new Map();
let ruleSeq = 1000;
async function setReferer(url, referer) {
  if (!referer) return;
  let host;
  try { host = new URL(url).hostname; } catch (e) { return; }
  let id = hostRule.get(host);
  if (!id) { id = ++ruleSeq; hostRule.set(host, id); }
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [{
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'referer', operation: 'set', value: referer }],
      },
      condition: {
        requestDomains: [host],
        resourceTypes: ['xmlhttprequest', 'other'],
        tabIds: [chrome.tabs.TAB_ID_NONE],
      },
    }],
  });
}

async function fetchBlob(url, referer) {
  try { await setReferer(url, referer); } catch (e) { console.warn('Referer kuralı eklenemedi', e); }
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error('Görsel indirilemedi (HTTP ' + r.status + ')');
  return await r.blob();
}

/* ---------- Görsel işleme akışı ---------- */

async function processUrl(msg) {
  const blob = await fetchBlob(msg.url, msg.referer);
  const res = await ocrBlob(blob, msg.opts || {});
  res.dataUrl = await blobToDataUrl(blob);
  return res;
}

async function processData(msg) {
  const blob = await (await fetch(msg.dataUrl)).blob();
  return await ocrBlob(blob, msg.opts || {});
}

/* Uzun (webtoon) görselleri boşluk satırlarından keserek parçalara böl. */
function findCut(bmp, targetY, back) {
  const y0 = Math.max(0, targetY - back);
  const h = Math.min(bmp.height, targetY) - y0;
  if (h < 20) return targetY;
  const sw = 120;
  const oc = new OffscreenCanvas(sw, h);
  const x = oc.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, y0, bmp.width, h, 0, 0, sw, h);
  const d = x.getImageData(0, 0, sw, h).data;
  const v = new Array(h);
  for (let r = 0; r < h; r++) {
    let s = 0;
    let s2 = 0;
    for (let c = 0; c < sw; c++) {
      const i = (r * sw + c) * 4;
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      s += l;
      s2 += l * l;
    }
    const m = s / sw;
    v[r] = s2 / sw - m * m;
  }
  let best = h - 1;
  let bestV = Infinity;
  const W = 4;
  for (let r = W; r < h - W; r++) {
    let a = 0;
    for (let k = -W; k <= W; k++) a += v[r + k];
    a /= 2 * W + 1;
    if (a <= bestV) { bestV = a; best = r; }
  }
  return y0 + best;
}

function planCuts(bmp, sliceH) {
  const H = bmp.height;
  const cuts = [0];
  let y = 0;
  while (H - y > sliceH * 1.3) {
    const target = y + sliceH;
    const cut = findCut(bmp, target, Math.floor(sliceH * 0.3));
    const c = cut > y + sliceH * 0.5 ? cut : target;
    cuts.push(c);
    y = c;
  }
  cuts.push(H);
  return cuts;
}

async function encodeSlice(bmp, y0, y1, scale, maxBytes) {
  let s = scale;
  let q = 0.88;
  let last = null;
  for (let i = 0; i < 7; i++) {
    const cw = Math.max(1, Math.round(bmp.width * s));
    const ch = Math.max(1, Math.round((y1 - y0) * s));
    const oc = new OffscreenCanvas(cw, ch);
    const x = oc.getContext('2d');
    x.fillStyle = '#fff';
    x.fillRect(0, 0, cw, ch);
    x.drawImage(bmp, 0, y0, bmp.width, y1 - y0, 0, 0, cw, ch);
    const blob = await oc.convertToBlob({ type: 'image/jpeg', quality: q });
    last = { blob, s: cw / bmp.width };
    if (blob.size <= maxBytes) return last;
    if (q > 0.6) q -= 0.12; else s *= 0.8;
  }
  if (last && last.blob.size <= maxBytes * 1.05) return last;
  throw new Error('Görsel OCR için fazla büyük, küçültülemedi.');
}

async function ocrBlob(blob, opts) {
  const st = await chrome.storage.local.get(DEFAULTS);
  const provider = st.ocrProvider === 'vision' ? 'vision' : 'ocrspace';
  const key = provider === 'vision' ? st.visionKey : st.ocrspaceKey;
  if (!key) {
    throw new Error('OCR API anahtarı girilmemiş. Eklenti simgesi > Ayarlar sayfasından ekle.');
  }
  const sl = opts.sl === 'tr' ? 'tr' : 'en';

  // Aynı görsel daha önce okunduysa servise hiç istek gitmesin
  const cacheKey = provider + '|' + sl + '|' + (await hashBlob(blob));
  const hit = await cacheGet(cacheKey);
  if (hit) {
    await bump('cache');
    return { width: hit.width, height: hit.height, lines: hit.lines };
  }

  await bump('page');
  const bmp = await createImageBitmap(blob);
  const W = bmp.width;
  const H = bmp.height;
  // sliceH: küçültülmüş görseldeki en büyük parça yüksekliği (daha az parça = daha az istek)
  const cfg = provider === 'vision'
    ? { maxW: 2400, sliceH: 3200, maxBytes: 6000000 }
    : { maxW: 1400, sliceH: 3500, maxBytes: 950000 };
  const scale0 = Math.min(1, cfg.maxW / W);
  const cuts = planCuts(bmp, Math.round(cfg.sliceH / scale0));
  const lines = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const y0 = cuts[k];
    const y1 = cuts[k + 1];
    const { blob: sb, s } = await encodeSlice(bmp, y0, y1, scale0, cfg.maxBytes);
    const part = provider === 'vision'
      ? await visionOcr(sb, key, sl)
      : await ocrSpaceOcr(sb, key, sl);
    for (const l of part) {
      lines.push({ text: l.text, x: l.x / s, y: l.y / s + y0, w: l.w / s, h: l.h / s });
    }
  }
  if (bmp.close) bmp.close();
  await cachePut({ k: cacheKey, width: W, height: H, lines, ts: Date.now() });
  return { width: W, height: H, lines };
}

/* ---------- OCR sağlayıcıları ---------- */

async function ocrSpaceOcr(blob, key, sl) {
  await bump('ocr');
  const fd = new FormData();
  fd.append('file', blob, 'page.jpg');
  fd.append('language', sl === 'tr' ? 'tur' : 'eng');
  fd.append('isOverlayRequired', 'true');
  fd.append('OCREngine', sl === 'tr' ? '1' : '2');
  fd.append('scale', 'true');
  fd.append('detectOrientation', 'false');
  const r = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: { apikey: key },
    body: fd,
  });
  if (r.status === 403 || r.status === 429) {
    throw new Error('OCR.space kota veya hız sınırı doldu ya da anahtar hatalı (HTTP ' + r.status + ')');
  }
  if (!r.ok) throw new Error('OCR.space hatası (HTTP ' + r.status + ')');
  const j = await r.json();
  if (j.IsErroredOnProcessing) {
    const m = Array.isArray(j.ErrorMessage) ? j.ErrorMessage.join(' ') : (j.ErrorMessage || 'bilinmeyen hata');
    throw new Error('OCR.space: ' + m);
  }
  const out = [];
  for (const p of j.ParsedResults || []) {
    const ov = p.TextOverlay;
    if (!ov || !ov.Lines) continue;
    for (const ln of ov.Lines) {
      const ws = ln.Words || [];
      if (!ws.length) continue;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const w of ws) {
        x0 = Math.min(x0, w.Left);
        y0 = Math.min(y0, w.Top);
        x1 = Math.max(x1, w.Left + w.Width);
        y1 = Math.max(y1, w.Top + w.Height);
      }
      out.push({
        text: ln.LineText || ws.map((w) => w.WordText).join(' '),
        x: x0, y: y0, w: x1 - x0, h: y1 - y0,
      });
    }
  }
  return out;
}

async function visionOcr(blob, key, sl) {
  await bump('ocr');
  const b64 = bufToB64(await blob.arrayBuffer());
  const body = {
    requests: [{
      image: { content: b64 },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      imageContext: { languageHints: [sl] },
    }],
  };
  const r = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    throw new Error('Google Vision: ' + ((j.error && j.error.message) || 'HTTP ' + r.status));
  }
  const resp = j.responses && j.responses[0];
  if (resp && resp.error) throw new Error('Google Vision: ' + resp.error.message);
  const out = [];
  const pages = (resp && resp.fullTextAnnotation && resp.fullTextAnnotation.pages) || [];
  for (const pg of pages) {
    for (const bl of pg.blocks || []) {
      for (const pa of bl.paragraphs || []) {
        let text = '';
        let xs = [];
        let ys = [];
        const flush = () => {
          const t = text.trim();
          if (t && xs.length) {
            const x0 = Math.min(...xs);
            const x1 = Math.max(...xs);
            const y0 = Math.min(...ys);
            const y1 = Math.max(...ys);
            out.push({ text: t, x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
          }
          text = '';
          xs = [];
          ys = [];
        };
        for (const w of pa.words || []) {
          for (const v of (w.boundingBox && w.boundingBox.vertices) || []) {
            xs.push(v.x || 0);
            ys.push(v.y || 0);
          }
          for (const s of w.symbols || []) {
            text += s.text;
            const br = s.property && s.property.detectedBreak && s.property.detectedBreak.type;
            if (br === 'SPACE' || br === 'SURE_SPACE') text += ' ';
            else if (br === 'EOL_SURE_SPACE' || br === 'LINE_BREAK') flush();
          }
        }
        flush();
      }
    }
  }
  return out;
}

/* ---------- Çeviri (Google Translate'in herkese açık ucu) ---------- */

async function translateOne(text, sl, tl) {
  if (!text || !text.trim()) return '';
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + sl +
    '&tl=' + tl + '&q=' + encodeURIComponent(text);
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('Çeviri servisi HTTP ' + r.status);
      const j = await r.json();
      return (j[0] || []).map((s) => s[0] || '').join('').trim();
    } catch (e) {
      last = e;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw last;
}

async function translateAll(texts, sl, tl) {
  const out = new Array(texts.length);
  let i = 0;
  async function worker() {
    while (i < texts.length) {
      const k = i++;
      out[k] = await translateOne(texts[k], sl, tl);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return out;
}
