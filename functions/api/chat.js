// EMCC GIS assistant — Cloudflare Pages Function (POST /api/chat)
// Needs a Workers AI binding named "AI" (Pages project → Settings → Bindings → Add → Workers AI).
// Reads public live data at request time and answers with Workers AI. No API key is stored here.

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const FALLBACK_MODEL = '@cf/google/gemma-3-12b-it';
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
  { th: 'สถานการณ์แผ่นดินไหว', en: 'Earthquake monitor', url: 'https://tmd-earthquake.nawakonnakhonchai.workers.dev/', about: 'แผ่นดินไหวจากกรมอุตุฯ แผนที่จุดศูนย์กลาง แนวโน้มรายวัน/รายสัปดาห์ ข้อมูลย้อนหลังตั้งแต่ พ.ค. 2569 ดาวน์โหลด CSV ได้' },
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
  lines.push('นิคมฯ ที่ควรติดตาม 8 อันดับแรก (สถานะสูงสุดของสถานีรอบนิคมฯ | จำนวนสถานีเข้าเกณฑ์ | ระยะสถานีเข้าเกณฑ์ที่ใกล้สุด):');
  for (const w of watch.slice(0, 8)) {
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
    for (const st of rows.slice(0, 8)) {
      lines.push(`  · ${st.kind === 'waterlevel' ? 'ระดับน้ำ' : 'ฝน'} ${st.station}${st.station_code ? ' (' + st.station_code + ')' : ''} จ.${st.province}: ${st.value_text || '-'} สถานะ ${st.status} ห่าง ${st.dist.toFixed(1)} กม. เวลา ${st.observed_at}`);
    }
  }
  lines.push(...stationContext(d, question, named));
  if (!named.length) lines.push('(ผู้ใช้ไม่ได้ระบุชื่อนิคมฯ ที่ตรงกับรายชื่อ ถ้าถามเจาะจงนิคมฯ ให้แนะนำพิมพ์ชื่อนิคมฯ)');
  return lines.join('\n');
}

