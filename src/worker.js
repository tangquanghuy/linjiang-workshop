import { ITEM_TYPES, normalizePackage } from './contracts.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const SESSION_DAYS = 30;
const ITEM_TYPE_SET = new Set(ITEM_TYPES);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === '/api/health') return json({ ok: true, project: 'linjiang-workshop', date: '2026-09-10' });
      if (!env.DB) return json({ ok: false, error: 'D1 binding DB is missing' }, 500);

      if (url.pathname === '/api/auth/config' && request.method === 'GET') {
        return json({ ok: true, clientId: env.DISCORD_CLIENT_ID || '', appName: env.APP_NAME || '临江创意工坊' });
      }
      if (url.pathname === '/api/auth/discord/start' && request.method === 'POST') return startDiscordAuth(request, env);
      if (url.pathname === '/api/auth/discord/callback' && request.method === 'GET') return finishDiscordAuth(request, env);
      if (url.pathname === '/api/auth/me' && request.method === 'GET') return authMe(request, env);
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') return logout(request, env);

      if (url.pathname === '/api/items' && request.method === 'GET') return listItems(request, env);
      if (url.pathname === '/api/items' && request.method === 'POST') return createItem(request, env);
      if (url.pathname === '/api/me/items' && request.method === 'GET') return listMyItems(request, env);
      if (url.pathname === '/api/me/wallet' && request.method === 'GET') return getWallet(request, env);
      if (url.pathname === '/api/me/claims' && request.method === 'POST') return claimTokens(request, env);

      const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)(?:\/(like|install|download))?$/);
      if (itemMatch) {
        const itemId = decodeURIComponent(itemMatch[1]);
        const action = itemMatch[2] || '';
        if (!action && request.method === 'GET') return getItem(request, env, itemId);
        if (!action && request.method === 'PUT') return updateItem(request, env, itemId);
        if (!action && request.method === 'DELETE') return deleteItem(request, env, itemId);
        if (action === 'like' && request.method === 'POST') return toggleLike(request, env, itemId);
        if (action === 'install' && request.method === 'POST') return recordInstall(request, env, itemId);
        if (action === 'download' && request.method === 'GET') return downloadItem(env, itemId);
      }

      return json({ ok: false, error: 'API route not found' }, 404);
    } catch (error) {
      console.error('[linjiang-workshop]', error);
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  },
};

async function startDiscordAuth(request, env) {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return json({ ok: false, error: 'Discord OAuth 尚未配置' }, 503);
  const body = await readJson(request);
  const requestOrigin = new URL(request.url).origin;
  const returnOrigin = safeOrigin(body.returnOrigin) || requestOrigin;
  const state = randomToken(24);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO oauth_states (state, return_origin, expires_at) VALUES (?, ?, ?)')
    .bind(state, returnOrigin, expiresAt).run();
  const redirectUri = `${requestOrigin}/api/auth/discord/callback`;
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify',
    state,
    prompt: 'consent',
  });
  return json({ ok: true, authorizeUrl: `https://discord.com/oauth2/authorize?${params}` });
}

async function finishDiscordAuth(request, env) {
  const url = new URL(request.url);
  const code = readText(url.searchParams.get('code'));
  const state = readText(url.searchParams.get('state'));
  const row = state ? await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ? LIMIT 1').bind(state).first() : null;
  if (!code || !row || Date.parse(row.expires_at) <= Date.now()) return authPopupHtml({ ok: false, error: '登录状态已过期' }, safeOrigin(row?.return_origin) || url.origin);
  await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();

  const redirectUri = `${url.origin}/api/auth/discord/callback`;
  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok) return authPopupHtml({ ok: false, error: `Discord token ${tokenResponse.status}` }, row.return_origin);
  const tokenData = await tokenResponse.json();
  const identityResponse = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { authorization: `Bearer ${tokenData.access_token}` },
  });
  if (!identityResponse.ok) return authPopupHtml({ ok: false, error: `Discord identity ${identityResponse.status}` }, row.return_origin);
  const identity = await identityResponse.json();
  const username = readText(identity.global_name || identity.username, 80) || 'Discord 用户';
  const avatarUrl = identity.avatar
    ? `https://cdn.discordapp.com/avatars/${identity.id}/${identity.avatar}.${String(identity.avatar).startsWith('a_') ? 'gif' : 'png'}?size=128`
    : '';
  await env.DB.prepare(`
    INSERT INTO users (discord_id, username, avatar_url, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, avatar_url = excluded.avatar_url, updated_at = CURRENT_TIMESTAMP
  `).bind(identity.id, username, avatarUrl).run();

  const sessionToken = randomToken(36);
  const tokenHash = await sha256(sessionToken);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_sessions WHERE discord_id = ? OR datetime(expires_at) <= CURRENT_TIMESTAMP').bind(identity.id),
    env.DB.prepare('INSERT INTO auth_sessions (token_hash, discord_id, expires_at) VALUES (?, ?, ?)').bind(tokenHash, identity.id, expiresAt),
  ]);
  return authPopupHtml({
    ok: true,
    sessionToken,
    expiresAt,
    user: { id: identity.id, username, avatarUrl },
  }, row.return_origin);
}

