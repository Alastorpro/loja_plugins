require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');

const { initData, purgeExpiredSuggestions } = require('./data/store');
const db = require('./data/db');
const { initCompiler } = require('./services/compiler');
const { initMercadoPago } = require('./services/mercadopago');

const app = express();

// ===== Configurações globais =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.locals.app = {
  name: process.env.SITE_NAME || '[DEV] Alastor - Vendas e criador de plugin',
  url: process.env.APP_URL || 'http://localhost:3000'
};

// ===== Inicialização =====
// (Tudo de middleware/rotas é registrado aqui, DEPOIS do banco e das sessões estarem prontos)
async function start() {
  await initData();

  // Sessões: persistidas no PostgreSQL sempre que houver banco (some o aviso do MemoryStore
  // e o login sobrevive a restart/deploy). Sem banco, usa o MemoryStore padrão.
  const sessionStore = db.getPool()
    ? new pgSession({ pool: db.getPool(), tableName: 'session', createTableIfMissing: true })
    : undefined;
  app.use(session({
    secret: process.env.SESSION_SECRET || 'cs16-shop-secret',
    resave: false,
    saveUninitialized: true,
    store: sessionStore,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
  }));
  if (sessionStore) console.log('[Sessão] Sessões armazenadas no PostgreSQL (connect-pg-simple).');

  // ===== Rotas =====
  app.use('/', require('./routes/public'));
  app.use('/checkout', require('./routes/checkout'));
  app.use('/api', require('./routes/api'));
  app.use('/admin', require('./routes/admin'));

  // Erros
  app.use((req, res) => res.status(404).render('404'));
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).render('500');
  });

  initCompiler();
  initMercadoPago();
  // Sugestões não lidas expiram após 24h
  await purgeExpiredSuggestions();
  setInterval(() => { purgeExpiredSuggestions().catch(() => {}); }, 60 * 60 * 1000);
  app.listen(process.env.PORT || 3000, () => {
    console.log(`Servidor rodando em ${process.env.APP_URL || 'http://localhost:3000'}`);
  });
}

start();
