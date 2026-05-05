- [x] มีระบบวิวัฒนาการโปเกม่อน — _try_evolve() ใน engine.py, data/evolutions.json (64 สายวิวัฒนาการ)
- [x] มี debug เสก item — debug.item("speed_boots") ทำงานได้เลย (socket.js)
- [x] มี data item ไว้สำหรับเก็บไอเทมต่างๆ — data/items.json (8 ไอเทม), window.ITEMS_DATA
- [x] มีไอเทมที่มีความสามารถต่างๆ — speed_boots (+1 ช่อง), x_attack (+3 ATK), escape_rope (วาร์ป), potion (ฮีล), rare_candy (+ATK+evolve)
- บอกวิธีพิม console debug แม้จะ deploy แล้ว → ดูคำอธิบายด้านล่าง

---

### วิธีใช้ console debug บน Render (หลัง deploy)
เปิดหน้าเกม → F12 → Console แล้วพิมพ์:

```js
debug.money(100)          // +100 เงิน
debug.item("speed_boots") // ได้ Speed Boots
debug.item("x_attack")    // ได้ X Attack
debug.item("escape_rope") // ได้ Escape Rope
debug.item("ultra_ball")  // ได้ Ultra Ball
debug.item("rare_candy")  // ได้ Rare Candy
debug.item("potion")      // ได้ Potion
debug.pokemon("charizard")// ได้ Charizard
debug.tp(5)               // teleport ไปช่อง 5
debug.turn()              // ตั้งเทิร์นเป็นของฉัน
debug.state()             // ดู state ทั้งหมด
```

> ⚠️ debug commands ทำงานได้เฉพาะเมื่อ server รันด้วย DEBUG=true
> บน Render: Environment Variables → เพิ่ม DEBUG = true