async function authMe(request, env) {
  const auth = await requireUser(request, env, false);
  if (!auth) return json({ ok: true, authenticated: false });
  return json({ ok: true, authenticated: true, user: mapUser(auth.user), expiresAt: auth.expiresAt });
}

async function logout(request, env) {
  const token = bearerToken(request);
  if (token) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  return json({ ok: true });
}

async function listItems(request, env) {
  const url = new URL(request.url);
  const type = readText(url.searchParams.get('type'), 30);
  const search = readText(url.searchParams.get('q'), 80).toLowerCase();
  const sort = readText(url.searchParams.get('sort'), 20);
  const auth = await requireUser(request, env, false);
  const clauses = ["i.status = 'published'"];
  const params = [];
  if (type && ITEM_TYPE_SET.has(type)) { clauses.push('i.item_type = ?'); params.push(type); }
  if (search) {
    clauses.push('(LOWER(i.title) LIKE ? OR LOWER(i.summary) LIKE ? OR LOWER(i.author_name) LIKE ?)');
    const term = `%${search}%`; params.push(term, term, term);
  }
  const order = sort === 'downloads' ? 'i.download_count DESC, i.updated_at DESC'
    : sort === 'likes' ? 'i.like_count DESC, i.updated_at DESC' : 'i.updated_at DESC';
  const viewer = auth?.user?.discord_id || '';
  const result = await env.DB.prepare(`
    SELECT i.*, CASE WHEN l.user_discord_id IS NULL THEN 0 ELSE 1 END AS liked
    FROM workshop_items i
    LEFT JOIN item_likes l ON l.item_id = i.id AND l.user_discord_id = ?
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${order}
    LIMIT 100
  `).bind(viewer, ...params).all();
  return json({ ok: true, items: (result.results || []).map(mapItemRow) });
}

async function listMyItems(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const result = await env.DB.prepare(`
    SELECT i.*, 0 AS liked FROM workshop_items i
    WHERE i.owner_discord_id = ? AND i.status != 'deleted'
    ORDER BY i.updated_at DESC
  `).bind(auth.user.discord_id).all();
  return json({ ok: true, items: (result.results || []).map(mapItemRow) });
}

async function getItem(request, env, itemId) {
  const auth = await requireUser(request, env, false);
  const row = await getItemRow(env.DB, itemId, auth?.user?.discord_id || '');
  if (!row || row.status !== 'published') return json({ ok: false, error: '作品不存在' }, 404);
  return json({ ok: true, item: mapItemRow(row) });
}

