// 找車工具 車源代抓 Worker（Cloudflare Workers）
// 只在使用者點車款時才抓一次，結果快取 30 分鐘，降低對網站的負擔。
// GET /8891?slug=toyota/rav4&kind=RAV4&min=70&max=80&year=2021
// GET /sum?brand=TOYOTA&model=RAV4&min=70&max=80&year=2021

const CACHE_SEC = 1800;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    const cache = caches.default;
    const hit = await cache.match(req);
    if (hit) return hit;
    let data;
    try {
      if (url.pathname === '/8891') data = await get8891(url.searchParams);
      else if (url.pathname === '/sum') data = await getSum(url.searchParams);
      else if (url.pathname === '/sumraw') return await sumRaw(url.searchParams);
      else return json({ ok: true, usage: '/8891?slug=toyota/rav4&kind=RAV4&min=70&max=80&year=2021' });
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 502);
    }
    const res = json({ ok: true, ...data });
    res.headers.set('Cache-Control', 'public, max-age=' + CACHE_SEC);
    ctx.waitUntil(cache.put(req, res.clone()));
    return res;
  }
};

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } });
}
const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

// ===== 8891 =====
async function get8891(p) {
  const slug = (p.get('slug') || '').toLowerCase();
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(slug)) throw new Error('slug 格式錯誤');
  const kind = (p.get('kind') || '').toLowerCase();
  const min = num(p.get('min'), 0), max = num(p.get('max'), 999), year = num(p.get('year'), 0);
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const u = `https://auto.8891.com.tw/${slug}?price=${Math.round(min * 10000)}_${Math.round(max * 10000)}&sort=year-desc&page=${page}`;
    const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
    if (!r.ok) throw new Error('8891 回應 ' + r.status);
    const items = parse8891(await r.text());
    if (!items.length) break;
    let older = false;
    for (const it of items) {
      const y = parseInt(it.makeYear) || 0;
      if (y < year) { older = true; continue; }
      if (kind && String(it.kindEnName || '').toLowerCase() !== kind) continue;
      const pr = parseFloat(it.price);
      if (isFinite(pr) && (pr < min || pr > max)) continue;
      out.push({
        src: '8891', id: it.itemId, title: it.title, sub: it.subTitle || '', price: isFinite(pr) ? pr : null, year: y,
        mileage: it.mileage || '', region: it.region || '', gas: it.gas || '', color: it.color || '',
        image: it.image || '', url: `https://auto.8891.com.tw/usedauto-infos-${it.itemId}.html`,
        updated: it.itemRenewDate || ''
      });
    }
    if (older || items.length < 20) break; // 依年份新→舊排序，看到太舊的就停
  }
  const seen = new Set();
  return { source: '8891', items: out.filter(x => !seen.has(x.id) && seen.add(x.id)) };
}

// 8891 是 Next.js 頁面，車源資料在 self.__next_f.push([1,"..."]) 的字串裡
function parse8891(html) {
  let flight = '';
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { flight += JSON.parse('"' + m[1] + '"'); } catch (e) {} }
  const key = '"listData":';
  const i = flight.indexOf(key);
  if (i < 0) return [];
  const obj = grabObject(flight, i + key.length);
  try { return (JSON.parse(obj).items) || []; } catch (e) { return []; }
}
function grabObject(s, start) {
  let i = s.indexOf('{', start), depth = 0, inStr = false;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(i, j + 1); }
  }
  return '{}';
}

// ===== SUM（解析待確認版面後補上）=====
async function getSum(p) {
  const brand = (p.get('brand') || '').toUpperCase(), model = p.get('model') || '';
  const u = `https://www.sum.com.tw/carsearch.php?v=3&brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}`;
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
  if (!r.ok) throw new Error('SUM 回應 ' + r.status);
  return { source: 'sum', items: [], note: 'SUM 解析尚未完成', searchUrl: u };
}
// 除錯用：看 SUM 頁面原始內容（只允許 sum.com.tw）
async function sumRaw(p) {
  const path = p.get('path') || '/';
  const u = new URL(path, 'https://www.sum.com.tw/');
  if (u.hostname !== 'www.sum.com.tw') return json({ ok: false, error: 'only sum.com.tw' }, 400);
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW' } });
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS } });
}
