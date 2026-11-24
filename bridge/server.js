// Absolute AI bridge: serves the chat page and sits between it and Ollama.
// Adds skills (bridge/skills/*.md), web search + page reading, an accuracy mode, and MCP tools (bridge/mcp.json).
//   OLLAMA_URL=http://127.0.0.1:11500 node server.js      (PORT defaults to 8765, binds 127.0.0.1 only)
// Optional: BRAVE_API_KEY for Brave Search, ALLOW_PRIVATE_FETCH=1 to let fetch_url read LAN addresses.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT) || 8765;
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// ---------- skills ----------
function loadSkills() {
  const dir = path.join(HERE, 'skills');
  const out = {};
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.md')) continue;
    const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const meta = Object.fromEntries((m ? m[1] : '').split('\n').map(l => l.split(/:\s*(.*)/s).slice(0, 2)).filter(x => x[0]));
    out[f.replace(/\.md$/, '')] = { name: meta.name || f, description: meta.description || '', body: (m ? m[2] : raw).trim() };
  }
  return out;
}

// ---------- web ----------
const decodeEntities = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const stripTags = s => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

// Search uses official APIs only. Keys come from the environment or bridge/keys.json:
//   { "TAVILY_API_KEY": "tvly-...", "BRAVE_API_KEY": "..." }
// Without a key only the Wikipedia API is available.
function key(name) {
  if (process.env[name]) return process.env[name];
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'keys.json'), 'utf8'))[name] || ''; } catch { return ''; }
}

async function searchTavily(query, n, deep) {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key('TAVILY_API_KEY'), query, max_results: n, search_depth: deep ? 'advanced' : 'basic' }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.content || '', text: x.content || '' }));
}

