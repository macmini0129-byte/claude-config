import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Server defaults (fallback when user hasn't set per-request config)
const SERVER_PROVIDER = process.env.PROVIDER || 'deepseek';
const SERVER_DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || 'sk-175d201f7f4b4b39a3ec36f9fdf62ac8';
const SERVER_DEEPSEEK_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic';
const SERVER_DEEPSEEK_MODEL = process.env.ANTHROPIC_MODEL || 'deepseek-chat';
const SERVER_OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const SERVER_OPENAI_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const SERVER_OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    provider: SERVER_PROVIDER,
    model: SERVER_PROVIDER === 'openai' ? SERVER_OPENAI_MODEL : SERVER_DEEPSEEK_MODEL,
    supportsVision: SERVER_PROVIDER === 'openai',
  });
});

function resolveConfig(clientConfig) {
  const cfg = clientConfig || {};
  const provider = cfg.provider || SERVER_PROVIDER;

  if (provider === 'openai') {
    return {
      provider: 'openai',
      apiKey: cfg.openaiKey || SERVER_OPENAI_KEY,
      baseUrl: cfg.baseUrl || SERVER_OPENAI_URL,
      model: cfg.model || SERVER_OPENAI_MODEL,
      maxTokens: cfg.maxTokens || 4096,
      temperature: cfg.temperature !== undefined ? cfg.temperature : undefined,
      systemPrompt: cfg.systemPrompt || '',
    };
  }
  return {
    provider: 'deepseek',
    apiKey: cfg.apiKey || SERVER_DEEPSEEK_KEY,
    baseUrl: cfg.baseUrl || SERVER_DEEPSEEK_URL,
    model: cfg.model || SERVER_DEEPSEEK_MODEL,
    maxTokens: cfg.maxTokens || 4096,
    temperature: cfg.temperature !== undefined ? cfg.temperature : undefined,
    systemPrompt: cfg.systemPrompt || '',
  };
}

function buildOpenAIContent(text, files) {
  const parts = [];
  if (text) parts.push({ type: 'text', text });
  if (files) {
    for (const f of files) {
      if (f.isImage || f.type?.startsWith('image/')) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${f.type || 'image/png'};base64,${f.data}` },
        });
      } else {
        parts.push({
          type: 'text',
          text: `\n\`\`\`${f.ext || ''}\n// File: ${f.name}\n${f.content}\n\`\`\``,
        });
      }
    }
  }
  return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
}

async function handleOpenAI(cfg, messages, files, stream, res) {
  const lastMsg = messages[messages.length - 1];
  const apiMessages = messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }));

  if (lastMsg.role === 'user' && files?.length) {
    apiMessages.push({ role: 'user', content: buildOpenAIContent(lastMsg.content, files) });
  } else {
    apiMessages.push(lastMsg);
  }

  const body = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages: apiMessages,
  };
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
  if (stream) body.stream = true;

  const response = await fetch(`${cfg.baseUrl}/chat/completions`.replace(/\/+$/, ''), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(err);
  }
  return response;
}

async function handleDeepSeek(cfg, messages, files, stream, res) {
  // DeepSeek Anthropic-compatible doesn't support inline files, merge them into text
  let msgs = messages;
  if (files?.length) {
    msgs = [...messages];
    const last = { ...msgs[msgs.length - 1] };
    for (const f of files) {
      if (!f.isImage) {
        last.content += `\n\n\`\`\`${f.ext || ''}\n// File: ${f.name}\n${f.content}\n\`\`\``;
      }
    }
    msgs[msgs.length - 1] = last;
  }

  const body = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    messages: msgs.map(m => ({ role: m.role, content: m.content })),
  };
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
  if (stream) body.stream = true;

  const response = await fetch(`${cfg.baseUrl}/v1/messages`.replace(/\/+$/, ''), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(err);
  }
  return response;
}

