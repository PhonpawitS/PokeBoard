- บัคทอยบอลต้องกด 2 ครั้ง
- ทำให้ sprite ยืนขึ้นมาจากกระดาน
- ขยาย board
- ให้ทุก classes มี sprites
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