async function searchBrave(query, n) {
  const r = await fetch(`https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({ q: query, count: n })}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key('BRAVE_API_KEY') }, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.web?.results || []).slice(0, n).map(x => ({ title: stripTags(x.title || ''), url: x.url, snippet: stripTags(x.description || '') }));
}

async function searchWikipedia(query, n) {
  const langs = /[฀-๿]/.test(query) ? ['th', 'en'] : ['en'];
  const out = [];
  for (const lang of langs) {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: n, format: 'json' })}`,
      { headers: { 'User-Agent': 'AbsoluteAI-bridge/1.0 (local research tool)' }, signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    out.push(...(j.query?.search || []).map(x => ({ title: `${x.title} (Wikipedia ${lang})`, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`, snippet: stripTags(x.snippet) })));
  }
  return out.slice(0, n);
}

function searchEngines() {
  return [key('TAVILY_API_KEY') && searchTavily, key('BRAVE_API_KEY') && searchBrave, searchWikipedia].filter(Boolean);
}

async function searchWeb(query, n = 5, deep = false) {
  for (const engine of searchEngines()) {
    try {
      const res = await engine(query, n, deep);
      if (res.length) return res;
    } catch (e) { console.warn(`search ${engine.name}: ${e.message}`); }
  }
  return [];
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function assertPublic(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http/https URLs are allowed');
  if (process.env.ALLOW_PRIVATE_FETCH === '1') return;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error(`refusing to fetch private address ${host}`);
}

function htmlToText(html) {
  const title = stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  let body = html.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const main = body.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main && main[2].length > 500) body = main[2];
  body = body.replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ');
  const text = decodeEntities(body.replace(/<sup[\s\S]*?<\/sup>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\[(\d+|edit|citation needed|แก้|แก้ไข)\]/gi, '')   // page footnote markers would be confused with our [n] source citations
    .split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean).join('\n');
  return { title, text };
}

async function fetchUrl(url, maxChars = 6000) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(current);
    const r = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA, 'Accept-Language': 'th,en;q=0.8' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { current = new URL(r.headers.get('location'), current).href; continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer()).subarray(0, 3_000_000).toString('utf8');
    if (/html/.test(type)) { const { title, text } = htmlToText(buf); return { url: current, title, text: text.slice(0, maxChars) }; }
    if (/text|json|xml|javascript/.test(type)) return { url: current, title: '', text: buf.slice(0, maxChars) };
    throw new Error(`unsupported content type ${type}`);
  }
  throw new Error('too many redirects');
}

// ---------- tools (built-in + MCP) ----------
const tools = new Map(); // name -> { def, run, source }

function addTool(name, description, parameters, run, source = 'built-in') {
  tools.set(name, { def: { type: 'function', function: { name, description, parameters } }, run, source });
}

addTool('web_search', 'Search the internet and return the top results with title, URL and snippet.',
  { type: 'object', properties: { query: { type: 'string', description: 'search query' }, max_results: { type: 'integer', description: '1-10, default 5' } }, required: ['query'] },
  async ({ query, max_results = 5 }) => JSON.stringify(await searchWeb(String(query), Math.min(10, Math.max(1, +max_results || 5))), null, 1));
addTool('fetch_url', 'Download a web page and return its readable text. Use it to read a search result in full.',
  { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'integer', description: 'default 6000' } }, required: ['url'] },
  async ({ url, max_chars = 6000 }) => { const p = await fetchUrl(String(url), Math.min(20000, +max_chars || 6000)); return `${p.title}\n${p.url}\n\n${p.text}`; });
// Safe arithmetic (no eval): numbers, + - * / % ^, parentheses, and a few math functions.
function calculate(expr) {
  const FN = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, log: Math.log10, ln: Math.log, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan };
  const CONST = { pi: Math.PI, e: Math.E };
  const toks = String(expr).replace(/,/g, '').match(/\d*\.?\d+(?:e[+-]?\d+)?|[a-z]+|[-+*/%^()]/gi) || [];
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  const primary = () => {
    const t = next();
    if (t === '(') { const v = sum(); if (next() !== ')') throw new Error('missing )'); return v; }
    if (t === '-') return -primary();
    if (t === '+') return primary();
    if (/^[a-z]+$/i.test(t)) {
      const k = t.toLowerCase();
      if (k in CONST) return CONST[k];
      if (!(k in FN) || next() !== '(') throw new Error(`unknown ${t}`);
      const v = sum(); if (next() !== ')') throw new Error('missing )'); return FN[k](v);
    }
    const n = Number(t); if (Number.isNaN(n)) throw new Error(`bad token ${t}`); return n;
  };
  const power = () => { const b = primary(); return peek() === '^' ? (next(), b ** power()) : b; };
  const product = () => { let v = power(); while (['*', '/', '%'].includes(peek())) { const op = next(), r = power(); v = op === '*' ? v * r : op === '/' ? v / r : v % r; } return v; };
  const sum = () => { let v = product(); while (['+', '-'].includes(peek())) { const op = next(), r = product(); v = op === '+' ? v + r : v - r; } return v; };
  const v = sum();
  if (i < toks.length) throw new Error(`unexpected ${toks[i]}`);
  return v;
}
addTool('calculate', 'Evaluate an arithmetic expression exactly. Always use this for any calculation instead of doing math in your head. Supports + - * / % ^ ( ) sqrt abs round floor ceil log ln exp sin cos tan pi e.',
  { type: 'object', properties: { expression: { type: 'string', description: 'e.g. (90+75+97+64)/4' } }, required: ['expression'] },
  async ({ expression }) => `${expression} = ${calculate(expression)}`);

addTool('get_current_time', 'Current date and time (Asia/Bangkok and UTC).', { type: 'object', properties: {} },
  async () => `Bangkok: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })} | UTC: ${new Date().toISOString()}`);

const mcpStatus = {};
async function connectMcp() {
  const file = path.join(HERE, 'mcp.json');
  if (!fs.existsSync(file)) return;
  const { mcpServers = {} } = JSON.parse(fs.readFileSync(file, 'utf8'));
  await Promise.all(Object.entries(mcpServers).map(async ([server, cfg]) => {
    if (cfg.disabled) { mcpStatus[server] = 'disabled'; return; }
    try {
      for (const d of cfg.mkdirs || []) fs.mkdirSync(d, { recursive: true });
      const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args || [], env: { ...process.env, ...(cfg.env || {}) }, cwd: cfg.cwd, stderr: 'ignore' });
      const client = new Client({ name: 'absolute-ai', version: '1.0.0' });
      await client.connect(transport);
      const { tools: list } = await client.listTools();
      for (const t of list) {
        const name = `${server}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        addTool(name, t.description || t.name, t.inputSchema || { type: 'object', properties: {} }, async args => {
          const r = await client.callTool({ name: t.name, arguments: args || {} });
          return (r.content || []).map(c => c.type === 'text' ? c.text : `[${c.type}]`).join('\n') || JSON.stringify(r);
        }, `mcp:${server}`);
      }
      mcpStatus[server] = `connected (${list.length} tools)`;
    } catch (e) { mcpStatus[server] = `error: ${e.message}`; console.warn(`MCP ${server}: ${e.message}`); }
  }));
}

async function runTool(name, args, ctx = {}) {
  const t = tools.get(name);
  if (!t) return `error: unknown tool ${name}`;
  try { return String(await t.run(typeof args === 'string' ? JSON.parse(args) : (args || {}), ctx)).slice(0, 12000); }
  catch (e) { return `error: ${e.message}`; }
}