// Non-streaming
app.post('/api/chat', async (req, res) => {
  const { messages, files, config } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  try {
    const cfg = resolveConfig(config || req.headers['x-config'] ? JSON.parse(req.headers['x-config']) : null);

    if (cfg.provider === 'openai') {
      const response = await handleOpenAI(cfg, messages, files, false);
      const data = await response.json();
      res.json({ text: data.choices?.[0]?.message?.content || '' });
    } else {
      const response = await handleDeepSeek(cfg, messages, files, false);
      const data = await response.json();
      const text = data.content?.[0]?.text || data.content?.text || JSON.stringify(data);
      res.json({ text });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Streaming
app.post('/api/chat/stream', async (req, res) => {
  const { messages, files, config } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const cfg = resolveConfig(config);

    let response;
    if (cfg.provider === 'openai') {
      response = await handleOpenAI(cfg, messages, files, true);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') {
              res.write(`event: done\ndata: {}\n\n`);
              continue;
            }
            try {
              const data = JSON.parse(payload);
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) res.write(`event: token\ndata: ${JSON.stringify({ text: delta })}\n\n`);
            } catch (e) { /* skip */ }
          }
        }
      }
      res.write(`event: done\ndata: {}\n\n`);
    } else {
      response = await handleDeepSeek(cfg, messages, files, true);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
                res.write(`event: token\ndata: ${JSON.stringify({ text: data.delta.text })}\n\n`);
              }
              if (data.type === 'message_stop') res.write(`event: done\ndata: {}\n\n`);
            } catch (e) { /* skip */ }
          }
        }
      }
      res.write(`event: done\ndata: {}\n\n`);
    }
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  }
  res.end();
});

// ============ Skills API ============
const SKILLS_DIR = path.join(process.env.HOME || '/Users/qclaw', '.hermes', 'skills');

function parseSkillFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  try {
    const meta = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
      const sep = line.indexOf(':');
      if (sep > 0) {
        let val = line.slice(sep + 1).trim();
        val = val.replace(/^['"](.+)['"]$/, '$1');
        meta[line.slice(0, sep).trim()] = val;
      }
    }
    return { meta, body: match[2].trim() };
  } catch (e) {
    return { meta: {}, body: content };
  }
}

app.get('/api/skills', (req, res) => {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return res.json({ skills: [] });
    const categories = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name);
    const skills = [];
    for (const cat of categories) {
      const catDir = path.join(SKILLS_DIR, cat);
      const items = fs.readdirSync(catDir, { withFileTypes: true })
        .filter(d => d.isDirectory()).map(d => d.name);
      for (const item of items) {
        const skillFile = path.join(catDir, item, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const raw = fs.readFileSync(skillFile, 'utf-8');
          const { meta } = parseSkillFrontmatter(raw);
          skills.push({
            category: cat,
            name: meta.name || item,
            description: meta.description || '',
            tags: meta.metadata?.hermes?.tags || [],
          });
        }
      }
    }
    res.json({ skills });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/skills/:category/:name', (req, res) => {
  try {
    const skillFile = path.join(SKILLS_DIR, req.params.category, req.params.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) {
      return res.status(404).json({ error: 'skill not found' });
    }
    const raw = fs.readFileSync(skillFile, 'utf-8');
    const { meta, body } = parseSkillFrontmatter(raw);
    res.json({ category: req.params.category, name: req.params.name, meta, body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ Exec / Terminal API ============

// Non-streaming exec
app.post('/api/exec', (req, res) => {
  const { command } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'command required' });
  }
  try {
    const stdout = execSync(command, { encoding: 'utf-8', timeout: 30000, maxBuffer: 1024 * 1024 });
    res.json({ stdout, stderr: '', exitCode: 0 });
  } catch (e) {
    res.json({
      stdout: e.stdout || '',
      stderr: e.stderr || e.message,
      exitCode: e.status || 1,
    });
  }
});

// Streaming exec via SSE
app.post('/api/exec/stream', (req, res) => {
  const { command, cwd } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'command required' });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const cwdPath = cwd || process.env.HOME || '/Users/qclaw';

  const child = spawn('bash', ['-c', command], {
    cwd: cwdPath,
    env: { ...process.env },
    timeout: 60000,
  });

  let closed = false;
  const send = (event, data) => {
    if (!closed && !res.writableEnded) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  res.on('close', () => {
    closed = true;
    child.kill('SIGTERM');
  });

  child.stdout.on('data', (data) => send('stdout', { text: data.toString() }));
  child.stderr.on('data', (data) => send('stderr', { text: data.toString() }));

  child.on('error', (err) => {
    send('error', { text: err.message });
    send('exit', { code: 1 });
    if (!res.writableEnded) res.end();
    closed = true;
  });

  child.on('close', (code) => {
    send('exit', { code });
    if (!res.writableEnded) res.end();
    closed = true;
  });
});

app.listen(PORT, () => {
  console.log(`Claude Web running on http://localhost:${PORT}`);
  console.log(`Default provider: ${SERVER_PROVIDER}`);
});
