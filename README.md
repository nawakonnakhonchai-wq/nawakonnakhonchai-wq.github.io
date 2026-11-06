# EMCC GIS — หน้า Main

หน้าหลักของเว็บไซต์ `https://nawakonnakhonchai-wq.github.io/` รวมลิงก์ไปยัง dashboard ต่างๆ ของ EMCC กนอ.

- `index.html` — หน้า Main: แถบหน่วยงาน (สลับภาษา ไทย/EN) → แถบเมนู "ข้อมูล" / "Risk map" → Hero ภาพแผนที่หกเหลี่ยม → การ์ดระบบข้อมูล
- `assets/cover-*.jpg` — ภาพหน้าการ์ดแต่ละระบบ (สร้างจากข้อมูลจริง: ThaiWater, เรดาร์กรมอุตุฯ, สถิติเหตุ EMCC, พิกัดนิคมฯ)
- `assets/hero-bg.jpg`, `assets/hex-*.jpg` — ภาพแผนที่ที่สร้างจาก `water_flow_major.geojson` และพิกัดนิคมอุตสาหกรรม
- `assets/ieat-logo-color.png` — ตรา กนอ. สี (แถบขาว), `assets/ieat-logo-white.png` — ตราสีขาว (footer, favicon)

## เพิ่ม/แก้ลิงก์หรือข้อความ
- ลิงก์ระบบอยู่ 2 ที่ให้แก้ให้ตรงกัน: เมนู dropdown (`#menuPanel`) และการ์ดในส่วน `#systems`
- ข้อความภาษาไทยอยู่ในเนื้อ HTML ส่วนภาษาอังกฤษอยู่ใน attribute `data-en="..."` ของ element เดียวกัน
- เปิดหน้าเป็นภาษาอังกฤษโดยตรงได้ด้วย `?lang=en`

## ผู้ช่วย EMCC (AI chatbot)
- ปุ่มแชทมุมขวาล่างของหน้า เรียก `POST /api/chat` ซึ่งเป็น Cloudflare Pages Function ใน `functions/api/chat.js`
- ใช้ Cloudflare Workers AI (`@cf/google/gemma-3-12b-it`, สำรอง `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) ไม่ต้องใช้ API key
- ทุกคำถามจะดึงข้อมูลล่าสุด `thaiwater_latest.json` (และ `earthquake-tmd.json` เมื่อถามเรื่องแผ่นดินไหว) จาก repo ieat-emonitoring-line-alert มาเป็นบริบท
- ต้องตั้งค่า binding ครั้งเดียว: Cloudflare → Workers & Pages → `emcc-gis` → Settings → Bindings → Add → Workers AI → Variable name `AI` แล้ว deploy ใหม่
- หน้าเว็บบน github.io เรียก API ที่ `https://emcc-gis.pages.dev/api/chat` (แก้ได้ที่ตัวแปร `API` ในสคริปต์ และ `ALLOWED_ORIGINS` ใน `chat.js`)