// ข้อมูลรายสถานี: ตามชื่อ/รหัสสถานี จังหวัด หรือคำถามทั่วไปเรื่องสถานีระดับน้ำ/ฝน
function stationRow(st) {
  const kind = st.kind === 'waterlevel' ? 'ระดับน้ำ' : 'ฝน';
  const extra = st.kind === 'waterlevel' && st.storage_percent != null ? ` (${Math.round(st.storage_percent)}% ของความจุลำน้ำ)` : '';
  return `  · [${kind}] ${st.station}${st.station_code ? ' (' + st.station_code + ')' : ''} อ.${st.district || '-'} จ.${st.province || '-'} | ${st.value_text || '-'}${extra} | สถานะ ${st.status} | ใกล้ ${st.nearest_estate || '-'} ${st.distance_km != null ? (+st.distance_km).toFixed(1) + ' กม.' : ''} | ${st.observed_at} | ${st.agency || ''}`;
}
function stationContext(d, question, named) {
  const q = String(question);
  const ql = q.toLowerCase().replace(/\s+/g, '');
  const fresh = (d.stations || []).filter(st => ageHours(st.observed_at) <= 24);
  const out = [];
  const sev = (a, b) => (b.severity_score || 0) - (a.severity_score || 0) || (+(b.storage_percent || b.rainfall_mm || 0)) - (+(a.storage_percent || a.rainfall_mm || 0));
  const wantWater = /ระดับน้ำ|สถานีวัดน้ำ|สถานีน้ำ|ตลิ่ง|น้ำล้น|ล้นตลิ่ง|วิกฤต|water ?level|gauge|river level/i.test(q);
  const wantRain = /ฝน|rain/i.test(q);
  const wantStation = /สถานี|station/i.test(q);

  // 1) ชื่อหรือรหัสสถานี
  const byName = fresh.filter(st => {
    const code = String(st.station_code || '').toLowerCase();
    const name = String(st.station || '').replace(/\s+/g, '').toLowerCase();
    return (code.length >= 3 && codeIn(ql, code.replace(/\s+/g, ''))) || (name.length >= 4 && ql.includes(name));
  }).slice(0, 6);
  if (byName.length) { out.push('\nสถานีที่ผู้ใช้ถามถึง:'); byName.forEach(st => out.push(stationRow(st))); }

  // 2) จังหวัด
  const provinces = [...new Set(fresh.map(st => st.province).filter(Boolean))];
  const prov = provinces.filter(p => ql.includes(String(p).replace(/\s+/g, '').toLowerCase())).slice(0, 2);
  for (const p of prov) {
    let rows = fresh.filter(st => st.province === p);
    if (wantWater && !wantRain) rows = rows.filter(st => st.kind === 'waterlevel');
    if (wantRain && !wantWater) rows = rows.filter(st => st.kind === 'rainfall');
    rows.sort(sev);
    out.push(`\nสถานีใน จ.${p} (${rows.length} สถานี เรียงตามความรุนแรง แสดง 12 แรก):`);
    rows.slice(0, 12).forEach(st => out.push(stationRow(st)));
  }

  // 3) คำถามทั่วไปเรื่องสถานี (ไม่ระบุนิคมฯ/จังหวัด/สถานี)
  if (!byName.length && !prov.length && !named.length && (wantWater || wantRain || wantStation)) {
    const wl = fresh.filter(st => st.kind === 'waterlevel');
    const rf = fresh.filter(st => st.kind === 'rainfall');
    const cnt = (arr) => { const c = {}; arr.forEach(st => { c[st.status] = (c[st.status] || 0) + 1; }); return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', '); };
    if (wantWater || wantStation || !wantRain) {
      out.push(`\nสถานีวัดระดับน้ำรอบนิคมฯ (รัศมี 50 กม.) ข้อมูลไม่เกิน 24 ชม.: ${wl.length} สถานี — ${cnt(wl)}`);
      out.push('สถานีระดับน้ำที่สถานะรุนแรงที่สุด 15 แห่ง:');
      [...wl].sort(sev).slice(0, 15).forEach(st => out.push(stationRow(st)));
    }
    if (wantRain) {
      out.push(`\nสถานีวัดฝนรอบนิคมฯ: ${rf.length} สถานี — ${cnt(rf)}`);
      out.push('สถานีฝนสะสมสูงสุด 10 แห่ง:');
      [...rf].sort((a, b) => (+b.rainfall_mm || 0) - (+a.rainfall_mm || 0)).slice(0, 10).forEach(st => out.push(stationRow(st)));
    }
    out.push('(ถ้าผู้ใช้ต้องการเจาะจง ให้แนะนำระบุชื่อนิคมฯ จังหวัด หรือชื่อ/รหัสสถานี)');
  }
  return out;
}

// ── ข้อมูลเสริมจาก repo: เขื่อน น้ำป่า อุปกรณ์ฉุกเฉิน สถิติระดับน้ำย้อนหลัง ──
const RX = {
  dam: /เขื่อน|อ่างเก็บน้ำ|อ่างฯ|ปริมาณน้ำในอ่าง|dam|reservoir/i,
  flash: /น้ำป่า|น้ำท่วม|ท่วม|น้ำหลาก|flash ?flood|flood/i,
  equip: /อุปกรณ์|เครื่องสูบ|ปั๊ม|กระสอบ|รถดับเพลิง|รถ|เรือ|ทรัพยากร|เตรียมพร้อม|แผนรับมือ|equipment|pump|sandbag|resource/i,
  history: /ย้อนหลัง|ปีที่แล้ว|ปีก่อน|เทียบ|สถิติ|สูงสุด|แนวโน้ม|ขึ้นหรือลง|history|trend|last year|record|compare/i,
};
const fmtNum = (n, d = 2) => (n == null || !Number.isFinite(+n)) ? '-' : (+n).toFixed(d);