// ---------- media generation (ComfyUI on A01: FLUX.1-schnell images, Wan2.2 TI2V-5B video) ----------
const COMFY = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
const MEDIA_DIR = path.join(ROOT, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
let comfyHoldsGpu = false;

const WAN_NEGATIVE = '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走';

function imageWorkflow(prompt, { width = 1024, height = 1024, seed }) {
  return {
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'flux1-schnell-Q4_K_S.gguf' } },
    2: { class_type: 'DualCLIPLoader', inputs: { clip_name1: 't5xxl_fp8_e4m3fn.safetensors', clip_name2: 'clip_l.safetensors', type: 'flux' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    5: { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
    7: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    6: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['7', 0], latent_image: ['5', 0], seed, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['3', 0] } },
    9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'absolute/img' } },
  };
}

function videoWorkflow(prompt, { width, height, length, steps, seed, startImage }) {
  const wf = {
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'Wan2.2-TI2V-5B-Q8_0.gguf' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', type: 'wan', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'wan2.2_vae.safetensors' } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
    5: { class_type: 'CLIPTextEncode', inputs: { text: WAN_NEGATIVE, clip: ['2', 0] } },
    6: { class_type: 'ModelSamplingSD3', inputs: { shift: 8, model: ['1', 0] } },
    7: { class_type: 'Wan22ImageToVideoLatent', inputs: { vae: ['3', 0], width, height, length, batch_size: 1 } },
    8: { class_type: 'KSampler', inputs: { model: ['6', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['7', 0], seed, steps, cfg: 5, sampler_name: 'uni_pc', scheduler: 'simple', denoise: 1 } },
    10: { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
    11: { class_type: 'CreateVideo', inputs: { images: ['10', 0], fps: 24 } },
    12: { class_type: 'SaveVideo', inputs: { video: ['11', 0], filename_prefix: 'absolute/video', format: 'auto', codec: 'auto' } },
  };
  if (startImage) {
    wf[9] = { class_type: 'LoadImage', inputs: { image: startImage } };
    wf[7].inputs.start_image = ['9', 0];
  }
  return wf;
}

async function comfyUp() {
  try { return (await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}

async function comfyUpload(b64) {
  const buf = Buffer.from(b64, 'base64');
  const isPng = buf[0] === 0x89;
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type: isPng ? 'image/png' : 'image/jpeg' }), `absolute_${Date.now()}.${isPng ? 'png' : 'jpg'}`);
  fd.append('overwrite', 'true');
  const j = await (await fetch(`${COMFY}/upload/image`, { method: 'POST', body: fd })).json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

function imageSize(b64) {   // PNG / JPEG header only
  const b = Buffer.from(b64.slice(0, 80000), 'base64');
  if (b[0] === 0x89) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xc3) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

async function comfyRun(workflow, send, signal) {
  const clientId = `absolute-${Date.now()}`;
  let ws = null;
  try {
    ws = new WebSocket(`${COMFY.replace(/^http/, 'ws')}/ws?clientId=${clientId}`);
    ws.onmessage = ev => {
      if (typeof ev.data !== 'string') return;
      const m = JSON.parse(ev.data);
      if (m.type === 'progress') send({ type: 'progress', value: m.data.value, max: m.data.max });
    };
  } catch { ws = null; }
  try {
    const r = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow, client_id: clientId }) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`ComfyUI: ${JSON.stringify(j.error || j.node_errors || j).slice(0, 400)}`);
    comfyHoldsGpu = true;
    const id = j.prompt_id;
    for (;;) {
      if (signal?.aborted) { await fetch(`${COMFY}/interrupt`, { method: 'POST' }).catch(() => {}); throw new Error('cancelled'); }
      await new Promise(ok => setTimeout(ok, 2000));
      const h = (await (await fetch(`${COMFY}/history/${id}`)).json())[id];
      if (!h) continue;
      if (h.status?.status_str === 'error') throw new Error('ComfyUI job failed: ' + JSON.stringify(h.status.messages?.slice(-1)).slice(0, 400));
      if (!h.status?.completed) continue;
      for (const out of Object.values(h.outputs || {})) {
        for (const key of ['videos', 'gifs', 'images']) {
          for (const f of out[key] || []) {
            if (!f.filename || f.type !== 'output') continue;
            const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: 'output' });
            const data = Buffer.from(await (await fetch(`${COMFY}/view?${q}`)).arrayBuffer());
            const name = `${Date.now()}_${path.basename(f.filename)}`;
            fs.writeFileSync(path.join(MEDIA_DIR, name), data);
            return `/media/${name}`;
          }
        }
      }
      throw new Error('ComfyUI finished without an output file');
    }
  } finally { try { ws?.close(); } catch {} }
}

async function freeGpuForLlm() {
  if (!comfyHoldsGpu) return;
  await fetch(`${COMFY}/free`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }) }).catch(() => {});
  comfyHoldsGpu = false;
}
async function freeGpuForComfy() {
  try {
    const ps = await (await fetch(`${OLLAMA}/api/ps`)).json();
    await Promise.all((ps.models || []).map(m => fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }) })));
  } catch {}
}

