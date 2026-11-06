# EMCC GIS — หน้า Main

หน้าหลักของเว็บไซต์ `https://nawakonnakhonchai-wq.github.io/` รวมลิงก์ไปยัง dashboard ต่างๆ ของ EMCC กนอ.

- `index.html` — หน้า Main: แถบหน่วยงาน (สลับภาษา ไทย/EN) → แถบเมนู "ข้อมูล" / "Risk map" → Hero ภาพแผนที่หกเหลี่ยม → การ์ดระบบข้อมูล
- `assets/hero-bg.jpg`, `assets/hex-*.jpg` — ภาพแผนที่ที่สร้างจาก `water_flow_major.geojson` และพิกัดนิคมอุตสาหกรรม
- `assets/ieat-logo-color.png` — ตรา กนอ. สี (แถบขาว), `assets/ieat-logo-white.png` — ตราสีขาว (footer, favicon)

## เพิ่ม/แก้ลิงก์หรือข้อความ
- ลิงก์ระบบอยู่ 2 ที่ให้แก้ให้ตรงกัน: เมนู dropdown (`#menuPanel`) และการ์ดในส่วน `#systems`
- ข้อความภาษาไทยอยู่ในเนื้อ HTML ส่วนภาษาอังกฤษอยู่ใน attribute `data-en="..."` ของ element เดียวกัน
- เปิดหน้าเป็นภาษาอังกฤษโดยตรงได้ด้วย `?lang=en`