async function createItem(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  let pkg;
  try { pkg = normalizePackage(body, { authorName: auth.user.username }); }
  catch (error) { return json({ ok: false, error: error.message }, 400); }
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`
      INSERT INTO workshop_items (
        id, item_type, owner_discord_id, author_name, title, summary, tags_json, cover_url, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, pkg.itemType, auth.user.discord_id, pkg.authorName, pkg.title, pkg.summary,
      JSON.stringify(pkg.tags), pkg.coverUrl, JSON.stringify(pkg),
    ).run();
  } catch (error) {
    if (String(error).includes('UNIQUE')) return json({ ok: false, error: '你已经发布过同名作品' }, 409);
    throw error;
  }
  const row = await getItemRow(env.DB, id, auth.user.discord_id);
  return json({ ok: true, item: mapItemRow(row) }, 201);
}

async function updateItem(request, env, itemId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const existing = await env.DB.prepare('SELECT * FROM workshop_items WHERE id = ? LIMIT 1').bind(itemId).first();
  if (!existing || existing.status === 'deleted') return json({ ok: false, error: '作品不存在' }, 404);
  if (existing.owner_discord_id !== auth.user.discord_id) return json({ ok: false, error: '作品归属不匹配' }, 403);
  const body = await readJson(request);
  let pkg;
  try { pkg = normalizePackage({ ...body, itemType: existing.item_type }, { authorName: existing.author_name }); }
  catch (error) { return json({ ok: false, error: error.message }, 400); }
  await env.DB.prepare(`
    UPDATE workshop_items SET title = ?, summary = ?, tags_json = ?, cover_url = ?, payload_json = ?,
      content_version = content_version + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_discord_id = ?
  `).bind(pkg.title, pkg.summary, JSON.stringify(pkg.tags), pkg.coverUrl, JSON.stringify(pkg), itemId, auth.user.discord_id).run();
  const row = await getItemRow(env.DB, itemId, auth.user.discord_id);
  return json({ ok: true, item: mapItemRow(row) });
}

async function deleteItem(request, env, itemId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const result = await env.DB.prepare(`
    UPDATE workshop_items SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND owner_discord_id = ? AND status != 'deleted'
  `).bind(itemId, auth.user.discord_id).run();
  if (!Number(result.meta?.changes || 0)) return json({ ok: false, error: '作品不存在或归属不匹配' }, 404);
  return json({ ok: true });
}

async function toggleLike(request, env, itemId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const item = await env.DB.prepare("SELECT id FROM workshop_items WHERE id = ? AND status = 'published'").bind(itemId).first();
  if (!item) return json({ ok: false, error: '作品不存在' }, 404);
  const existing = await env.DB.prepare('SELECT 1 AS hit FROM item_likes WHERE item_id = ? AND user_discord_id = ?')
    .bind(itemId, auth.user.discord_id).first();
  if (existing) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM item_likes WHERE item_id = ? AND user_discord_id = ?').bind(itemId, auth.user.discord_id),
      env.DB.prepare('UPDATE workshop_items SET like_count = MAX(0, like_count - 1) WHERE id = ?').bind(itemId),
    ]);
  } else {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO item_likes (item_id, user_discord_id) VALUES (?, ?)').bind(itemId, auth.user.discord_id),
      env.DB.prepare('UPDATE workshop_items SET like_count = like_count + 1 WHERE id = ?').bind(itemId),
    ]);
  }
  const row = await getItemRow(env.DB, itemId, auth.user.discord_id);
  return json({ ok: true, liked: !existing, item: mapItemRow(row) });
}

async function recordInstall(request, env, itemId) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const item = await env.DB.prepare("SELECT * FROM workshop_items WHERE id = ? AND status = 'published'").bind(itemId).first();
  if (!item) return json({ ok: false, error: '作品不存在' }, 404);
  if (item.owner_discord_id === auth.user.discord_id) return json({ ok: true, counted: false, rewarded: false, reason: 'self_install' });
  const eventId = crypto.randomUUID();
  const insert = await env.DB.prepare(`
    INSERT OR IGNORE INTO install_events (id, item_id, item_version, installer_discord_id, rewarded)
    VALUES (?, ?, ?, ?, 1)
  `).bind(eventId, itemId, Number(item.content_version || 1), auth.user.discord_id).run();
  const counted = Number(insert.meta?.changes || 0) > 0;
  if (counted) {
    const ledgerId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('UPDATE workshop_items SET download_count = download_count + 1 WHERE id = ?').bind(itemId),
      env.DB.prepare('UPDATE users SET token_balance = token_balance + 1, token_earned_total = token_earned_total + 1 WHERE discord_id = ?').bind(item.owner_discord_id),
      env.DB.prepare(`INSERT OR IGNORE INTO token_ledger (id, discord_id, amount, reason, source_id) VALUES (?, ?, 1, 'qualified_install', ?)`)
        .bind(ledgerId, item.owner_discord_id, eventId),
    ]);
  }
  const row = await getItemRow(env.DB, itemId, auth.user.discord_id);
  return json({ ok: true, counted, rewarded: counted, item: mapItemRow(row) });
}

async function downloadItem(env, itemId) {
  const row = await env.DB.prepare("SELECT * FROM workshop_items WHERE id = ? AND status = 'published'").bind(itemId).first();
  if (!row) return json({ ok: false, error: '作品不存在' }, 404);
  const pkg = safeJson(row.payload_json, {});
  pkg.authorName = row.author_name;
  pkg.workshop = { itemId: row.id, contentVersion: Number(row.content_version || 1) };
  const filename = `${sanitizeFilename(row.title)}-${row.item_type}.json`;
  return new Response(JSON.stringify(pkg, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

async function getWallet(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const claims = await env.DB.prepare('SELECT id, amount, signature, created_at FROM token_claims WHERE discord_id = ? ORDER BY created_at DESC LIMIT 20')
    .bind(auth.user.discord_id).all();
  return json({ ok: true, wallet: {
    available: Number(auth.user.token_balance || 0),
    earnedTotal: Number(auth.user.token_earned_total || 0),
    claims: claims.results || [],
  } });
}

async function claimTokens(request, env) {
  const auth = await requireUser(request, env);
  if (auth.response) return auth.response;
  const body = await readJson(request);
  const current = await env.DB.prepare('SELECT token_balance FROM users WHERE discord_id = ?').bind(auth.user.discord_id).first();
  const available = Number(current?.token_balance || 0);
  const requested = body.amount == null ? available : Math.floor(Number(body.amount));
  if (!Number.isFinite(requested) || requested <= 0) return json({ ok: false, error: '当前没有可领取代币' }, 400);
  if (requested > available) return json({ ok: false, error: '领取数量超过云端余额' }, 409);
  const claimId = crypto.randomUUID();
  const issuedAt = new Date().toISOString();
  const receiptPayload = { claimId, userId: auth.user.discord_id, amount: requested, issuedAt, game: 'linjiang' };
  const signature = await hmacHex(env.CLAIM_SECRET || env.SESSION_SECRET || 'linjiang-dev-claim', JSON.stringify(receiptPayload));
  const results = await env.DB.batch([
    env.DB.prepare('UPDATE users SET token_balance = token_balance - ? WHERE discord_id = ? AND token_balance >= ?')
      .bind(requested, auth.user.discord_id, requested),
    env.DB.prepare('INSERT INTO token_claims (id, discord_id, amount, signature, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(claimId, auth.user.discord_id, requested, signature, issuedAt),
  ]);
  if (!Number(results[0]?.meta?.changes || 0)) {
    await env.DB.prepare('DELETE FROM token_claims WHERE id = ?').bind(claimId).run();
    return json({ ok: false, error: '云端余额刚刚发生变化，请刷新后重试' }, 409);
  }
  return json({ ok: true, claim: { ...receiptPayload, signature }, available: available - requested });
}

async function getItemRow(db, itemId, viewerId = '') {
  return db.prepare(`
    SELECT i.*, CASE WHEN l.user_discord_id IS NULL THEN 0 ELSE 1 END AS liked
    FROM workshop_items i
    LEFT JOIN item_likes l ON l.item_id = i.id AND l.user_discord_id = ?
    WHERE i.id = ? LIMIT 1
  `).bind(viewerId, itemId).first();
}

function mapItemRow(row) {
  const pkg = safeJson(row.payload_json, {});
  pkg.authorName = row.author_name;
  return {
    id: row.id,
    itemType: row.item_type,
    ownerId: row.owner_discord_id,
    authorName: row.author_name,
    title: row.title,
    summary: row.summary || '',
    tags: safeJson(row.tags_json, []),
    coverUrl: row.cover_url || '',
    package: pkg,
    schemaVersion: Number(row.schema_version || 1),
    contentVersion: Number(row.content_version || 1),
    likeCount: Number(row.like_count || 0),
    downloadCount: Number(row.download_count || 0),
    liked: Boolean(Number(row.liked || 0)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUser(row) {
  return {
    id: row.discord_id,
    username: row.username,
    avatarUrl: row.avatar_url || '',
    tokenBalance: Number(row.token_balance || 0),
    tokenEarnedTotal: Number(row.token_earned_total || 0),
  };
}

async function requireUser(request, env, required = true) {
  const token = bearerToken(request);
  if (!token) return required ? { response: json({ ok: false, error: '请先登录 Discord' }, 401) } : null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT s.expires_at, u.* FROM auth_sessions s
    JOIN users u ON u.discord_id = s.discord_id
    WHERE s.token_hash = ? AND datetime(s.expires_at) > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(tokenHash).first();
  if (!row) return required ? { response: json({ ok: false, error: '登录已过期' }, 401) } : null;
  return { user: row, expiresAt: row.expires_at, tokenHash };
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function authPopupHtml(payload, targetOrigin) {
  const safePayload = JSON.stringify({ channel: 'linjiang-workshop:auth', ...payload }).replace(/</g, '\\u003c');
  // The OAuth popup may be opened by the Tavern host for a nested workshop iframe.
  // Receivers validate source and origin before forwarding the session payload.
  const safeTarget = JSON.stringify('*');
  return new Response(`<!doctype html><meta charset="utf-8"><title>临江创意工坊登录</title><style>body{font-family:system-ui;background:#0b1020;color:#eef3ff;display:grid;place-items:center;min-height:100vh;margin:0}main{padding:28px;border:1px solid #34405f;border-radius:18px;background:#151c31}small{color:#aab5d0}</style><main><b>${payload.ok ? '登录完成' : '登录遇到问题'}</b><br><small>${escapeHtml(payload.error || '窗口将自动关闭')}</small></main><script>if(window.opener){window.opener.postMessage(${safePayload},${safeTarget});setTimeout(()=>window.close(),180)}<\/script>`, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function readText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function safeJson(value, fallback) {
  try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; }
}

function safeOrigin(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url.origin : '';
  } catch { return ''; }
}

function sanitizeFilename(value) {
  return String(value || 'linjiang-workshop').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100);
}

function randomToken(bytes = 32) {
  const array = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(String(value)));
  return [...new Uint8Array(signature)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function corsHeaders(request) {
  return {
    'access-control-allow-origin': new URL(request.url).origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
  };
}