// Turn a short (possibly Thai) request into a detailed English prompt; image/video models follow those best.
async function enhancePrompt(kind, text, models) {
  const llm = ['qwen2.5-coder:7b', 'dan-l3-r1-8b', 'absolute-ai', 'dan-qwen3'].find(m => models.includes(m));
  if (!llm) return text;
  const how = kind === 'video'
    ? 'Write ONE detailed English prompt for a text-to-video model: subject and appearance, action and motion over time, camera movement, setting, lighting, mood, style, and "sharp focus, high detail, 4k".'
    : 'Write ONE detailed English prompt for a text-to-image model: subject, composition, setting, lighting, colors, style, lens/camera, and "sharp focus, highly detailed".';
  try {
    const r = await fetch(`${OLLAMA}/api/generate`, { method: 'POST', signal: AbortSignal.timeout(120000), body: JSON.stringify({
      model: llm, stream: false, keep_alive: 0, options: { temperature: 0.6, num_predict: 220 },
      prompt: `${how} Keep every detail the user asked for. Output only the prompt, no quotes, no explanation, under 120 words.\n\nUser request: ${text}`,
    }) });
    const out = (await r.json()).response?.replace(/<think>[\s\S]*?<\/think>/g, '').trim().replace(/^["']|["']$/g, '');
    return out && out.length > 10 ? out : text;
  } catch { return text; }
}

const VIDEO_PRESETS = {
  fast: { width: 960, height: 544, length: 49, steps: 15, label: '960×544 · 2 วินาที' },
  hd: { width: 1280, height: 704, length: 121, steps: 20, label: '1280×704 (720p) · 5 วินาที' },
};

async function generateMedia(kind, text, { quality = 'fast', image, enhance = true, models = [] }, send, signal) {
  if (!(await comfyUp())) throw new Error('ระบบสร้างรูป/วิดีโอยังไม่พร้อม (ComfyUI บน A01 ยังไม่เปิด: กำลังติดตั้ง หรือ GPU กำลังใช้เทรน) ลองรัน a01.ps1 อีกครั้งภายหลัง');
  const prompt = enhance ? (send({ type: 'status', text: 'เรียบเรียง prompt ให้ละเอียด…' }), await enhancePrompt(kind, text, models)) : text;
  send({ type: 'status', text: `prompt: ${prompt}` });
  await freeGpuForComfy();
  const seed = Math.floor(Math.random() * 2 ** 31);
  let wf;
  if (kind === 'image') {
    send({ type: 'status', text: 'สร้างรูปด้วย FLUX.1-schnell 1024×1024…' });
    wf = imageWorkflow(prompt, { seed });
  } else {
    const p = { ...(VIDEO_PRESETS[quality] || VIDEO_PRESETS.fast) };
    let startImage;
    if (image) {
      const s = imageSize(image);
      if (s && s.h > s.w) [p.width, p.height] = [p.height, p.width];   // portrait source -> portrait video
      startImage = await comfyUpload(image);
    }
    send({ type: 'status', text: `สร้างวิดีโอด้วย Wan2.2 ${image ? 'จากรูป' : 'จากข้อความ'} · ${p.label} (อาจใช้เวลาหลายนาที)…` });
    wf = videoWorkflow(prompt, { ...p, seed, startImage });
  }
  const url = await comfyRun(wf, send, signal);
  send({ type: 'media', kind, url, prompt });
  return { url, prompt };
}

// ---------- automatic model routing ("all-in-one") ----------
const RX_VIDEO = /(สร้าง|ทำ|เจน|gen(erate)?|make|create|render|animate).{0,25}(วิดีโอ|วีดีโอ|วิดิโอ|คลิป|video|clip|animation|อนิเมชัน)|(วิดีโอ|วีดีโอ|video|clip)\s*(ของ|of|showing)/i;
const RX_IMAGE = /(สร้าง|วาด|ทำ|เจน|gen(erate)?|draw|make|create|paint|render|design).{0,25}(รูปภาพ|ภาพ|รูป(?!แบบ)|image|picture|photo|illustration|poster|โปสเตอร์|wallpaper|artwork)/i;
const RX_CODE = /```|\b(code|coding|function|class|bug|debug|error|exception|html|css|javascript|typescript|python|react|next\.?js|node|api|sql|regex|script|component|vibe ?cod\w*|deploy)\b|โค้ด|โคด|เขียนโปรแกรม|เขียนเว็บ|ทำเว็บ|แอป/i;

const CODER = ['qwen3.6:35b-a3b-coding', 'qwen2.5-coder:7b', 'absolute-ai'];   // absolute-ai: HumanEval 50.6 vs 42.7 for its base
const VISION = ['gemma4:12b-it-qat', 'qwen2.5vl:7b'];
const MULTI = ['gemma4:12b-it-qat'];
const CODE_SKILLS = new Set(['developer', 'design', 'vibe-code', 'vscode', 'database']);

function routeRequest({ text, hasImage, skills = [], mode, models, language }) {
  const have = m => models.includes(m);
  const pick = list => list.find(have);
  // dan-l3-r1-8b stays the general default: the fine-tune scored lower on GSM8K (63 vs 76) and ARC (49 vs 71)
  const general = ['dan-l3-r1-8b', 'absolute-ai', 'dan-qwen3'].find(have);
  if (mode === 'video' || (mode === 'auto' && RX_VIDEO.test(text))) return { kind: 'video' };
  if (mode === 'image' || (mode === 'auto' && !hasImage && RX_IMAGE.test(text))) return { kind: 'image' };
  if (hasImage && pick(VISION)) return { kind: 'chat', model: pick(VISION), why: 'มีรูปแนบ' };
  if ((skills.some(s => CODE_SKILLS.has(s)) || RX_CODE.test(text)) && pick(CODER)) return { kind: 'chat', model: pick(CODER), why: 'งานโค้ด' };
  const letters = Math.max(1, text.replace(/[\s\d\p{P}]/gu, '').length);
  const share = rx => (text.match(rx) || []).length / letters;
  if ((language === 'th' || (!language && share(/[฀-๿]/g) > 0.3)) && have('typhoon')) return { kind: 'chat', model: 'typhoon', why: 'ภาษาไทย' };
  // other non-Latin scripts (Chinese, Japanese, Korean, Arabic, Hindi, Russian, ...) or a chosen non-English language
  if (((language && !['en', 'th'].includes(language)) || share(/[^\p{Script=Latin}฀-๿]/gu) > 0.3) && pick(MULTI)) return { kind: 'chat', model: pick(MULTI), why: 'หลายภาษา' };
  return { kind: 'chat', model: general, why: 'ทั่วไป' };
}

const LANGS = { th: 'Thai', en: 'English', zh: 'Simplified Chinese', 'zh-TW': 'Traditional Chinese', ja: 'Japanese', ko: 'Korean',
  vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', hi: 'Hindi', ar: 'Arabic', es: 'Spanish', fr: 'French', de: 'German',
  pt: 'Portuguese', it: 'Italian', ru: 'Russian', tr: 'Turkish', pl: 'Polish', nl: 'Dutch', uk: 'Ukrainian', sv: 'Swedish',
  bn: 'Bengali', fa: 'Persian', he: 'Hebrew', el: 'Greek', cs: 'Czech', da: 'Danish', fi: 'Finnish', no: 'Norwegian',
  hu: 'Hungarian', ro: 'Romanian', fil: 'Filipino', sw: 'Swahili', ur: 'Urdu', ta: 'Tamil', my: 'Burmese', lo: 'Lao', km: 'Khmer' };

const MOCKUP_UI = `From the idea above, build ONE self-contained HTML file that shows what the finished product looks like (a realistic UI mockup/prototype).
Requirements: inline CSS and JS only, no external images or libraries (use emoji, inline SVG and CSS for icons and pictures), realistic sample data, modern dark design with one accent color, responsive, a few working interactions (tabs, buttons, modal). Text in the same language as the conversation.
Output ONLY the code in a single \`\`\`html block.`;
const MOCKUP_DIAGRAM = `From the analysis above, draw ONE Mermaid diagram that best explains the system (architecture flowchart, sequenceDiagram or erDiagram). Use short labels in the conversation's language and valid Mermaid syntax.
Output ONLY the diagram in a single \`\`\`mermaid block.`;

// ---------- commands that need the user's approval (run in the workspace on this PC) ----------
const WORKSPACE = path.join(ROOT, 'workspace');
fs.mkdirSync(WORKSPACE, { recursive: true });
const approvals = new Map();   // id -> resolve(boolean)
const { spawn } = await import('node:child_process');

function runCommand(command, cwd) {
  return new Promise(ok => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, windowsHide: true });
    let out = '';
    const add = d => { out += d.toString('utf8'); if (out.length > 20000) out = out.slice(-20000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { p.kill(); out += '\n[stopped: 180 s timeout]'; }, 180000);
    p.on('close', code => { clearTimeout(timer); ok(`exit code ${code}\n${out.trim()}`); });
  });
}

