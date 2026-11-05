# EMCC GIS — หน้า Main

หน้าหลักของเว็บไซต์ `https://nawakonnakhonchai-wq.github.io/` รวมลิงก์ไปยัง dashboard ต่างๆ ของ EMCC กนอ.

- `index.html` — หน้า Main (Hero + เมนู "ข้อมูล" / "Risk map" + การ์ดระบบข้อมูล)
- `assets/hero-map.jpg` — ภาพแผนที่แม่น้ำสายหลักและตำแหน่งนิคมอุตสาหกรรม (สร้างจาก `water_flow_major.geojson` และพิกัดนิคมฯ จาก e-PP)
- `assets/ieat-logo-white.png` — ตรา กนอ. สีขาว (favicon)
- `assets/ieat-logo-color.png` — ตรา กนอ. สี (แถบขาวด้านบน)

## เพิ่ม/แก้ลิงก์
แก้ใน `index.html` สองที่ให้ตรงกัน: รายการใน dropdown (`#menuPanel`) และการ์ดในส่วน `#systems`

## เปิดใช้งาน
Settings → Pages → Source: Deploy from a branch → `main` / `(root)`
