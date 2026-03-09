const express = require('express');
const multer  = require('multer');
const session = require('express-session');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// DATA_DIR ve UPLOADS_DIR: Railway'de volume mount noktasına yönlendirilebilir
// Örnek: DATA_DIR=/data/turgut/data  UPLOADS_DIR=/data/turgut/uploads
const DATA_DIR    = process.env.DATA_DIR    || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');

// ── Dizinleri Oluştur ─────────────────────────────────────────────────────────
[
  path.join(UPLOADS_DIR, 'haberler'),
  path.join(UPLOADS_DIR, 'oduller'),
  DATA_DIR
].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname), { index: 'index.html' }));
app.use('/uploads', express.static(UPLOADS_DIR));

// Kök route açıkça tanımla
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'turgut-torunogullari-gizli-anahtar-2025',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Multer (Resim Yükleme) ────────────────────────────────────────────────────
function makeUpload(subdir) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(UPLOADS_DIR, subdir)),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
  });
  return multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (file.mimetype.startsWith('image/')) return cb(null, true);
      cb(Object.assign(new Error('Sadece resim dosyaları kabul edilir.'), { status: 400 }));
    }
  });
}

const uploadHaber = makeUpload('haberler');
const uploadOdul  = makeUpload('oduller');

// ── Veri Yardımcıları ─────────────────────────────────────────────────────────
const readData = (file) => {
  const filePath = path.join(DATA_DIR, file);
  try {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return [];
  }
};

const writeData = (file, data) => {
  fs.writeFileSync(
    path.join(DATA_DIR, file),
    JSON.stringify(data, null, 2),
    'utf8'
  );
};

// ── Admin Kimlik Bilgileri ────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'turgut2025';

// ── Auth Middleware ───────────────────────────────────────────────────────────
const requireAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen giriş yapın.' });
};

// ── Auth Routes ───────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Hatalı kullanıcı adı veya şifre.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// ── Haberler API ──────────────────────────────────────────────────────────────
app.get('/api/haberler', (req, res) => {
  res.json(readData('news.json'));
});

app.get('/api/haberler/:id', (req, res) => {
  const item = readData('news.json').find(n => n.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Haber bulunamadı.' });
  res.json(item);
});

app.post('/api/haberler', requireAdmin, uploadHaber.single('image'), (req, res) => {
  const news = readData('news.json');
  const newItem = {
    id: Date.now().toString(),
    title:    req.body.title    || '',
    category: req.body.category || 'Genel',
    date:     req.body.date     || new Date().toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' }),
    summary:  req.body.summary  || '',
    content:  req.body.content  || '',
    image:    req.file ? '/uploads/haberler/' + req.file.filename : (req.body.imageUrl || ''),
    createdAt: new Date().toISOString()
  };
  news.unshift(newItem);
  writeData('news.json', news);
  res.json(newItem);
});

app.put('/api/haberler/:id', requireAdmin, uploadHaber.single('image'), (req, res) => {
  const news = readData('news.json');
  const idx = news.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Haber bulunamadı.' });
  news[idx] = {
    ...news[idx],
    title:    req.body.title    || news[idx].title,
    category: req.body.category || news[idx].category,
    date:     req.body.date     || news[idx].date,
    summary:  req.body.summary  || news[idx].summary,
    content:  req.body.content  || news[idx].content,
    image:    req.file ? '/uploads/haberler/' + req.file.filename : (req.body.imageUrl || news[idx].image),
    updatedAt: new Date().toISOString()
  };
  writeData('news.json', news);
  res.json(news[idx]);
});

app.delete('/api/haberler/:id', requireAdmin, (req, res) => {
  const news = readData('news.json').filter(n => n.id !== req.params.id);
  writeData('news.json', news);
  res.json({ success: true });
});

// ── Ödüller API ───────────────────────────────────────────────────────────────
app.get('/api/oduller', (req, res) => {
  res.json(readData('awards.json'));
});

app.post('/api/oduller', requireAdmin, uploadOdul.single('image'), (req, res) => {
  const awards = readData('awards.json');
  const newItem = {
    id: Date.now().toString(),
    title:       req.body.title       || '',
    description: req.body.description || '',
    year:        req.body.year        || new Date().getFullYear().toString(),
    image:       req.file ? '/uploads/oduller/' + req.file.filename : (req.body.imageUrl || ''),
    createdAt: new Date().toISOString()
  };
  awards.unshift(newItem);
  writeData('awards.json', awards);
  res.json(newItem);
});

app.put('/api/oduller/:id', requireAdmin, uploadOdul.single('image'), (req, res) => {
  const awards = readData('awards.json');
  const idx = awards.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Ödül bulunamadı.' });
  awards[idx] = {
    ...awards[idx],
    title:       req.body.title       || awards[idx].title,
    description: req.body.description || awards[idx].description,
    year:        req.body.year        || awards[idx].year,
    image:       req.file ? '/uploads/oduller/' + req.file.filename : (req.body.imageUrl || awards[idx].image),
    updatedAt: new Date().toISOString()
  };
  writeData('awards.json', awards);
  res.json(awards[idx]);
});

app.delete('/api/oduller/:id', requireAdmin, (req, res) => {
  const awards = readData('awards.json').filter(a => a.id !== req.params.id);
  writeData('awards.json', awards);
  res.json({ success: true });
});

// ── İletişim API ──────────────────────────────────────────────────────────────
app.post('/api/iletisim', (req, res) => {
  const contacts = readData('contacts.json');
  contacts.unshift({
    id:        Date.now().toString(),
    name:      req.body.name    || '',
    email:     req.body.email   || '',
    message:   req.body.message || '',
    createdAt: new Date().toISOString(),
    read:      false
  });
  writeData('contacts.json', contacts);
  res.json({ success: true, message: 'Mesajınız başarıyla iletildi.' });
});

app.get('/api/iletisim', requireAdmin, (req, res) => {
  res.json(readData('contacts.json'));
});

app.put('/api/iletisim/:id/read', requireAdmin, (req, res) => {
  const contacts = readData('contacts.json');
  const idx = contacts.findIndex(c => c.id === req.params.id);
  if (idx !== -1) { contacts[idx].read = true; writeData('contacts.json', contacts); }
  res.json({ success: true });
});

app.delete('/api/iletisim/:id', requireAdmin, (req, res) => {
  const contacts = readData('contacts.json').filter(c => c.id !== req.params.id);
  writeData('contacts.json', contacts);
  res.json({ success: true });
});

// ── Server Başlat ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n════════════════════════════════════════════════');
  console.log('   Turgut Torunoğulları Web Sitesi Aktif ');
  console.log('════════════════════════════════════════════════');
  console.log(`  Site:         http://localhost:${PORT}`);
  console.log(`  Admin Paneli: http://localhost:${PORT}/admin.html`);
  console.log(`  Kullanıcı:    ${ADMIN_USER}`);
  console.log(`  Şifre:        ${ADMIN_PASS}`);
  console.log('════════════════════════════════════════════════\n');
  console.log('  ADMIN_USER ve ADMIN_PASS ortam değişkenleri');
  console.log('  ile kimlik bilgilerini özelleştirebilirsiniz.\n');
});
