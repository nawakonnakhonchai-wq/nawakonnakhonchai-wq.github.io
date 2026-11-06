// EMCC GIS assistant — Cloudflare Pages Function (POST /api/chat)
// Needs a Workers AI binding named "AI" (Pages project → Settings → Bindings → Add → Workers AI).
// Reads public live data at request time and answers with Workers AI. No API key is stored here.

const MODEL = '@cf/google/gemma-3-12b-it';
const FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DATA_BASE = 'https://thanawan-ki.github.io/ieat-emonitoring-line-alert/data/';
const ALLOWED_ORIGINS = [
  'https://nawakonnakhonchai-wq.github.io',
  'https://emcc-gis.pages.dev',
];
const WATCH_RADIUS_KM = 30;
const MAX_QUESTION_CHARS = 600;
const MAX_HISTORY = 6;

const SYSTEMS = [
  { th: 'สถานการณ์น้ำในพื้นที่นิคมฯ', en: 'Water situation in industrial estates', url: 'https://thanawan-ki.github.io/ieat-emonitoring-line-alert/flood-report.html', about: 'ระดับน้ำ/ฝนจากสถานี ThaiWater และกรมชลประทาน รอบนิคมฯ รัศมี 30 กม. นิคมฯ ที่ควรติดตาม แผนที่เรดาร์ฝน' },
  { th: 'เรดาร์ฝนและสถานการณ์ประจำวัน', en: 'Rain radar & daily situation', url: 'https://thanawan-ki.github.io/ieat-emonitoring-line-alert/daily-situation.html', about: 'ภาพเรดาร์ฝนกรมอุตุฯ ซ้อนตำแหน่งนิคมฯ เลือกสถานีเรดาร์ได้' },
  { th: 'Risk map', en: 'Risk map', url: 'https://thanawan-ki.github.io/ieat-emonitoring-line-alert/hub.html?view=data', about: 'แผนที่ความเสี่ยงและระบบสนับสนุนการตัดสินใจ (DSS)' },
  { th: 'E-Monitoring สิ่งแวดล้อม', en: 'E-Monitoring: environment', url: 'https://nawakonnakhonchai-wq.github.io/E-Monitoring_Dashboard/', about: 'สถานีตรวจวัดคุณภาพอากาศ AQMS น้ำ WQMS และปล่อง CEMS ในนิคมฯ (ใช้ภายในหน่วยงาน)' },
  { th: 'สถิติอุบัติเหตุ EMCC', en: 'EMCC accident statistics', url: 'https://nawakonnakhonchai-wq.github.io/Emergency_dashboard/', about: 'สถิติอุบัติเหตุ/เหตุฉุกเฉิน แยกประเภท พื้นที่ ช่วงเวลา (ต้องเข้าสู่ระบบ)' },
  { th: 'ผู้ประกอบการในนิคมฯ (e-PP)', en: 'Estate operators (e-PP)', url: 'https://nawakonnakhonchai-wq.github.io/epp_dashboard/', about: 'ข้อมูลโรงงาน ผู้ประกอบการ และแผนที่แปลงที่ดินในนิคมฯ (ต้องเข้าสู่ระบบ)' },
  { th: 'การใช้น้ำ นิคมฯ / ท่าเรือฯ', en: 'Water use: estates & ports', url: 'https://water-used-dashboard.nawakonnakhonchai.workers.dev/', about: 'ปริมาณน้ำใช้ น้ำ 3R น้ำสำรอง รายเดือน รายนิคมฯ' },
];

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) || /\.emcc-gis\.pages\.dev$/.test(new URL(origin || 'https://x').hostname);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const json = (obj, status, headers) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function getJSON(name, ttl = 300) {
  try {
    const r = await fetch(DATA_BASE + name, { cf: { cacheTtl: ttl, cacheEverything: true } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function km(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function ageHours(t) {
  let s = String(t || '').replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += '+07:00';
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? (Date.now() - ms) / 3600000 : Infinity;
}
const core = (name) => String(name).replace(/^นิคมอุตสาหกรรม|^ท่าเรืออุตสาหกรรม/, '').trim();

function findEstates(text, estates) {
  const q = String(text).toLowerCase().replace(/\s+/g, '');
  const hits = [];
  for (const e of estates) {
    const c = core(e.name).toLowerCase();
    const base = c.replace(/\s*\(.*?\)\s*/g, '').replace(/\s+/g, '');
    if (base.length >= 3 && q.includes(base)) hits.push({ e, score: base.length });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 3).map(h => h.e);
}

function waterContext(d, question) {
  if (!d || !Array.isArray(d.estates)) return 'ข้อมูลสถานการณ์น้ำ: โหลดไม่สำเร็จในขณะนี้';
  const lines = [];
  const s = d.summary || {};
  const stale = d.status === 'stale' || ageHours(d.generated_at) > 24;
  lines.push(`ข้อมูลสถานการณ์น้ำ (ThaiWater/กรมชลประทาน) รอบข้อมูล ${d.generated_at}${stale ? ' — ข้อมูลเก่ากว่า 24 ชม. อาจไม่เป็นปัจจุบัน' : ''}`);
  lines.push(`วิธีคัดกรอง: ${d.methodology?.note || 'สถานีในรัศมี 30 กม. รอบนิคมฯ'}`);
  lines.push(`ภาพรวม: นิคมฯ/ท่าเรือที่ติดตาม ${s.estate_total ?? '-'} แห่ง, นิคมฯ ที่ควรติดตาม ${s.estate_count ?? '-'} แห่ง, ใกล้จุดน้ำสูง ${s.water_alert_estate_count ?? '-'} แห่ง, ใกล้จุดฝนหนัก ${s.rain_alert_estate_count ?? '-'} แห่ง, สถานีทั้งหมด ${s.station_count ?? '-'} (ฝน ${s.rain_station_count ?? '-'}, ระดับน้ำ ${s.waterlevel_station_count ?? '-'}), สถานีระดับน้ำเข้าเกณฑ์ ${s.waterlevel_alert_count ?? '-'}, ฝนสูงสุด ${s.max_rainfall_mm ?? '-'} มม.${s.storm_count ? `, พายุ: ${(s.storm_names || []).join(', ')}` : ''}`);

  const watch = [...(d.estate_watch || [])].sort((a, b) => (b.severity_score || 0) - (a.severity_score || 0) || (b.alert_station_count || 0) - (a.alert_station_count || 0));
  lines.push('นิคมฯ ที่ควรติดตาม 12 อันดับแรก (สถานะสูงสุดของสถานีรอบนิคมฯ | จำนวนสถานีเข้าเกณฑ์ | ระยะสถานีเข้าเกณฑ์ที่ใกล้สุด):');
  for (const w of watch.slice(0, 12)) {
    lines.push(`- ${w.name}: ${w.status} | ${w.alert_station_count} สถานี (น้ำ ${w.water_alert_count}, ฝน ${w.rain_alert_count}) | ใกล้สุด ${w.nearest_alert_km != null ? w.nearest_alert_km.toFixed(1) + ' กม.' : '-'} | เวลา ${w.latest_observed_at || '-'}`);
  }

  const named = findEstates(question, d.estates);
  for (const e of named) {
    const w = (d.estate_watch || []).find(x => x.id === e.id);
    const rows = (d.stations || [])
      .filter(st => Number.isFinite(+st.lat) && Number.isFinite(+st.lon) && ageHours(st.observed_at) <= 24)
      .map(st => ({ ...st, dist: km(e, st) }))
      .filter(st => st.dist <= WATCH_RADIUS_KM)
      .sort((a, b) => (b.severity_score || 0) - (a.severity_score || 0) || a.dist - b.dist);
    lines.push(`\nรายละเอียด ${e.name} (${e.operations || ''}): ${w ? `สถานะ ${w.status}, สถานีเข้าเกณฑ์ ${w.alert_station_count}` : 'ไม่อยู่ในรายการที่ควรติดตาม (ไม่พบสถานีเข้าเกณฑ์ในรอบข้อมูลนี้)'}; สถานีในรัศมี ${WATCH_RADIUS_KM} กม. ${rows.length} สถานี`);
    for (const st of rows.slice(0, 10)) {
      lines.push(`  · ${st.kind === 'waterlevel' ? 'ระดับน้ำ' : 'ฝน'} ${st.station}${st.station_code ? ' (' + st.station_code + ')' : ''} จ.${st.province}: ${st.value_text || '-'} สถานะ ${st.status} ห่าง ${st.dist.toFixed(1)} กม. เวลา ${st.observed_at}`);
    }
  }
  if (!named.length) lines.push('(ผู้ใช้ไม่ได้ระบุชื่อนิคมฯ ที่ตรงกับรายชื่อ ถ้าถามเจาะจงนิคมฯ ให้แนะนำพิมพ์ชื่อนิคมฯ)');
  lines.push('ชื่อนิคมฯ ที่มีข้อมูล: ' + d.estates.map(e => core(e.name)).join(', '));
  return lines.join('\n');
}

function quakeContext(q) {
  if (!q || !Array.isArray(q.features)) return '';
  const rows = q.features.slice(0, 6).map(f => {
    const p = f.properties || {};
    const t = p.time ? new Date(p.time).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-';
    return `- ขนาด ${p.mag ?? '-'} ${p.place || ''} เวลา ${t}${p.depth != null ? ' ลึก ' + p.depth + ' กม.' : ''}`;
  });
  return `แผ่นดินไหวล่าสุด (กรมอุตุนิยมวิทยา, ดึงเมื่อ ${q.metadata?.fetchedAt || '-'}):\n` + rows.join('\n');
}

function systemPrompt(lang, context) {
  return [
    'คุณคือ "ผู้ช่วย EMCC" ของศูนย์เฝ้าระวังสิ่งแวดล้อม และความปลอดภัย (Environmental Monitoring and Control Center: EMCC) การนิคมอุตสาหกรรมแห่งประเทศไทย (กนอ./IEAT)',
    'หน้าที่: ตอบคำถามเกี่ยวกับสถานการณ์น้ำ ฝน แผ่นดินไหว รอบนิคมอุตสาหกรรม และแนะนำระบบข้อมูลของ EMCC ที่เหมาะกับคำถาม',
    `ตอบเป็นภาษา${lang === 'en' ? 'อังกฤษ (English)' : 'ไทย'} สั้น กระชับ เป็นกันเอง ใช้หัวข้อย่อยเมื่อมีหลายรายการ`,
    'กฎ:',
    '1) ใช้เฉพาะตัวเลขและข้อเท็จจริงจาก "ข้อมูลอ้างอิง" ด้านล่าง ห้ามแต่งตัวเลข ถ้าไม่มีข้อมูลให้บอกตรงๆ และแนะนำระบบที่เกี่ยวข้อง',
    '2) เมื่อพูดถึงสถานการณ์ ให้บอกเวลารอบข้อมูลเสมอ และย้ำว่าเป็นการเฝ้าระวังจากสถานีรอบนิคมฯ ยังไม่ยืนยันว่ามีน้ำท่วมภายในนิคมฯ',
    '3) ไม่ให้ข้อมูลรายโรงงาน ชื่อบริษัท หรือข้อมูลภายในหน่วยงาน ให้แนะนำเข้าระบบที่ต้องเข้าสู่ระบบแทน',
    '4) เรื่องฉุกเฉินที่เกิดขึ้นจริง ให้แนะนำติดต่อสำนักงานนิคมฯ หรือสายด่วน 1199 (ดับเพลิง) / 1669 (การแพทย์ฉุกเฉิน) ทันที',
    '5) ใส่ลิงก์ระบบที่เกี่ยวข้องเป็น URL เต็มท้ายคำตอบ 1–2 ลิงก์',
    '6) คำถามที่ไม่เกี่ยวกับงานของ EMCC ให้ตอบสั้นๆ อย่างสุภาพว่าช่วยได้เฉพาะเรื่องของ EMCC',
    '',
    'ระบบข้อมูลของ EMCC:',
    ...SYSTEMS.map(x => `- ${x.th} / ${x.en}: ${x.about} — ${x.url}`),
    '',
    'ข้อมูลอ้างอิง (ล่าสุด):',
    context,
  ].join('\n');
}

export async function onRequestOptions({ request }) {
  return new Response(null, { status: 204, headers: cors(request.headers.get('Origin')) });
}

export async function onRequestPost({ request, env }) {
  const headers = cors(request.headers.get('Origin'));
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400, headers); }
  const lang = body.lang === 'en' ? 'en' : 'th';
  const history = Array.isArray(body.messages) ? body.messages : [];
  const msgs = history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_QUESTION_CHARS * 2) }));
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user' || !last.content.trim()) return json({ error: 'empty' }, 400, headers);
  if (last.content.length > MAX_QUESTION_CHARS) last.content = last.content.slice(0, MAX_QUESTION_CHARS);
  if (!env.AI) return json({ error: 'ai_binding_missing' }, 500, headers);

  const q = msgs.filter(m => m.role === 'user').slice(-2).map(m => m.content).join(' ');
  const wantsQuake = /แผ่นดินไหว|ไหว|earthquake|quake|seismic/i.test(q);
  const [water, quake] = await Promise.all([getJSON('thaiwater_latest.json'), wantsQuake ? getJSON('earthquake-tmd.json') : null]);
  const context = [waterContext(water, q), wantsQuake ? quakeContext(quake) : ''].filter(Boolean).join('\n\n');

  const messages = [{ role: 'system', content: systemPrompt(lang, context) }, ...msgs];
  let answer = '';
  for (const model of [MODEL, FALLBACK_MODEL]) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: 800, temperature: 0.2 });
      answer = (out && (out.response ?? out.result?.response)) || '';
      if (answer) break;
    } catch (e) { /* try fallback */ }
  }
  if (!answer) return json({ error: 'ai_unavailable' }, 503, headers);
  return json({ answer, dataTime: water?.generated_at || null }, 200, headers);
}
