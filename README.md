# Absolute AI (based on UnfilteredAI DAN language models, local)

ชุดที่ติดตั้ง (มาจาก collection **"DAN - Language models"** ของ UnfilteredAI)

| ส่วน | ที่มา | ไฟล์ในเครื่อง |
|---|---|---|
| Model | `UnfilteredAI/DAN-Qwen3-1.7B` (Qwen3-1.7B, Apache-2.0) – GGUF Q8_0 จาก `mradermacher/DAN-Qwen3-1.7B-GGUF` | `models/DAN-Qwen3-1.7B.Q8_0.gguf` (1.8 GB) |
| Dataset | `UnfilteredAI/DAN` (1,909 บทสนทนา, ภาษาอังกฤษ) | `datasets/DAN/d.json` |
| Runtime | Ollama v0.40.16 แบบ portable (รองรับ CUDA) | `runtime/ollama/` |

ทุกอย่างอยู่ใน `D:\ai-midel` (ไฟล์โมเดลที่ Ollama ใช้อยู่ใน `ollama-store/`) ไม่ได้ติดตั้งอะไรลงระบบ

## ใช้งาน (PowerShell)

```powershell
cd D:\ai-midel
.\run.ps1            # เปิดเซิร์ฟเวอร์ + แชทใน terminal (/bye เพื่อออก)
.\run.ps1 -Web       # เปิดเซิร์ฟเวอร์ + หน้าแชทเว็บ http://127.0.0.1:8765
.\run.ps1 -ServeOnly # เปิดแค่เซิร์ฟเวอร์ API
.\stop.ps1           # ปิดทั้งหมด
```

ถ้า PowerShell ไม่ยอมรันสคริปต์ ใช้ `powershell -ExecutionPolicy Bypass -File .\run.ps1 -Web`

หมายเหตุ: อย่าเปิด `chat.html` ด้วยการดับเบิลคลิก (Ollama จะปฏิเสธคำขอจากหน้า `file://`) ให้ใช้ `-Web`

API (เปิดเฉพาะในเครื่อง 127.0.0.1:11434):

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/chat -Method Post -Body '{"model":"dan-qwen3","stream":false,"messages":[{"role":"user","content":"hello"}]}'
```

ใช้กับ OpenAI SDK ได้ที่ `http://127.0.0.1:11434/v1` ตั้ง model เป็น `dan-qwen3`

## ใช้งานบนเครื่อง A01 (10.0.1.183, RTX 4060 Ti 8 GB)

A01 มี 2 โมเดล: `dan-l3-r1-8b` (DAN-L3-R1-8B Q4_K_M, 4.9 GB) และ `dan-qwen3` (context 8192 ทั้งคู่)
Ollama ของเราบน A01 อยู่ที่ `D:\ai-midel` ฟังพอร์ต 127.0.0.1:11500 (พอร์ต 11434/11435 บน A01 เป็นของ NVIDIA Personal AI Router ห้ามใช้)
เครื่องนี้ต่อไปหา A01 ผ่าน SSH tunnel ด้วย key `%USERPROFILE%\.ssh\a01_alexs_ed25519` จึงไม่ต้องเปิด firewall บน A01

```powershell
.\a01.ps1          # เปิดเซิร์ฟเวอร์บน A01 + tunnel + หน้าแชทเว็บ (เลือกโมเดลได้ที่มุมบน)
.\a01.ps1 -NoWeb   # เปิดแค่ tunnel: API อยู่ที่ http://127.0.0.1:11500
.\a01.ps1 -Deploy  # ส่งไฟล์ใน a01\ ไปที่ A01 ก่อน (หลังแก้ Modelfile/สคริปต์)
.\a01.ps1 -Stop    # ปิด tunnel + ปิดเซิร์ฟเวอร์บน A01
```

## รวมทุกโมเดลในที่เดียว (โหมด ⚡ อัตโนมัติ)

เลือกโมเดล "อัตโนมัติ" แล้ว bridge จะส่งงานไปยังโมเดลที่เหมาะเอง (ทั้งหมดรันบน A01):