function matchStations(d, q) {
  const ql = String(q).toLowerCase().replace(/\s+/g, '');
  return (d?.stations || []).filter(st => {
    const code = String(st.station_code || '').toLowerCase().replace(/\s+/g, '');
    const name = String(st.station || '').replace(/\s+/g, '').toLowerCase();
    return (code.length >= 3 && codeIn(ql, code)) || (name.length >= 4 && ql.includes(name));
  });
}
function codeIn(ql, code) {
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9.])' + esc + '(?![a-z0-9])').test(ql);
}
function matchProvinces(names, q) {
  const ql = String(q).replace(/\s+/g, '');
  return [...new Set(names.filter(Boolean))].filter(p => ql.includes(String(p).replace(/^จ\.|\s+/g, '')));
}

function damContext(dams, q, named) {
  const rows = (dams?.rows || []).filter(r => Number.isFinite(+r.percent));
  if (!rows.length) return '';
  const out = [`เขื่อน/อ่างเก็บน้ำที่เกี่ยวข้อง (ThaiWater, วัดเมื่อ ${rows[0].measured_at || '-'}; ปริมาณน้ำ ล้าน ลบ.ม.):`];
  const line = r => `- ${r.name} จ.${r.province} (${r.basin || '-'}): ${fmtNum(r.percent, 1)}% ของความจุ (${fmtNum(r.storage, 1)}/${fmtNum(r.capacity, 0)}) น้ำไหลเข้า ${fmtNum(r.inflow)} ระบาย ${fmtNum(r.released)}`;
  if (named.length) {
    for (const e of named) {
      const near = rows.map(r => ({ ...r, dist: km(e, { lat: +r.lat, lon: +r.lng }) })).sort((a, b) => a.dist - b.dist).slice(0, 3);
      out.push(`เขื่อนใกล้ ${e.name}:`);
      near.forEach(r => out.push(line(r) + ` | ห่าง ${r.dist.toFixed(0)} กม.`));
    }
  } else {
    const prov = matchProvinces(rows.map(r => r.province), q);
    const pick = prov.length ? rows.filter(r => prov.includes(r.province)) : [...rows].sort((a, b) => b.percent - a.percent).slice(0, 10);
    out.push(prov.length ? `ในจังหวัด ${prov.join(', ')}:` : `ทั้งหมด ${rows.length} แห่ง, เกิน 80% ${rows.filter(r => r.percent > 80).length} แห่ง, เกิน 100% ${rows.filter(r => r.percent > 100).length} แห่ง; 10 แห่งที่น้ำมากที่สุด:`);
    pick.forEach(r => out.push(line(r)));
  }
  return out.join('\n');
}

function flashContext(ff, named) {
  if (!ff || !Array.isArray(ff.areas)) return '';
  const out = [`พื้นที่เฝ้าระวังน้ำท่วมฉับพลัน/น้ำป่า ล่วงหน้า 48 ชม. (สสน./HII, ${ff.date} ${ff.time}): ${ff.area_count} พื้นที่ทั่วประเทศ, ใกล้นิคมฯ ${ff.nearby_count ?? 0} พื้นที่`];
  const all = [...(ff.areas || []), ...(ff.area_nearby || [])];
  const seen = new Set();
  for (const a of all) {
    const k = a.geocode; if (seen.has(k)) continue; seen.add(k);
    let near = '';
    if (named.length && Number.isFinite(+a.latitude)) {
      const e = named[0]; const dkm = km(e, { lat: +a.latitude, lon: +a.longitude });
      if (dkm > 60) { seen.delete(k); continue; }
      near = ` | ห่าง ${e.name} ${dkm.toFixed(0)} กม.`;
    }
    out.push(`- ${a.tambon} ${a.amphoe} ${a.province}: ฝนสะสม ${fmtNum(a.sum_rainfall_mm, 1)} มม. (สถานี ${a.station})${near}`);
    if (seen.size >= 8) break;
  }
  if (!ff.area_count) out.push('- ไม่มีพื้นที่เฝ้าระวังในรอบนี้');
  else if (named.length && !seen.size) out.push(`- ไม่มีพื้นที่เฝ้าระวังในรัศมี 60 กม. รอบ ${named[0].name}`);
  return out.join('\n');
}