addTool('run_command', 'Run a PowerShell command on the user\'s PC inside the workspace folder (install packages, run programs, tests, git, database CLIs). The user must approve every command before it runs. Returns exit code and output.',
  { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'sub-folder of the workspace, optional' } }, required: ['command'] },
  async ({ command, cwd }, ctx) => {
    const dir = path.resolve(WORKSPACE, String(cwd || '.'));
    if (!dir.startsWith(WORKSPACE)) return 'error: cwd must stay inside the workspace';
    fs.mkdirSync(dir, { recursive: true });
    const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    ctx.send?.({ type: 'approve', id, command: String(command), cwd: dir });
    const ok = await new Promise(resolve => {
      approvals.set(id, resolve);
      ctx.signal?.addEventListener('abort', () => resolve(false));
      setTimeout(() => resolve(false), 600000);
    });
    approvals.delete(id);
    if (!ok) return 'The user declined this command. Do not run it again; ask what they want instead.';
    ctx.send?.({ type: 'status', text: `กำลังรัน: ${command}` });
    return runCommand(String(command), dir);
  });

// ---------- saved chats (sidebar history) ----------
const CHATS_DIR = path.join(ROOT, 'chats');
fs.mkdirSync(CHATS_DIR, { recursive: true });
const chatFile = id => path.join(CHATS_DIR, `${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}.json`);