| งาน | โมเดล | ติดตั้งโดย |
|---|---|---|
| คุยทั่วไป / tools / ไม่มีลิมิต | `absolute-ai` (fine-tune) → ระหว่างรอใช้ `dan-l3-r1-8b` | `pipeline.ps1` |
| โค้ด / vibe code / skill Coding, Vibe Code, VS Code, Database, Design | `qwen3.6:35b-a3b-coding` (MoE 35B, ใช้จริง 3B ต่อ token) | `setup-media.ps1` |
| ข้อความภาษาไทยเป็นหลัก | `typhoon` (Typhoon 2.1 Gemma3 4B) | `setup-media.ps1` |
| จีน ญี่ปุ่น เกาหลี และภาษาอื่น / แนบรูปมาถาม | `gemma4:12b-it-qat` (140+ ภาษา, ดูรูปได้) | `setup-media.ps1` |
| เติมโค้ด/ค้นโค้ดใน VS Code | `qwen2.5-coder:1.5b-base`, `nomic-embed-text` | `setup-media.ps1` |
| "สร้างรูป…" | FLUX.1-schnell (ComfyUI) 1024×1024 | `setup-media.ps1` |
| "สร้างวิดีโอ…" (แนบรูปได้ = ทำรูปให้ขยับ) | Wan2.2 TI2V-5B (ComfyUI) 544p 2 วิ หรือ 720p 5 วิ | `setup-media.ps1` |

เลือกโหมดเองได้ที่เมนู "โหมด" และความคมชัดวิดีโอที่เมนู "วิดีโอ" ระบบจะเรียบเรียง prompt ภาษาไทยเป็นภาษาอังกฤษแบบละเอียดให้ก่อนสร้าง
การ์ดจอ 8 GB ทำได้ทีละงาน: ระหว่างเทรน ComfyUI จะไม่เปิด และ Ollama บน A01 ย้ายไปใช้ CPU (แชทได้แต่ช้าลง)

## หน้าจอ

- **แถบซ้าย (A):** ประวัติแชท (เก็บใน `D:\ai-midel\chats`) · ปุ่มแชทใหม่ · ลบแชท
- **กลาง:** แชท · ปุ่ม **+** แนบไฟล์ · ปุ่ม **⚡ Skill** เลือกได้หลายตัว (Coding, Vibe Code, VS Code, Database, Design, System analysis)
- **แถบขวา (B):** ผลลัพธ์ รูป วิดีโอ โค้ด และหน้าจอตัวอย่าง (เปิด 🖥 ตัวอย่าง ไว้ เวลาเสนอไอเดียจะได้ mockup HTML หรือไดอะแกรมอัตโนมัติ) พร้อมรายการผลลัพธ์ทั้งหมดของแชท
- **มุมขวาบน:** ☀/🌙 สลับโทนสว่าง/มืด · ภาษาหน้าจอ (ไทย, English, 中文, 日本語, 한국어) · ⚙ ตั้งค่า (ภาษาที่ให้ AI ตอบ 40 ภาษา, System prompt)

## เขียนโปรแกรม / ฐานข้อมูล / VS Code

- `run_command`: โมเดลรันคำสั่ง PowerShell ใน `D:\ai-midel\workspace` ได้ แต่ทุกคำสั่งต้องกด **อนุมัติ** ในแชทก่อน
- `db` (DBHub): SQL บน `workspace\data\app.db` ถ้าจะต่อ PostgreSQL / MySQL / SQL Server ให้แก้ DSN ใน `bridge\mcp.json` (มีตัวอย่าง `*_example` ให้แล้ว) แล้วเอา `"disabled": true` ออก
- **VS Code:** รัน `powershell -ExecutionPolicy Bypass -File D:\ai-midel\vscode\setup-vscode.ps1` (ติดตั้งส่วนขยาย Continue + ตั้งค่า) แล้วเปิด `.\a01.ps1 -NoWeb` จากนั้นกด Ctrl+L ใน VS Code
- tool เหล่านี้ใช้ได้กับโมเดลที่รองรับ tool calling: `qwen3.6:35b-a3b-coding`, `gemma4:12b-it-qat` และ `absolute-ai`

## หน้าแชท Absolute AI (http://127.0.0.1:8765)

หน้าแชทผ่าน bridge (`bridge\server.js`, Node.js) ซึ่งอยู่ระหว่างหน้าเว็บกับ Ollama

