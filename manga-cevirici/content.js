/* Manga Çevirici — sayfa betiği
   Görselleri bulur, arka plana OCR/çeviri yaptırır, sonucu görselin üstüne çizer. */
(() => {
  'use strict';
  if (window.__mcLoaded) return;
  window.__mcLoaded = true;
  const MC = globalThis.MC;

  const DEFAULT_FONT = '"Comic Neue","Comic Sans MS","Segoe UI",Arial,sans-serif';
  const DEFAULTS = {
    dir: 'en-tr',
    font: DEFAULT_FONT,
    upper: 'auto',
    autoProper: true,
    skipSfx: true,
    minSize: 300,
    glossaries: { Genel: '' },
    activeSeries: {},
  };

  const S = { auto: false, io: null, mo: null, queue: [], active: 0, done: 0, failed: 0, imgs: new Set() };
  const CONCURRENCY = 2;

  /* ---------- Küçük yardımcılar ---------- */

  function injectStyle() {
    if (document.getElementById('mc-style')) return;
    const st = document.createElement('style');
    st.id = 'mc-style';
    st.textContent =
      '.mc-busy{opacity:.55!important;outline:3px dashed #7c5cff!important;outline-offset:-3px!important}' +
      '#mc-toast{position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:320px;padding:10px 14px;' +
      'background:#25252e;color:#fff;font:13px/1.4 system-ui,sans-serif;border-radius:10px;' +
      'box-shadow:0 4px 18px rgba(0,0,0,.35);opacity:0;transition:opacity .2s;pointer-events:none}' +
      '#mc-toast.on{opacity:1}';
    (document.head || document.documentElement).appendChild(st);
  }

  let toastTimer = null;
  function toast(text) {
    injectStyle();
    let t = document.getElementById('mc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'mc-toast';
      document.documentElement.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 4500);
  }

  function send(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (r) => {
          const e = chrome.runtime.lastError;
          if (e) return reject(new Error(e.message));
          if (!r) return reject(new Error('Arka plan yanıt vermedi'));
          if (r.error) return reject(new Error(r.error));
          resolve(r.data);
        });
      } catch (e) {
        reject(new Error('Eklenti yeniden yüklendi, sayfayı yenile.'));
      }
    });
  }

  async function getSettings() {
    const s = await chrome.storage.local.get(DEFAULTS);
    return { ...DEFAULTS, ...s };
  }

  function entriesFor(settings) {
    const g = settings.glossaries || {};
    const active = (settings.activeSeries || {})[location.hostname];
    let txt = g.Genel || '';
    if (active && active !== 'Genel' && g[active]) txt += '\n' + g[active];
    return MC.parseGlossary(txt);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error('Görsel okunamadı'));
      fr.readAsDataURL(blob);
    });
  }

  async function loadImage(dataUrl) {
    const im = new Image();
    im.src = dataUrl;
    await im.decode();
    return im;
  }

  /* ---------- Görseli al + OCR ---------- */

  async function acquire(img, sl) {
    const src = img.currentSrc || img.src;
    if (!src) throw new Error('Görselin adresi bulunamadı');

    if (/^(data|blob):/i.test(src)) {
      const blob = await (await fetch(src)).blob();
      const dataUrl = await blobToDataUrl(blob);
      const res = await send({ type: 'processData', dataUrl, opts: { sl } });
      return { ...res, dataUrl };
    }

    try {
      return await send({ type: 'processUrl', url: src, referer: location.href, opts: { sl } });
    } catch (e) {
      if (!/indirilemedi|Failed to fetch/i.test(e.message)) throw e;
      // Son çare: sayfadaki görseli tuvale çiz (CORS izin vermezse hata verir)
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        const dataUrl = c.toDataURL('image/jpeg', 0.92);
        const res = await send({ type: 'processData', dataUrl, opts: { sl } });
        return { ...res, dataUrl };
      } catch (_) {
        throw e;
      }
    }
  }

  /* ---------- Çizim ---------- */

  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  function sampleBg(ctx, x, y, w, h) {
    const t = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) / 6)));
    const d = ctx.getImageData(x, y, w, h).data;
    const R = [];
    const G = [];
    const B = [];
    const push = (cx, cy) => {
      const i = (cy * w + cx) * 4;
      R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]);
    };
    for (let cx = 0; cx < w; cx++) {
      for (let k = 0; k < t; k++) { push(cx, k); push(cx, h - 1 - k); }
    }
    for (let cy = t; cy < h - t; cy++) {
      for (let k = 0; k < t; k++) { push(k, cy); push(w - 1 - k, cy); }
    }
    const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    const r = med(R.slice());
    const g = med(G.slice());
    const b = med(B.slice());
    const L = luma(r, g, b);
    let dev = 0;
    for (let i = 0; i < R.length; i++) dev += Math.abs(luma(R[i], G[i], B[i]) - L);
    dev /= R.length || 1;
    return { r, g, b, L, dev };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function paintCover(ctx, canvas, p) {
    const { rx, ry, rw, rh, bg, it } = p;
    const rad = Math.min(rw, rh) * 0.22;
    if (bg.dev <= 22) {
      // düz zemin: ortanca renkle kapat
      ctx.save();
      ctx.fillStyle = 'rgb(' + bg.r + ',' + bg.g + ',' + bg.b + ')';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = Math.max(2, it.lineH * 0.25);
      roundRectPath(ctx, rx, ry, rw, rh, rad);
      ctx.fill();
      ctx.restore();
    } else {
      // desenli/degrade zemin: bulanıklaştır, üstüne zemin rengini sür
      const tmp = document.createElement('canvas');
      tmp.width = rw;
      tmp.height = rh;
      const t = tmp.getContext('2d');
      t.filter = 'blur(' + Math.max(5, Math.round(it.lineH * 0.5)) + 'px)';
      t.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
      ctx.save();
      roundRectPath(ctx, rx, ry, rw, rh, rad);
      ctx.clip();
      ctx.drawImage(tmp, rx, ry);
      ctx.fillStyle = 'rgba(' + bg.r + ',' + bg.g + ',' + bg.b + ',0.88)';
      ctx.fillRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }

  function wrapWords(ctx, words, maxW) {
    const lines = [];
    let cur = '';
    let broke = false;
    for (const w of words) {
      if (ctx.measureText(w).width > maxW) {
        if (cur) { lines.push(cur); cur = ''; }
        let chunk = '';
        for (const ch of w) {
          if (chunk && ctx.measureText(chunk + ch).width > maxW) {
            lines.push(chunk);
            chunk = ch;
            broke = true;
          } else chunk += ch;
        }
        cur = chunk;
        continue;
      }
      const test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) cur = test;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return { lines, broke };
  }

  function fitFont(ctx, text, fam, bw, bh, maxS, minS) {
    const words = text.split(' ');
    let lo = minS;
    let hi = Math.max(minS, Math.floor(maxS));
    let best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      ctx.font = 'bold ' + mid + 'px ' + fam;
      const { lines, broke } = wrapWords(ctx, words, bw);
      if (!broke && lines.length * mid * 1.12 <= bh) { best = { size: mid, lines }; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best) return best;
    ctx.font = 'bold ' + minS + 'px ' + fam;
    return { size: minS, lines: wrapWords(ctx, words, bw).lines };
  }

  function drawText(ctx, p, settings, tl, W, H) {
    const { it, rx, ry, rw, rh, bg } = p;
    let t = (it.out || '').replace(/\s+/g, ' ').trim();
    if (!t) return;
    const up = settings.upper === 'yes' || (settings.upper !== 'no' && it.wasCaps);
    if (up) t = t.toLocaleUpperCase(tl === 'tr' ? 'tr' : 'en');

    // Çevrilen metin genelde uzar: yazı kutusunu kapatılan alandan biraz büyük tut
    const gx = rw * 0.08;
    const gy = rh * 0.08;
    const bx = Math.max(0, rx - gx);
    const by = Math.max(0, ry - gy);
    const bw = Math.min(W - bx, rw + 2 * gx);
    const bh = Math.min(H - by, rh + 2 * gy);

    const fam = settings.font || DEFAULT_FONT;
    const { size, lines } = fitFont(ctx, t, fam, bw * 0.96, bh * 0.96, Math.min(it.lineH * 1.15, bh), 9);
    ctx.font = 'bold ' + size + 'px ' + fam;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = bg.L > 135 ? '#111' : '#fff';
    const lh = size * 1.12;
    let y = by + bh / 2 - (lines.length * lh) / 2 + lh / 2;
    for (const ln of lines) {
      ctx.fillText(ln, bx + bw / 2, y);
      y += lh;
    }
  }

  async function render(dataUrl, items, settings, tl) {
    const im = await loadImage(dataUrl);
    const W = im.naturalWidth;
    const H = im.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0);

    // önce hepsinin zeminini orijinal görselden ölç, sonra boya
    const plans = [];
    for (const it of items) {
      const pad = Math.max(3, Math.round(it.lineH * 0.3));
      const rx = Math.max(0, Math.floor(it.x - pad));
      const ry = Math.max(0, Math.floor(it.y - pad));
      const rw = Math.min(W - rx, Math.ceil(it.w + 2 * pad));
      const rh = Math.min(H - ry, Math.ceil(it.h + 2 * pad));
      if (rw < 4 || rh < 4) continue;
      plans.push({ it, rx, ry, rw, rh, bg: sampleBg(ctx, rx, ry, rw, rh) });
    }
    for (const p of plans) paintCover(ctx, canvas, p);
    for (const p of plans) drawText(ctx, p, settings, tl, W, H);

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new Error('Çevrilmiş görsel oluşturulamadı');
    return URL.createObjectURL(blob);
  }

  /* ---------- Görseli değiştir / geri al ---------- */

  function applyTranslated(img, url) {
    const m = img.__mc;
    if (!m.original) {
      m.original = {
        src: img.getAttribute('src'),
        srcset: img.getAttribute('srcset'),
        sizes: img.getAttribute('sizes'),
        sources: [],
      };
      const pic = img.closest('picture');
      if (pic) pic.querySelectorAll('source').forEach((s) => m.original.sources.push([s, s.getAttribute('srcset')]));
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    m.original.sources.forEach(([s]) => s.removeAttribute('srcset'));
    img.src = url;
    m.blobUrl = url;
    m.status = 'done';
    S.imgs.add(img);
  }

  function revert(img) {
    const m = img.__mc;
    if (!m) return;
    if (m.status === 'busy') { m.cancelled = true; return; }
    if (!m.original) { if (m.status === 'queued' || m.status === 'observing') m.status = undefined; return; }
    const o = m.original;
    if (o.srcset != null) img.setAttribute('srcset', o.srcset);
    if (o.sizes != null) img.setAttribute('sizes', o.sizes);
    o.sources.forEach(([s, v]) => { if (v != null) s.setAttribute('srcset', v); });
    if (o.src != null) img.setAttribute('src', o.src); else img.removeAttribute('src');
    m.status = 'original';
  }

  /* ---------- Ana akış ---------- */

  function qualifies(img, min) {
    return img.complete && img.naturalWidth >= min && img.naturalHeight >= min;
  }

  async function translateImage(img, force) {
    img.__mc = img.__mc || {};
    const m = img.__mc;
    if (m.status === 'busy' || m.status === 'done') return;

    if (m.status === 'original' && m.blobUrl) { // daha önce çevrilmişti, önbellekten göster
      applyTranslated(img, m.blobUrl);
      return;
    }

    m.status = 'busy';
    m.cancelled = false;
    img.classList.add('mc-busy');
    try {
      const settings = await getSettings();
      if (!force && !qualifies(img, settings.minSize)) { m.status = undefined; return; }

      const [sl, tl] = settings.dir === 'tr-en' ? ['tr', 'en'] : ['en', 'tr'];
      const res = await acquire(img, sl);

      let groups = MC.groupLines(res.lines);
      groups = MC.filterGroups(groups, { skipSfx: settings.skipSfx });
      if (!groups.length) { m.status = undefined; S.done++; toast('Bu görselde çevrilecek yazı bulunamadı.'); return; }

      const entries = entriesFor(settings);
      const prepared = groups.map((g) => MC.prepare(g.text, entries, {
        lang: sl,
        autoProper: settings.autoProper,
      }));
      const translated = await send({ type: 'translate', texts: prepared.map((p) => p.masked), sl, tl });

      const items = groups.map((g, i) => ({
        ...g,
        wasCaps: prepared[i].wasCaps,
        out: MC.restore(translated[i], prepared[i].map, { fixTr: tl === 'tr' }),
      }));

      const url = await render(res.dataUrl, items, settings, tl);
      if (m.cancelled) { URL.revokeObjectURL(url); m.status = undefined; return; }
      applyTranslated(img, url);
      S.done++;
    } catch (e) {
      m.status = 'error';
      S.failed++;
      console.warn('[Manga Çevirici]', e);
      toast('Çeviri hatası: ' + (e && e.message ? e.message : e));
    } finally {
      img.classList.remove('mc-busy');
    }
  }

  function enqueue(img, force) {
    img.__mc = img.__mc || {};
    if (img.__mc.status !== 'done') img.__mc.status = 'queued';
    S.queue.push({ img, force });
    pump();
  }

  function pump() {
    while (S.active < CONCURRENCY && S.queue.length) {
      const { img, force } = S.queue.shift();
      S.active++;
      translateImage(img, force).finally(() => { S.active--; pump(); });
    }
  }

  /* ---------- Otomatik mod: görünür görselleri çevir ---------- */

  function onIntersect(entries) {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      S.io.unobserve(e.target);
      if (S.auto) enqueue(e.target, false);
    }
  }

  async function consider(img) {
    if (!S.auto) return;
    const st = img.__mc && img.__mc.status;
    if (st === 'busy' || st === 'done' || st === 'queued' || st === 'observing') return;
    if (!img.complete || !img.naturalWidth) {
      if (!img.__mcL) {
        img.__mcL = true;
        img.addEventListener('load', () => { img.__mcL = false; consider(img); }, { once: true });
      }
      return;
    }
    const s = await getSettings();
    if (!S.auto || !qualifies(img, s.minSize)) return;
    img.__mc = img.__mc || {};
    img.__mc.status = 'observing';
    S.io.observe(img);
  }

  function scan() {
    document.querySelectorAll('img').forEach((i) => consider(i));
  }

  async function startAuto() {
    injectStyle();
    if (S.auto) { scan(); return; }
    S.auto = true;
    S.io = new IntersectionObserver(onIntersect, { rootMargin: '1200px 0px 1200px 0px' });
    S.mo = new MutationObserver((muts) => {
      for (const mu of muts) {
        if (mu.type === 'attributes') {
          if (mu.target.tagName === 'IMG') consider(mu.target);
          continue;
        }
        mu.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'IMG') consider(n);
          else if (n.querySelectorAll) n.querySelectorAll('img').forEach((i) => consider(i));
        });
      }
    });
    S.mo.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['src'],
    });
    scan();
  }

  function stopAuto() {
    S.auto = false;
    if (S.io) S.io.disconnect();
    if (S.mo) S.mo.disconnect();
    S.io = null;
    S.mo = null;
    S.queue.length = 0;
    document.querySelectorAll('img').forEach((i) => revert(i));
  }

  const state = () => ({
    auto: S.auto,
    busy: S.active + S.queue.length,
    done: S.done,
    failed: S.failed,
    translated: [...S.imgs].filter((i) => i.__mc && i.__mc.status === 'done').length,
  });

  /* ---------- Mesajlar (popup / kısayol / sağ tık menüsü) ---------- */

  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    (async () => {
      try {
        switch (msg.type) {
          case 'start':
            await startAuto();
            break;
          case 'stop':
            stopAuto();
            break;
          case 'toggle':
            if (S.auto) { stopAuto(); toast('Orijinal görseller geri yüklendi'); }
            else { await startAuto(); toast('Manga Çevirici açık: görünen sayfalar çevriliyor…'); }
            break;
          case 'translateSrc': {
            injectStyle();
            const img = [...document.images].find((i) => (i.currentSrc || i.src) === msg.srcUrl);
            if (img) enqueue(img, true);
            else toast('Görsel bulunamadı.');
            break;
          }
          default:
            break;
        }
      } catch (e) {
        toast('Hata: ' + (e && e.message ? e.message : e));
      }
      respond(state());
    })();
    return true;
  });
})();