addTool('generate_image', 'Create an image from a text description (FLUX.1-schnell, 1024x1024). The image is shown to the user automatically.',
  { type: 'object', properties: { prompt: { type: 'string', description: 'detailed English description of the image' } }, required: ['prompt'] },
  async ({ prompt }, ctx) => { const r = await generateMedia('image', String(prompt), { enhance: false, models: ctx.models || [] }, ctx.send || (() => {}), ctx.signal); return `Image created: ${r.url}`; });
addTool('generate_video', 'Create a short video from a text description (Wan2.2, 24 fps). The video is shown to the user automatically. Takes several minutes.',
  { type: 'object', properties: { prompt: { type: 'string', description: 'detailed English description: subject, motion, camera, lighting, style' }, quality: { type: 'string', enum: ['fast', 'hd'] } }, required: ['prompt'] },
  async ({ prompt, quality }, ctx) => { const r = await generateMedia('video', String(prompt), { enhance: false, quality: quality || ctx.quality, models: ctx.models || [] }, ctx.send || (() => {}), ctx.signal); return `Video created: ${r.url}`; });

// ---------- ollama ----------
async function listModels() {
  try { return (await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) })).json()).models.map(m => m.name.replace(/:latest$/, '')); }
  catch { return []; }
}
const capsCache = new Map();
async function capabilities(model) {
  if (!capsCache.has(model)) {
    try {
      const r = await fetch(`${OLLAMA}/api/show`, { method: 'POST', body: JSON.stringify({ model }) });
      capsCache.set(model, (await r.json()).capabilities || []);
    } catch { return []; }
  }
  return capsCache.get(model);
}

const ACCURACY = `Accuracy mode is on.
- Check every fact, number, name, date and piece of code before you state it.
- When sources or tool results are provided, base factual claims on them and cite them as [1], [2]. Prefer the most authoritative and most recent source; point out when sources disagree.
- If the information is missing or uncertain, say so plainly instead of guessing.
- Work through the problem step by step, then give a clear, direct final answer.`;