function equipContext(eq, named) {
  const recs = eq?.records || [];
  if (!recs.length) return '';
  const out = [];
  const zones = [...new Set(recs.map(r => r.zone))];
  for (const e of named) {
    const rs = recs.filter(r => r.zone === e.name || String(r.estate_id) === String(e.id));
    if (!rs.length) { out.push(`อุปกรณ์ฉุกเฉินของ ${e.name}: ยังไม่มีข้อมูลในชุดเอกสาร`); continue; }
    out.push(`อุปกรณ์ฉุกเฉินตามแผนรับมือเหตุของ ${e.name} (ปี ${rs[0].source_year}, ตามเอกสาร ไม่ใช่ความพร้อมปัจจุบัน):`);
    rs.flatMap(r => r.items || []).slice(0, 25).forEach(i => out.push(`- ${i.name}${i.type ? ' (' + i.type + ')' : ''}: ${i.amount || '-'} ${i.unit || ''}${i.capacity ? ' ความจุ ' + i.capacity : ''}`));
  }
  out.push(`(มีข้อมูลอุปกรณ์จากแผนรับมือเหตุของ: ${zones.join(', ')})`);
  return out.join('\n');
}

async function historyContext(stations, q) {
  const idx = await getJSON('water-history/index.json', 21600);
  if (!idx?.stations) return '';
  const ql = String(q).toLowerCase().replace(/\s+/g, '');
  const fromQ = Object.keys(idx.stations).filter(c => idx.stations[c]?.station_id && (codeIn(ql, c.toLowerCase()) || (idx.stations[c].name && ql.includes(String(idx.stations[c].name).replace(/\s+/g, '').toLowerCase()))));
  const codes = [...new Set([...stations.map(s => s.station_code), ...fromQ].filter(c => idx.stations[c]?.station_id))].slice(0, 2);
  if (!codes.length) return '';
  const years = (idx.years || []).slice(-4);
  const files = await Promise.all(years.map(y => getJSON(`water-history/waterlevel_${y}.json`, 21600)));
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(5, 10); // MM-DD (เวลาไทย)
  const out = [];
  for (const code of codes) {
    const meta = idx.stations[code];
    const cur = stations.find(s => s.station_code === code);
    out.push(`สถิติระดับน้ำย้อนหลังสถานี ${code} ${meta.name} จ.${meta.province} (${meta.basin || ''}) หน่วย ม.รทก.; ค่าปัจจุบัน ${cur?.value_text || '-'} (${cur?.observed_at || '-'})`);
    files.forEach((f, i) => {
      const st = f?.stations?.[code]; if (!st) return;
      const days = st.days || [];
      const peak = days.reduce((m, d) => (d[2] > (m?.[2] ?? -Infinity) ? d : m), null);
      const same = days.find(d => d[0].slice(5) === today);
      out.push(`- ปี ${years[i]}: สูงสุด ${fmtNum(peak?.[2])} (${peak?.[0] || '-'}), ต่ำสุด ${fmtNum(st.min)}, เฉลี่ย ${fmtNum(st.avg)}${same ? `, วันเดียวกัน (${same[0]}) เฉลี่ย ${fmtNum(same[3])}` : ''}${years[i] === years[years.length - 1] ? ` ข้อมูลถึง ${st.last}` : ''}`);
    });
    const lastYear = files[files.length - 1]?.stations?.[code]?.days || [];
    if (lastYear.length) out.push(`  ค่าเฉลี่ยรายวัน 7 วันสุดท้ายของชุดย้อนหลัง: ${lastYear.slice(-7).map(d => d[0].slice(5) + ' ' + fmtNum(d[3])).join(', ')}`);
  }
  out.push(`(มีสถิติย้อนหลังเฉพาะ ${Object.values(idx.stations).filter(s => s.station_id).length} สถานีหลัก เช่น C.2, C.13, P.1, Y.20, N.1)`);
  return out.join('\n');
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
    'หน้าที่: ตอบคำถามเกี่ยวกับสถานการณ์น้ำ ฝน สถานีวัดระดับน้ำ/สถานีวัดฝน สถิติระดับน้ำย้อนหลัง เขื่อน/อ่างเก็บน้ำ พื้นที่เฝ้าระวังน้ำป่า อุปกรณ์ฉุกเฉินตามแผนรับมือเหตุของนิคมฯ แผ่นดินไหว รอบนิคมอุตสาหกรรม และแนะนำระบบข้อมูลของ EMCC ที่เหมาะกับคำถาม เมื่อถามเรื่องสถานี ให้สรุปจำนวนตามสถานะ แล้วแสดงรายการสถานีสำคัญพร้อมค่า สถานะ เวลา และนิคมฯ ที่ใกล้',
    `ตอบเป็นภาษา${lang === 'en' ? 'อังกฤษ (English) — ignore the Thai politeness rule 7 and answer in natural English' : 'ไทย'} สั้น กระชับ เป็นกันเอง ใช้หัวข้อย่อยเมื่อมีหลายรายการ`,
    'กฎ:',
    '1) ใช้เฉพาะตัวเลขและข้อเท็จจริงจาก "ข้อมูลอ้างอิง" ด้านล่าง ห้ามแต่งตัวเลข ถ้าไม่มีข้อมูลให้บอกตรงๆ และแนะนำระบบที่เกี่ยวข้อง',
    '2) เมื่อพูดถึงสถานการณ์ ให้บอกเวลารอบข้อมูลเสมอ และย้ำว่าเป็นการเฝ้าระวังจากสถานีรอบนิคมฯ ยังไม่ยืนยันว่ามีน้ำท่วมภายในนิคมฯ',
    '3) ไม่ให้ข้อมูลรายโรงงาน ชื่อบริษัท หรือข้อมูลภายในหน่วยงาน ให้แนะนำเข้าระบบที่ต้องเข้าสู่ระบบแทน',
    '4) เรื่องฉุกเฉินที่เกิดขึ้นจริง ให้แนะนำติดต่อสำนักงานนิคมฯ หรือสายด่วน 1199 (ดับเพลิง) / 1669 (การแพทย์ฉุกเฉิน) ทันที',
    '5) ถ้ามีระบบที่เกี่ยวข้อง ให้ใส่ URL เต็มไว้บรรทัดท้ายสุด บรรทัดละ 1 ลิงก์ สูงสุด 2 ลิงก์ ไม่ต้องเขียนข้อความนำหน้าลิงก์ และไม่ต้องอ้างถึงลิงก์ในเนื้อความ (หน้าเว็บจะแปลงเป็นปุ่มให้เอง) ทักทายทั่วไปไม่ต้องใส่ลิงก์',
    '7) แทนตัวเองว่า "ผม" และลงท้ายด้วย "ครับ" เสมอ ห้ามใช้ "ครับ/ค่ะ" หรือ "ผม/ดิฉัน" ตอบให้สั้นที่สุดที่ยังครบถ้วน คำทักทายตอบไม่เกิน 2 ประโยค',
    '6) คำถามที่ไม่เกี่ยวกับงานของ EMCC ให้ตอบสั้นๆ อย่างสุภาพว่าช่วยได้เฉพาะเรื่องของ EMCC',
    '',
    'ระบบข้อมูลของ EMCC:',
    ...SYSTEMS.map(x => `- ${x.th} / ${x.en}: ${x.about} — ${x.url}`),
    '',
    'ข้อมูลอ้างอิง (ล่าสุด):',
    context,
  ].join('\n');
}

