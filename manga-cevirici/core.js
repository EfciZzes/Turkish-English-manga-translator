/* Manga Çevirici — saf mantık (DOM/Chrome API kullanmaz, Node'da test edilebilir) */
(function (root) {
  'use strict';

  const median = (arr) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  /* ---------- Satırları baloncuklara grupla ---------- */

  function sortLines(lines) {
    return lines.slice().sort((a, b) => {
      const ca = a.y + a.h / 2;
      const cb = b.y + b.h / 2;
      if (Math.abs(ca - cb) < 0.5 * Math.min(a.h, b.h)) return a.x - b.x;
      return ca - cb;
    });
  }

  function joinLines(lines) {
    let out = '';
    for (const l of sortLines(lines)) {
      const t = l.text.trim();
      if (!t) continue;
      if (!out) { out = t; continue; }
      if (/\p{L}-$/u.test(out) && /^\p{L}/u.test(t)) {
        const allCaps = !/\p{Ll}/u.test(out);
        const nextLower = /^\p{Ll}/u.test(t);
        // Satır sonunda bölünmüş kelime: "UNBE-" + "LIEVABLE"
        out = (allCaps || nextLower) ? out.slice(0, -1) + t : out + t;
      } else {
        out += ' ' + t;
      }
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function groupLines(rawLines) {
    const L = (rawLines || []).filter((l) => l && l.text && l.text.trim() && l.w > 0 && l.h > 0);
    const n = L.length;
    const parent = L.map((_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
      return i;
    };
    const union = (a, b) => {
      a = find(a); b = find(b);
      if (a !== b) parent[b] = a;
    };

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = L[i];
        const b = L[j];
        const maxH = Math.max(a.h, b.h);
        const minH = Math.min(a.h, b.h);
        if (maxH > minH * 2.2) continue; // çok farklı boyut: farklı yazı türü
        const hOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (vOverlap > 0.5 * minH) {
          // aynı satırdaki parçalar
          if (-hOverlap < 1.2 * maxH) union(i, j);
        } else if (-vOverlap < 0.75 * maxH && hOverlap > 0.25 * Math.min(a.w, b.w)) {
          // alt alta satırlar
          union(i, j);
        }
      }
    }

    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!buckets.has(r)) buckets.set(r, []);
      buckets.get(r).push(L[i]);
    }

    const groups = [];
    for (const lines of buckets.values()) {
      const x0 = Math.min(...lines.map((l) => l.x));
      const y0 = Math.min(...lines.map((l) => l.y));
      const x1 = Math.max(...lines.map((l) => l.x + l.w));
      const y1 = Math.max(...lines.map((l) => l.y + l.h));
      groups.push({
        text: joinLines(lines),
        x: x0, y: y0, w: x1 - x0, h: y1 - y0,
        lineH: median(lines.map((l) => l.h)),
        lineCount: lines.length,
      });
    }
    // okuma sırası: yukarıdan aşağı
    groups.sort((a, b) => a.y - b.y || a.x - b.x);
    return groups;
  }

  const letterCount = (t) => (t.match(/\p{L}/gu) || []).length;

  function filterGroups(groups, opts) {
    opts = opts || {};
    const medH = median(groups.map((g) => g.lineH));
    return groups.filter((g) => {
      const letters = letterCount(g.text);
      if (letters < 2) return false;
      const compact = g.text.replace(/\s/g, '').length || 1;
      if (letters / compact < 0.5) return false;
      if (opts.skipSfx !== false && groups.length > 2) {
        const words = g.text.trim().split(/\s+/);
        const caps = !/\p{Ll}/u.test(g.text);
        // tek kelimelik, normalden çok büyük, büyük harfli yazı = ses efekti
        if (words.length === 1 && caps && g.lineH > 1.8 * medH) return false;
      }
      return true;
    });
  }

  /* ---------- Büyük/küçük harf ---------- */

  function normalizeCase(text, lang) {
    const loc = lang === 'tr' ? 'tr' : 'en';
    let t = String(text || '').replace(/\|/g, 'I').replace(/\s+/g, ' ').trim();
    const wasCaps = !/\p{Ll}/u.test(t) && /\p{Lu}/u.test(t);
    if (wasCaps) {
      t = t.toLocaleLowerCase(loc);
      t = t.replace(/(^|[.!?…]\s+)(\p{L})/gu, (m, p, c) => p + c.toLocaleUpperCase(loc));
      if (loc === 'en') t = t.replace(/\bi\b/g, 'I');
    }
    return { text: t, wasCaps };
  }

  /* ---------- Sözlük ---------- */

  function parseGlossary(text) {
    const out = [];
    const seen = new Set();
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const src = (i < 0 ? line : line.slice(0, i)).trim();
      const tgt = (i < 0 ? '' : line.slice(i + 1)).trim() || src;
      if (!src) continue;
      const k = src.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ src, tgt });
    }
    return out.sort((a, b) => b.src.length - a.src.length);
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Çeviri motorunun özel isim sanıp dokunmayacağı uydurma isimler
  const PSEUDO = ['Zorkel', 'Vandrix', 'Miltoz', 'Quenba', 'Rastiv', 'Joplek', 'Xandor', 'Brivok',
    'Tulzam', 'Hexil', 'Ornak', 'Pelvun', 'Dasqor', 'Wimbel', 'Gorzan', 'Yultek', 'Kravon',
    'Fenlix', 'Sobrut', 'Lumzak'];
  const MAX_PH = PSEUDO.length + 26;
  const phName = (i) => (i < PSEUDO.length ? PSEUDO[i] : 'Zqx' + String.fromCharCode(97 + i - PSEUDO.length));
  const isPh = (w) => PSEUDO.includes(w) || /^Zqx[a-z]$/.test(w);

  const STOP = new Set(['i', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'okay', 'ok', 'hey', 'oh', 'yes', 'no',
    'hello', 'hi', 'thanks', 'thank', 'please', 'sorry', 'well', 'god', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december', 'what', 'why', 'how', 'who',
    'when', 'where', 'but', 'and', 'so', 'then', 'now', 'wait', 'stop', 'look', 'come', 'let']);

  function prepare(rawText, entries, opts) {
    opts = opts || {};
    const { text, wasCaps } = normalizeCase(rawText, opts.lang || 'en');
    const map = [];
    let masked = text;

    const take = (tgt) => {
      if (map.length >= MAX_PH) return null;
      const ph = phName(map.length);
      map.push({ ph, tgt });
      return ph;
    };

    for (const e of entries || []) {
      const body = e.src.split(/\s+/).map(escapeRe).join('\\s+');
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + body + '(?![\\p{L}\\p{N}])', 'giu');
      if (!re.test(masked)) continue;
      re.lastIndex = 0;
      const ph = take(e.tgt);
      if (!ph) break;
      masked = masked.replace(re, () => ph);
    }

    if (opts.autoProper && !wasCaps) {
      const re = /(?<![\p{L}\p{N}'’])\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)*/gu;
      masked = masked.replace(re, (m, offset, str) => {
        const tokens = m.split(/\s+/);
        if (tokens.some(isPh)) return m;
        const before = str.slice(0, offset);
        if (/(^|[.!?…"“”(])\s*$/.test(before)) return m; // cümle başı
        if (STOP.has(m.toLowerCase())) return m;
        const ph = take(m);
        return ph || m;
      });
    }

    return { masked, map, wasCaps, text };
  }

  /* ---------- Türkçe ek uyumu (Konoha'ya, Sasuke'nin, Naruto'dan ...) ---------- */

  const VOWELS = 'aeıioöuü';
  const BACK = 'aıou';
  const ROUNDV = 'ouöü';
  const HARD = 'çfhkpsşt';

  function fixSuffix(term, suf) {
    if (!suf) return '';
    const word = String(term).trim().split(/\s+/).pop().replace(/[^\p{L}]+$/u, '').toLowerCase();
    if (!word) return "'" + suf;
    const last = word[word.length - 1];
    let v = null;
    let ev;
    if (last === 'y') { ev = true; v = 'i'; } // Luffy -> Luffy'ye
    else {
      ev = VOWELS.includes(last);
      for (let i = word.length - 1; i >= 0; i--) {
        if (VOWELS.includes(word[i])) { v = word[i]; break; }
      }
    }
    if (!v) v = 'e';
    const hard = HARD.includes(last);
    const A = BACK.includes(v) ? 'a' : 'e';
    const I = BACK.includes(v) ? (ROUNDV.includes(v) ? 'u' : 'ı') : (ROUNDV.includes(v) ? 'ü' : 'i');
    const norm = suf.toLowerCase().replace(/[ae]/g, 'A').replace(/[ıiuü]/g, 'I');
    let out;
    switch (norm) {
      case 'A': case 'yA': out = (ev ? 'y' : '') + A; break; // -e hâli
      case 'dA': case 'tA': out = (hard ? 't' : 'd') + A; break; // -de hâli
      case 'dAn': case 'tAn': out = (hard ? 't' : 'd') + A + 'n'; break; // -den hâli
      case 'In': case 'nIn': out = (ev ? 'n' : '') + I + 'n'; break; // -in (tamlayan)
      case 'I': case 'yI': out = (ev ? 'y' : '') + I; break; // -i hâli
      case 'lAr': out = 'l' + A + 'r'; break;
      case 'lA': case 'ylA': out = (ev ? 'y' : '') + 'l' + A; break;
      default: return "'" + suf;
    }
    return "'" + out;
  }

  function restore(translated, map, opts) {
    opts = opts || {};
    let out = translated || '';
    for (const { ph, tgt } of map || []) {
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + ph + '(?:[\'’]([\\p{L}]+))?(?![\\p{L}\\p{N}])', 'giu');
      let hit = false;
      out = out.replace(re, (m, suf) => {
        hit = true;
        if (!suf) return tgt;
        return tgt + (opts.fixTr ? fixSuffix(tgt, suf) : "'" + suf);
      });
      if (!hit) out = out.replace(new RegExp(ph, 'gi'), () => tgt); // ek kaynaşmışsa
    }
    return out;
  }

  const api = {
    median, groupLines, filterGroups, normalizeCase, parseGlossary,
    prepare, restore, fixSuffix, joinLines,
  };
  root.MC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