async function handleChat(req, res) {
  const body = JSON.parse(await readBody(req));
  const { system, web, accurate, language } = body;
  const skillIds = [...new Set([...(Array.isArray(body.skills) ? body.skills : []), ...(body.skill ? [body.skill] : [])])];
  const mode = body.mode || 'auto';
  if (mode === 'mockup') return handleMockup(body, res);
  let model = body.model;
  const useTools = body.tools !== false;
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  const send = o => res.write(JSON.stringify(o) + '\n');
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
    const models = await listModels();
    const last = [...(body.messages || [])].reverse().find(m => m.role === 'user') || { content: '' };
    const lastText = last.content.split('\n\n[ไฟล์แนบ')[0];
    const lastImage = last.images?.[0];

    // image / video generation, chosen explicitly (mode) or by the automatic router
    if (mode === 'image' || mode === 'video' || model === 'auto') {
      const r = routeRequest({ text: lastText, hasImage: !!lastImage, skills: skillIds, mode, models, language });
      if (r.kind !== 'chat') {
        send({ type: 'route', model: r.kind === 'image' ? 'FLUX.1-schnell' : 'Wan2.2-TI2V-5B', why: r.kind === 'image' ? 'สร้างรูป' : 'สร้างวิดีโอ' });
        await generateMedia(r.kind, lastText || 'a cinematic shot', { quality: body.quality, image: r.kind === 'video' ? lastImage : null, enhance: body.enhance !== false, models }, send, abort.signal);
        send({ type: 'done' });
        return res.end();
      }
      if (model === 'auto') { model = r.model; send({ type: 'route', model, why: r.why }); }
    }
    if (!model) throw new Error(models.length ? 'ไม่มีโมเดลแชทบนเซิร์ฟเวอร์'
      : `ติดต่อ Ollama ที่ ${OLLAMA} ไม่ได้ (tunnel ไป A01 หลุดหรือเซิร์ฟเวอร์ปิด) ลองรัน a01.ps1 อีกครั้ง`);
    await freeGpuForLlm();
    const caps = await capabilities(model);
    const sys = [];
    const skills = loadSkills();
    const active = skillIds.filter(id => skills[id]);
    if (active.length) sys.push(active.map(id => `## Skill: ${skills[id].name}\n${skills[id].body}`).join('\n\n'));
    if (accurate) sys.push(ACCURACY);
    sys.push(LANGS[language] ? `Always reply in ${LANGS[language]}, whatever language the user writes in.` : 'Reply in the same language as the user\'s latest message.');

    const messages = (body.messages || []).map(m => ({ role: m.role, content: m.content, ...(m.images?.length && caps.includes('vision') ? { images: m.images } : {}) }));
    if (web) {
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      const query = (lastUser?.content || '').split('\n\n[ไฟล์แนบ')[0].replace(/\s+/g, ' ').trim().slice(0, 300);
      if (query) {
        const engine = searchEngines()[0].name.replace('search', '');
        send({ type: 'status', text: `ค้นเว็บ (${engine}): ${query}` });
        const results = await searchWeb(query, accurate ? 6 : 4, accurate);
        const nRead = accurate ? 3 : 2;
        const pages = await Promise.all(results.slice(0, nRead).map(r => r.text ? null : fetchUrl(r.url, accurate ? 4000 : 2500).catch(() => null)));
        send({ type: 'status', text: `ได้ ${results.length} แหล่ง` });
        send({ type: 'sources', sources: results.map((r, i) => ({ n: i + 1, title: r.title, url: r.url })) });
        const today = new Date().toISOString().slice(0, 10);
        // Sources go into the user's own turn: small models follow context there much better than in a system prompt.
        lastUser.content = results.length
          ? `${lastUser.content}\n\n=== WEB SOURCES (searched ${today}) ===\n` +
            results.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${(r.text || pages[i]?.text || r.snippet).slice(0, accurate ? 4000 : 2500)}`).join('\n\n') +
            `\n=== END OF SOURCES ===\nAnswer using ONLY facts found in the sources above and cite them as [1]..[${results.length}]. ` +
            'Do not invent version numbers, dates, names or citations. If the sources do not contain the answer, say clearly that the search did not find it.'
          : `${lastUser.content}\n\n(Web search found nothing. Say that you could not verify this online, then answer from your own knowledge and mark uncertain parts.)`;
      }
    }
    if (system) sys.push(system);
    if (sys.length) messages.unshift({ role: 'system', content: sys.join('\n\n---\n\n') });

    const toolDefs = useTools && caps.includes('tools') ? [...tools.values()].map(t => t.def) : undefined;
    // num_predict caps runaway generations (an 8B model can loop until the context is full and block the queue)
    const options = { num_predict: 4096, ...(accurate ? { temperature: 0.2, top_p: 0.9 } : {}) };
    for (let round = 0; round < 8; round++) {
      const r = await fetch(`${OLLAMA}/api/chat`, {
        method: 'POST', signal: abort.signal,
        body: JSON.stringify({ model, messages, stream: true, options, ...(toolDefs ? { tools: toolDefs } : {}) }),
      });
      if (!r.ok) throw new Error(`Ollama: ${await r.text()}`);
      let content = '', calls = [], buf = '';
      const dec = new TextDecoder();
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const j = JSON.parse(line);
          if (j.error) throw new Error(j.error);
          if (j.message?.content) { content += j.message.content; send({ type: 'token', text: j.message.content }); }
          if (j.message?.tool_calls) calls.push(...j.message.tool_calls);
        }
      }
      if (!calls.length) break;
      messages.push({ role: 'assistant', content, tool_calls: calls });
      for (const c of calls) {
        const name = c.function?.name, args = c.function?.arguments || {};
        send({ type: 'tool', name, args });
        const result = await runTool(name, args, { send, signal: abort.signal, models, quality: body.quality });
        send({ type: 'tool_result', name, preview: result.slice(0, 400) });
        messages.push({ role: 'tool', content: result, tool_name: name });
      }
    }
    send({ type: 'done' });
  } catch (e) {
    if (!abort.signal.aborted) send({ type: 'error', text: e.message });
  }
  res.end();
}

// Visual preview for an idea: HTML mockup (design / vibe code) or Mermaid diagram (system analysis), streamed like chat.
async function handleMockup(body, res) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });
  const send = o => res.write(JSON.stringify(o) + '\n');
  const abort = new AbortController();
  res.on('close', () => abort.abort());
  try {
    const models = await listModels();
    const model = CODER.find(m => models.includes(m)) || ['dan-l3-r1-8b', 'absolute-ai', 'dan-qwen3'].find(m => models.includes(m));
    send({ type: 'route', model, why: body.kind === 'diagram' ? 'ไดอะแกรม' : 'หน้าจอตัวอย่าง' });
    await freeGpuForLlm();
    const prompt = `${String(body.idea || '').slice(-12000)}\n\n---\n${body.kind === 'diagram' ? MOCKUP_DIAGRAM : MOCKUP_UI}`;
    const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', signal: abort.signal,
      body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: prompt }], options: { num_predict: 6000, temperature: 0.4 } }) });
    if (!r.ok) throw new Error(`Ollama: ${await r.text()}`);
    let buf = '';
    const dec = new TextDecoder();
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        if (j.message?.content) send({ type: 'token', text: j.message.content });
      }
    }
    send({ type: 'done' });
  } catch (e) { if (!abort.signal.aborted) send({ type: 'error', text: e.message }); }
  res.end();
}

// ---------- http ----------
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }

async function handleChats(req, res, url) {
  const id = url.pathname.split('/')[3];
  if (!id) {   // list
    const list = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json')).map(f => {
      try { const c = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, f), 'utf8')); return { id: c.id, title: c.title, updated: c.updated }; } catch { return null; }
    }).filter(Boolean).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    return json(res, list);
  }
  const f = chatFile(id);
  if (req.method === 'GET') return fs.existsSync(f) ? json(res, JSON.parse(fs.readFileSync(f, 'utf8'))) : json(res, { error: 'not found' }, 404);
  if (req.method === 'DELETE') { fs.rmSync(f, { force: true }); return json(res, { ok: true }); }
  if (req.method === 'POST') {
    const c = JSON.parse(await readBody(req));
    fs.writeFileSync(f, JSON.stringify({ ...c, id, updated: new Date().toISOString() }));
    return json(res, { ok: true });
  }
  return json(res, { error: 'method' }, 405);
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const parts = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 60e6) { fail(new Error('body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

const STATIC = { '/': 'chat.html', '/chat.html': 'chat.html', '/logo.svg': 'logo.svg' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const f = path.join(MEDIA_DIR, path.basename(decodeURIComponent(url.pathname)));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      const size = fs.statSync(f).size;
      const type = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(f).toLowerCase()] || 'application/octet-stream';
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? +m[2] : size - 1;
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
        return fs.createReadStream(f, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(f).pipe(res);
    }
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const f = path.join(ROOT, STATIC[url.pathname]);
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'Cache-Control': 'no-cache' });
      return fs.createReadStream(f).pipe(res);
    }
    if (url.pathname.startsWith('/api/')) {
      // only this page may call the API: blocks other websites from driving the tools through the browser
      const origin = req.headers.origin;
      if (req.method !== 'GET' && (!origin || !ORIGINS.has(origin) || !/json/.test(req.headers['content-type'] || ''))) {
        res.writeHead(403); return res.end('forbidden');
      }
      if (url.pathname === '/api/info') {
        let models = [], ok = true;
        try { models = (await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(5000) })).json()).models.map(m => m.name.replace(/:latest$/, '')).sort(); }
        catch { ok = false; }
        const skills = Object.entries(loadSkills()).map(([id, s]) => ({ id, name: s.name, description: s.description }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ollama: OLLAMA, ollamaUp: ok, models, skills, mcp: mcpStatus,
          search: searchEngines().map(f => f.name.replace('search', '')), media: await comfyUp(),
          tools: [...tools.entries()].map(([n, t]) => ({ name: n, source: t.source })) }));
      }
      if (url.pathname === '/api/caps') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const m = url.searchParams.get('model') || '';
        return res.end(JSON.stringify(m === 'auto' ? ['completion', 'tools', 'vision', 'auto'] : await capabilities(m)));
      }
      if (url.pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);
      if (url.pathname.startsWith('/api/chats')) return handleChats(req, res, url);
      if (url.pathname === '/api/approve' && req.method === 'POST') {
        const { id, ok } = JSON.parse(await readBody(req));
        approvals.get(id)?.(!!ok);
        return json(res, { ok: approvals.has(id) || true });
      }
      if (url.pathname === '/api/languages') return json(res, LANGS);
    }
    res.writeHead(404); res.end('not found');
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end(String(e.message));
  }
});

// Separate origin (PORT+1) that only serves the Python runner page for the code/result panel.
const runner = http.createServer((req, res) => {
  if (req.method === 'GET' && new URL(req.url, 'http://x').pathname === '/py-runner.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return fs.createReadStream(path.join(HERE, 'py-runner.html')).pipe(res);
  }
  res.writeHead(404); res.end();
});

// serve the page right away; MCP servers (npx) can take a minute to come up and join in the background
server.listen(PORT, '127.0.0.1', () => console.log(`Absolute AI bridge on http://127.0.0.1:${PORT}  ollama=${OLLAMA}`));
connectMcp().then(() => console.log(`MCP ready, tools=${[...tools.keys()].join(', ')}`));
runner.listen(PORT + 1, '127.0.0.1');
