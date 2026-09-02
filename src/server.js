require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');

const { initData, purgeExpiredSuggestions } = require('./data/store');
const { initCompiler } = require('./services/compiler');
const { initMercadoPago } = require('./services/mercadopago');

const app = express();

// ===== Configurações globais =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'cs16-shop-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.locals.app = {
  name: process.env.SITE_NAME || '[DEV] Alastor - Vendas e criador de plugin',
  url: process.env.APP_URL || 'http://localhost:3000'
};

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

// ===== Inicialização =====
async function start() {
  await initData();
  initCompiler();
  initMercadoPago();
  // Sugestões não lidas expiram após 24h
  purgeExpiredSuggestions();
  setInterval(() => purgeExpiredSuggestions(), 60 * 60 * 1000);
  app.listen(process.env.PORT || 3000, () => {
    console.log(`Servidor rodando em ${process.env.APP_URL || 'http://localhost:3000'}`);
  });
}

start();
