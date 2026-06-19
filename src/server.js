'use strict';

/**
 * Zero-dependency HTTP server + tiny router for the Job Card System.
 * Run with:  node src/server.js   (then open http://localhost:3000)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const querystring = require('querystring');

const db = require('./db');
const { seed } = require('./seed');
const auth = require('./auth');
const domain = require('./domain');
const views = require('./views');
const notify = require('./notifications');
const c = require('./controllers');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// --- routing ---------------------------------------------------------------
function compile(pattern) {
  const names = [];
  const rx = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { rx: new RegExp(`^${rx}$`), names };
}

const requireRoles = (roles) => (ctx) => domain.hasAnyRole(ctx.user, roles);

const R = domain.ROLES;
const routes = [
  ['GET', '/login', c.showLogin, { public: true }],
  ['POST', '/login', c.login, { public: true }],
  ['POST', '/logout', c.logout, { allowMustChange: true }],

  ['GET', '/account/password', c.showChangePassword, { allowMustChange: true }],
  ['POST', '/account/password', c.changePassword, { allowMustChange: true }],

  ['GET', '/', c.home],
  ['GET', '/jobcards', c.listJobs],
  ['GET', '/jobcards/new', c.newJob],
  ['POST', '/jobcards', c.createJob],
  ['GET', '/jobcards/:id', c.showJob],
  ['GET', '/jobcards/:id/edit', c.editJob],
  ['POST', '/jobcards/:id/update', c.updateJob],
  ['POST', '/jobcards/:id/action', c.doAction],
  ['GET', '/jobcards/:id/print', c.printJob],

  ['GET', '/workshop', c.workshop, { guard: requireRoles([R.TECHNICIAN, R.TRANSPORT_MANAGER, R.OPERATIONAL_MANAGER, R.ADMIN]) }],

  ['GET', '/notifications', c.listNotifs],
  ['POST', '/notifications/read-all', c.readAllNotifs],

  ['GET', '/outbox', c.listOutbox],
  ['GET', '/outbox/:id', c.showMail],

  ['GET', '/reports', c.reports, { guard: requireRoles([R.TRANSPORT_MANAGER, R.MECH_ENGINEER, R.OPERATIONAL_MANAGER, R.ADMIN]) }],

  ['GET', '/admin', c.adminHome, { guard: requireRoles([R.ADMIN]) }],
  ['POST', '/admin/users', c.addUser, { guard: requireRoles([R.ADMIN]) }],
  ['POST', '/admin/users/:id/reset-password', c.resetPassword, { guard: requireRoles([R.ADMIN]) }],
  ['POST', '/admin/vehicles', c.addVehicle, { guard: requireRoles([R.ADMIN]) }],
  ['POST', '/admin/vendors', c.addVendor, { guard: requireRoles([R.ADMIN]) }],
  ['POST', '/admin/projects', c.addProject, { guard: requireRoles([R.ADMIN]) }],
].map(([method, pattern, handler, opts = {}]) => ({ method, handler, opts, ...compile(pattern) }));

// --- request body ----------------------------------------------------------
function readBody(req) {
  return new Promise((resolve) => {
    if (req.method !== 'POST' && req.method !== 'PUT') return resolve({});
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(querystring.parse(data)));
    req.on('error', () => resolve({}));
  });
}

// --- static files ----------------------------------------------------------
function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) return false;
  const ext = path.extname(full);
  const mime = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'max-age=300' });
  res.end(fs.readFileSync(full));
  return true;
}

// --- ctx helpers -----------------------------------------------------------
function buildCtx(req, res, params, query, body, user) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const ctx = {
    req, res, params, query, body, user,
    baseUrl: `${proto}://${req.headers.host || `localhost:${PORT}`}`,
    raw(html, status = 200) {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    },
    render(title, bodyHtml, status = 200) {
      const html = views.layout({
        title,
        user,
        body: bodyHtml,
        flash: auth.takeFlash(req),
        unread: user ? notify.unreadCount(user.id) : 0,
      });
      this.raw(html, status);
    },
    redirect(location) {
      res.writeHead(302, { Location: location });
      res.end();
    },
    flash(type, message) { auth.setFlash(req, type, message); },
    notFound(msg) { this.render('Not found', `<div class="panel"><h1>404</h1><p>${msg || 'Page not found.'}</p></div>`, 404); },
    forbidden(msg) { this.render('Not allowed', `<div class="panel"><h1>403</h1><p>${msg || 'You do not have access.'}</p></div>`, 403); },
  };
  return ctx;
}

// --- main handler ----------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && (pathname === '/styles.css' || pathname.startsWith('/static/'))) {
      const file = pathname === '/styles.css' ? 'styles.css' : pathname.replace('/static/', '');
      if (serveStatic(res, file)) return;
    }
    if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }

    const user = auth.loadUser(req);
    const body = await readBody(req);
    const query = Object.fromEntries(url.searchParams.entries());

    for (const route of routes) {
      if (route.method !== req.method) continue;
      const m = route.rx.exec(pathname);
      if (!m) continue;

      const params = {};
      route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      const ctx = buildCtx(req, res, params, query, body, user);

      if (!route.opts.public && !user) return ctx.redirect('/login');
      // Force users on a temporary password to set a new one before anything else.
      if (user && user.mustChangePassword && !route.opts.allowMustChange && !route.opts.public) {
        return ctx.redirect('/account/password');
      }
      if (route.opts.guard && !route.opts.guard(ctx)) return ctx.forbidden();
      return await route.handler(ctx);
    }

    // no route matched
    const ctx = buildCtx(req, res, {}, query, body, user);
    if (!user) return ctx.redirect('/login');
    return ctx.notFound();
  } catch (err) {
    console.error('Request error:', err);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>500 — Internal Server Error</h1><p>Something went wrong.</p>');
  }
});

// --- boot ------------------------------------------------------------------
db.load();
seed();
server.listen(PORT, () => {
  console.log(`\n  Job Card System running →  http://localhost:${PORT}`);
  console.log('  Demo logins (password: "password"): tofficer, tmanager, ame, me, omanager, tech, admin\n');
});

module.exports = server;
