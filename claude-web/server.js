import express from 'express';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

// Provider config: deepseek or openai
const PROVIDER = process.env.PROVIDER || 'deepseek';

// DeepSeek (Anthropic-compatible API)
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || 'sk-175d201f7f4b4b39a3ec36f9fdf62ac8';
const DEEPSEEK_BASE_URL = process.env.ANTHROPIC_BASE_URL || 'https://api.deepseek.com/anthropic';
const DEEPSEEK_MODEL = process.env.ANTHROPIC_MODEL || 'deepseek-chat';

// OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    provider: PROVIDER,
    model: PROVIDER === 'openai' ? OPENAI_MODEL : DEEPSEEK_MODEL,
    supportsVision: PROVIDER === 'openai',
  });
});

// Helper: detect if content needs vision (has images)
function buildOpenAIContent(text, files) {
  const parts = [];
  if (text) {
    parts.push({ type: 'text', text });
  }
  if (files) {
    for (const f of files) {
      if (f.type?.startsWith('image/')) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${f.type};base64,${f.data}` },
        });
      } else {
        parts.push({
          type: 'text',
          text: `\n\`\`\`${f.ext}\n// File: ${f.name}\n${f.content}\n\`\`\``,
        });
      }
    }
  }
  return parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
}

// Non-streaming chat
app.post('/api/chat', async (req, res) => {
  const { messages, files } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  try {
    if (PROVIDER === 'openai') {
      // Build OpenAI messages with file/vision support
      const lastMsg = messages[messages.length - 1];
      const apiMessages = [...messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))];

      if (lastMsg.role === 'user' && files?.length) {
        apiMessages.push({ role: 'user', content: buildOpenAIContent(lastMsg.content, files) });
      } else if (lastMsg.role === 'user') {
        apiMessages.push({ role: 'user', content: lastMsg.content });
      } else {
        apiMessages.push(lastMsg);
      }

      const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_tokens: 4096,
          messages: apiMessages,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }

      const data = await response.json();
      res.json({ text: data.choices?.[0]?.message?.content || '' });
    } else {
      // DeepSeek (existing Anthropic path)
      const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': DEEPSEEK_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          max_tokens: 4096,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return res.status(response.status).json({ error: err });
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || data.content?.text || JSON.stringify(data);
      res.json({ text });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Streaming chat
app.post('/api/chat/stream', async (req, res) => {
  const { messages, files } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    if (PROVIDER === 'openai') {
      const lastMsg = messages[messages.length - 1];
      const apiMessages = [...messages.slice(0, -1).map(m => ({ role: m.role, content: m.content }))];

      if (lastMsg.role === 'user' && files?.length) {
        apiMessages.push({ role: 'user', content: buildOpenAIContent(lastMsg.content, files) });
      } else {
        apiMessages.push(lastMsg);
      }

      const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          max_tokens: 4096,
          stream: true,
          messages: apiMessages,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        res.write(`event: error\ndata: ${JSON.stringify({ error: err })}\n\n`);
        res.end();
        return;
      }

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
              if (delta) {
                res.write(`event: token\ndata: ${JSON.stringify({ text: delta })}\n\n`);
              }
            } catch (e) { /* skip */ }
          }
        }
      }
      res.write(`event: done\ndata: {}\n\n`);
    } else {
      // DeepSeek streaming (existing)
      const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': DEEPSEEK_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          max_tokens: 4096,
          stream: true,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        res.write(`event: error\ndata: ${JSON.stringify({ error: err })}\n\n`);
        res.end();
        return;
      }

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
              if (data.type === 'message_stop') {
                res.write(`event: done\ndata: {}\n\n`);
              }
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

app.listen(PORT, () => {
  console.log(`Claude Web running on http://localhost:${PORT}`);
  console.log(`Provider: ${PROVIDER}, Model: ${PROVIDER === 'openai' ? OPENAI_MODEL : DEEPSEEK_MODEL}`);
});
