#!/usr/bin/env node
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_IDS = [Number(process.env.TELEGRAM_CHAT_ID || 0)];
const STATE_FILE = '/tmp/tg-bridge-offset.json';
const LOCK_FILE = '/tmp/tg-bridge-processing.lock';
const LOG_FILE = '/tmp/tg-bridge.log';
const fs = require('fs');
const { execSync } = require('child_process');

function log(m) {
  const t = new Date().toISOString();
  try { fs.appendFileSync(LOG_FILE, `[${t}] ${m}\n`); } catch(e) {}
}

let offset = 0;
try { offset = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')).offset || 0; } catch (e) {}

function fetchJson(url) {
  const out = execSync(`curl -s --max-time 8 "${url}"`, {
    timeout: 15000, encoding: 'utf-8', maxBuffer: 1024*1024
  });
  return JSON.parse(out);
}

function sendTelegram(chatId, text) {
  try {
    const data = JSON.stringify({ chat_id: chatId, text });
    execSync(`curl -s -X POST -H "Content-Type: application/json" -d ${JSON.stringify(data)} "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage"`, {
      timeout: 10000, encoding: 'utf-8', maxBuffer: 1024*1024
    });
  } catch(e) { log(`send error: ${e.message}`); }
}

function callClaude(prompt) {
  try {
    const out = execSync(`claude -p ${JSON.stringify(prompt)} --print --dangerously-skip-permissions`, {
      timeout: 120000, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024
    });
    return out.trim();
  } catch(e) {
    const stderr = e.stderr ? e.stderr.toString().trim().slice(0, 500) : '';
    const stdout = e.stdout ? e.stdout.toString().trim().slice(0, 500) : '';
    throw new Error(`exit=${e.status} stdout=${stdout} stderr=${stderr}`);
  }
}

function poll() {
  try {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${offset + 1}&timeout=0`;
    const data = fetchJson(url);

    if (!data.ok) { setTimeout(poll, 3000); return; }
    const updates = data.result || [];
    let maxId = offset;

    for (const u of updates) {
      if (u.update_id > maxId) maxId = u.update_id;
      const msg = u.message || {};
      const chat = msg.chat || {};
      const text = (msg.text || '').trim();
      const chatId = chat.id;
      const firstName = chat.first_name || '';

      if (!text || !chatId) continue;
      if (!ALLOWED_IDS.includes(chatId)) { log(`blocked: ${chatId}`); continue; }

      if (!fs.existsSync(LOCK_FILE)) {
        try {
          fs.writeFileSync(LOCK_FILE, String(process.pid));
          log(`MSG from ${firstName}: ${text.slice(0, 100)}`);
          const reply = callClaude(
            `You are an assistant Claude Code. The user sent a message via Telegram.\n\nUser: ${text}\n\nPlease reply directly in Chinese, keep it concise.`
          );
          log(`REPLY: ${reply.slice(0, 200)}`);
          sendTelegram(chatId, reply);
        } catch(e) {
          log(`error: ${e.message}`);
          sendTelegram(chatId, `Error: ${e.message.slice(0, 100)}`);
        } finally {
          try { fs.unlinkSync(LOCK_FILE); } catch(ee) {}
        }
      } else {
        log(`busy, skipped: ${text.slice(0, 50)}`);
      }
    }

    offset = maxId;
    try { fs.writeFileSync(STATE_FILE, JSON.stringify({ offset })); } catch(e) {}
  } catch(e) {
    log(`poll error: ${e.message}`);
  }
  setTimeout(poll, 2000);
}

log('=== bridge started ===');
poll();