// แยกลิงก์ออกจากคำตอบ → ส่งเป็นปุ่มแยกต่างหาก
function splitLinks(text) {
  const links = [];
  const seen = new Set();
  const norm = (u) => u.replace(/[)\].,;:!?'"»]+$/, '');
  const addLink = (u) => {
    u = norm(u);
    if (seen.has(u)) return;
    const sys = SYSTEMS.find(x => u.split('?')[0] === x.url.split('?')[0]) || SYSTEMS.find(x => u.startsWith(x.url.split('?')[0]));
    seen.add(u);
    links.push(sys ? { url: sys.url, th: sys.th, en: sys.en } : { url: u, th: 'เปิดลิงก์', en: 'Open link' });
  };
  const out = [];
  for (let line of String(text).split('\n')) {
    let had = false;
    // markdown [label](url) → keep label text
    line = line.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, u) => { had = true; addLink(u); return label; });
    line = line.replace(/<?(https?:\/\/[^\s<>]+)>?/g, (m, u) => { had = true; addLink(u); return ''; });
    if (had) {
      const rest = line.replace(/[\s\-*•:：]+$/, '').replace(/^[\s\-*•]+/, '').trim();
      // drop lead-in lines like "ดูรายละเอียดได้ที่:" / "สามารถเข้าชมได้ที่"
      if (!rest || /(ได้ที่|ที่นี่|ลิงก์|ดังนี้|here|at|link|visit)\s*$/i.test(rest) || rest.length < 4) continue;
      line = rest;
    }
    out.push(line);
  }
  const clean = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean, links: links.filter(l => /^https:\/\//.test(l.url)).slice(0, 3) };
}