| ฟีเจอร์ | ใช้ยังไง |
|---|---|
| ปุ่ม **+** แนบไฟล์ | PDF, Word, Excel, CSV, โค้ด, txt/md/json และรูป (หรือลากไฟล์มาวาง / Ctrl+V รูป) อ่านข้อความในเบราว์เซอร์แล้วส่งให้โมเดล รูปใช้ OCR ไทย+อังกฤษ เพราะโมเดลตอนนี้ดูรูปไม่ได้ |
| **Skill** | Developer, Design, System analysis (ไฟล์ `bridge\skills\*.md` แก้หรือเพิ่มเองได้) |
| 🌐 **ค้นเว็บ** | ค้นแล้วส่งแหล่งข้อมูลให้โมเดลพร้อมลิงก์อ้างอิง [1] [2] |
| 🎯 **แม่นยำ** | อ่านแหล่งข้อมูลมากขึ้น บังคับอ้างอิง ลด temperature |
| แผง **โค้ด / ผลลัพธ์** | เปิดเองเมื่อโมเดลเขียนโค้ด รัน HTML, SVG, JavaScript, React, Python (Pyodide) และ Mermaid ได้ในแผง (sandbox แยกจากแชท) |
| **MCP tools** | `bridge\mcp.json` (รูปแบบเดียวกับ Claude Desktop) ตอนนี้มี `files` อ่าน/เขียนไฟล์ได้เฉพาะใน `D:\ai-midel\workspace` และมี tool ในตัว: `web_search`, `fetch_url`, `calculate`, `get_current_time` จะใช้ได้กับโมเดลที่รองรับ tool calling (`absolute-ai` หลังเทรนเสร็จ) |

**ค้นทั้งเว็บ:** ตอนนี้ค้นได้แค่ Wikipedia ถ้าจะค้นทั้งอินเทอร์เน็ต ให้สมัคร API key ฟรีอย่างใดอย่างหนึ่ง แล้วสร้างไฟล์ `bridge\keys.json`:

```json
{ "TAVILY_API_KEY": "tvly-...", "BRAVE_API_KEY": "" }
```

- Tavily: https://tavily.com (ฟรี 1,000 ครั้ง/เดือน ออกแบบมาสำหรับ AI)
- Brave Search API: https://brave.com/search/api (ฟรี 2,000 ครั้ง/เดือน)

## พัฒนาโมเดล (fine-tune บน A01)

ไฟล์อยู่ใน `a01\` (ส่งขึ้น A01 ด้วย `.\a01.ps1 -Deploy`) งานทั้งหมดรันบน A01 ผ่าน `pipeline.ps1`
1. `fetch-base.ps1` โหลด weights เต็มของ `UnfilteredAI/DAN-L3-R1-8B` (16 GB)
2. `setup-train.ps1` สร้าง venv ที่มี PyTorch CUDA และ Unsloth
3. `build_data.py` สร้างข้อมูลเทรนประมาณ 12k ตัวอย่าง: โค้ด, ทำตามคำสั่ง, คณิต, ภาษาไทย, tool calling (Hermes), design และ system analysis (จาก Tulu-3), แนะนำตัวว่าเป็น Absolute AI ตัดคำตอบแนวปฏิเสธคำสั่งออก
4. `train.py` เทรน QLoRA 1 epoch แล้ว merge
5. นำเข้า Ollama เป็น `absolute-ai` (Q4_K_M) ด้วย `Modelfile.plus` ซึ่งรองรับ tools

วัดผลด้วย `python -I eval\eval.py --model <ชื่อโมเดล>` (GSM8K, ARC-Challenge, ข้อสอบ O-NET ไทย, HumanEval)

## Dataset UnfilteredAI/DAN

```powershell
python prepare_dataset.py   # -> datasets/DAN/train.jsonl, val.jsonl ({"messages":[...]})
```

## หมายเหตุ

- โมเดลนี้ไม่มี safety filter และสร้างเนื้อหาที่เป็นอันตรายได้ (ตามที่ผู้สร้างระบุไว้) ใช้เพื่อการศึกษาในเครื่องที่แยกไว้เท่านั้น
- Qwen3 อาจแสดงขั้นตอนคิดใน `<think>…</think>` ใส่ `/no_think` ท้ายข้อความเพื่อปิด
- GPU: RTX 3050 4 GB ใส่ Q8_0 (1.8 GB) และ context 4096 ได้ทั้งหมด