function extract(out) {
  if (!out) return '';
  if (typeof out === 'string') return out;
  if (typeof out.response === 'string') return out.response;
  if (out.result && typeof out.result.response === 'string') return out.result.response;
  const c = out.choices && out.choices[0];
  if (c) return (c.message && c.message.content) || c.text || '';
  return '';
}

// GET /api/chat — quick health check (binding present, data reachable, model answers)
export async function onRequestGet({ request, env }) {
  const headers = cors(request.headers.get('Origin'));
  const report = { binding: !!env.AI, model: MODEL, data: null, ai: null };
  const d = await getJSON('thaiwater_latest.json');
  report.data = d ? { ok: true, generated_at: d.generated_at, estates: (d.estates || []).length } : { ok: false };
  if (env.AI) {
    for (const model of [MODEL, FALLBACK_MODEL]) {
      try {
        const out = await env.AI.run(model, { messages: [{ role: 'user', content: 'ตอบคำว่า สวัสดี คำเดียว' }], max_tokens: 20 });
        report.ai = { ok: !!extract(out), model, sample: extract(out).slice(0, 40) };
        (report.tried = report.tried || []).push(report.ai);
        if (report.ai.ok) break;
      } catch (e) { report.ai = { ok: false, model, error: String(e && e.message || e).slice(0, 300) }; (report.tried = report.tried || []).push(report.ai); }
    }
  }
  return json(report, 200, headers);
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
  const water = await getJSON('thaiwater_latest.json');
  const named = water?.estates ? findEstates(q, water.estates) : [];
  const stMatch = matchStations(water, q);
  const want = {
    quake: wantsQuake,
    dam: RX.dam.test(q),
    flash: RX.flash.test(q),
    equip: named.length > 0 && RX.equip.test(q),
    history: RX.history.test(q) || (stMatch.length > 0 && /สถานี|station/i.test(q)),
  };
  const [quake, dams, ff, eq, hist] = await Promise.all([
    want.quake ? getJSON('earthquake-tmd.json') : null,
    want.dam ? getJSON('related_dams_latest.json', 1800) : null,
    want.flash ? getJSON('flash_flood_48h.json', 1800) : null,
    want.equip ? getJSON('estate-emergency-equipment-2026.json', 21600) : null,
    want.history ? historyContext(stMatch, q) : '',
  ]);
  const context = [
    waterContext(water, q),
    want.quake ? quakeContext(quake) : '',
    want.dam ? damContext(dams, q, named) : '',
    want.flash ? flashContext(ff, named) : '',
    want.equip ? equipContext(eq, named) : '',
    hist || '',
  ].filter(Boolean).join('\n\n');

  const messages = [{ role: 'system', content: systemPrompt(lang, context) }, ...msgs];
  let answer = '';
  const errors = [];
  for (const model of [MODEL, FALLBACK_MODEL]) {
    try {
      const out = await env.AI.run(model, { messages, max_tokens: 800, temperature: 0.2 });
      answer = extract(out);
      if (answer) break;
      errors.push(model + ': empty response ' + JSON.stringify(out).slice(0, 200));
    } catch (e) { errors.push(model + ': ' + String(e && e.message || e).slice(0, 300)); }
  }
  if (!answer) return json({ error: 'ai_unavailable', detail: errors }, 503, headers);
  const parts = splitLinks(answer);
  return json({ answer: parts.text || answer, links: parts.links, dataTime: water?.generated_at || null }, 200, headers);
}
