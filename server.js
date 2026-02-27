// BCRYPT SETUP - Using bcryptjs to match your package.json exactly
const bcrypt = require('bcryptjs');
const saltRounds = 10;

// PORT SETUP - Critical for Hostinger/Passenger
// Passenger provides a socket/pipe path through process.env.PORT.
// If we hardcode 3000, the server cannot talk to the app, causing a 503.
const PORT = process.env.PORT || 3000;

// FILE UPLOAD SETUP
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

// Ensure necessary directories exist inside the /nodejs folder
const uploadDir = path.join(__dirname, 'public', 'images');
const tmpDir = path.join(__dirname, 'tmp');
[uploadDir, tmpDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Configure Multer
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const imageUpload = multer({ storage: imageStorage });
const excelImport = multer({ storage: multer.memoryStorage() });

// DATABASE SETUP
const MongoClient = require('mongodb-legacy').MongoClient;
const { ObjectId } = require('mongodb-legacy');

// Use the MONGODB_URI you set in the Hostinger Dashboard
const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const client = new MongoClient(url);
const dbname = 'stockplus';

// LOAD NPM PACKAGES
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const app = express();

// --- MIDDLEWARE SETUP ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'stockplus-emergency-key',
    resave: false,
    saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(flash());

app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.loggedin = req.session.loggedin;
    res.locals.currentuser = req.session.currentuser;
    res.locals.userType = req.session.accountType;
    next();
});

// --- SERVER & DB STARTUP ---
let db;

// 🚀 START SERVER IMMEDIATELY (This satisfies Hostinger's health check to stop the 503)
app.listen(PORT, () => {
    console.log(`✅ StockPlus live on Port: ${PORT}`);
    connectDB();
});

async function connectDB(){
    try {
        await client.connect();
        db = client.db(dbname);
        console.log('✅ Connected Successfully to MongoDB Atlas');
    } catch (err) {
        console.error('❌ Database Connection Error:', err.message);
    }
}

// =================================================================
// --- ROUTES ---
// =================================================================

app.get('/ping', (req, res) => res.send(`Server Alive! DB: ${db ? 'Connected' : 'Connecting...'}`));

app.get('/', (req, res) => res.render('pages/index'));

const LOW_STOCK_THRESHOLD = 5;

// DASHBOARD
app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedin) return res.redirect('/');
    if (!db) return res.status(503).send("Database connecting... refresh in 5 seconds.");
    try {
        const totalStock = await db.collection('stock').countDocuments();
        const totalDocuments = await db.collection('documents').countDocuments();
        const totalUsers = await db.collection('users').countDocuments();
        const lowStockItems = await db.collection('stock').find({ qty: { $lt: LOW_STOCK_THRESHOLD } }).toArray();

        res.render('pages/dashboard', {
            user: req.session.currentuser, totalStock, totalDocuments, totalUsers, lowStockItems, LOW_STOCK_THRESHOLD
        });
    } catch (err) { res.status(500).send("Dashboard Error"); }
});

// DOCUMENT LIST
app.get('/documents', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        const documents = await db.collection('documents').find().sort({ "published": -1 }).toArray();
        res.render('pages/documents', { documents });
    } catch (err) { res.status(500).send("Error fetching documents"); }
});

// STOCK LIST (WITH SEARCH & PAGINATION)
app.get('/document/:id/stock', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { id } = req.params;
    const itemsPerPage = 20;
    const selectedCategory = req.query.category || ''; 
    const searchQuery = req.query.searchQuery || '';
    const currentPage = parseInt(req.query.page) || 1;

    try {
        const document = await db.collection('documents').findOne({ _id: new ObjectId(id) });
        if (!document) return res.status(404).send("Document not found.");

        const filter = { documentId: id };
        if (selectedCategory) filter.category = selectedCategory;
        if (searchQuery) {
            filter.$or = [
                { productName: { $regex: searchQuery, $options: 'i' } },
                { productCode: { $regex: searchQuery, $options: 'i' } },
                { barcode: { $regex: searchQuery, $options: 'i' } }
            ];
        }

        const totalItems = await db.collection('stock').countDocuments(filter);
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        const stock = await db.collection('stock').find(filter).sort({ "published": -1 }).skip((currentPage - 1) * itemsPerPage).limit(itemsPerPage).toArray();

        res.render('pages/documentStock', { document, stock, selectedCategory, searchQuery, currentPage, totalPages });
    } catch (err) { res.status(500).send("Error fetching stock"); }
});

// LOGIN
app.post('/login', async (req, res) => {
    if (!db) return res.status(503).send("Not Ready");
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ "login.username": username });
    if (user && await bcrypt.compare(password, user.login.password)) {
        req.session.loggedin = true;
        req.session.currentuser = username;
        req.session.accountType = user.accountType;
        return res.redirect('/dashboard');
    }
    res.redirect('/');
});

// UPDATE STOCK (WITH IMAGE)
app.post('/updateStock', imageUpload.single('image'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { originalBarcode, documentId, currentPage, productName, productCode, Brand, Category, Qty, RRP, Price, Barcode } = req.body;
    const existing = await db.collection('stock').findOne({ barcode: originalBarcode });
    let imageUrl = existing ? existing.imageUrl : null;
    if (req.file) imageUrl = '/images/' + req.file.filename;

    await db.collection('stock').updateOne({ barcode: originalBarcode }, {
        $set: { productName, productCode, brand: Brand, category: Category, qty: parseInt(Qty) || 0, rrp: RRP, price: Price, barcode: Barcode, imageUrl }
    });
    res.redirect(`/document/${documentId}/stock?page=${currentPage || 1}#item-${Barcode}`);
});

// EXCEL IMPORT
app.post('/import-stock', excelImport.single('stockFile'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    const items = data.map(row => ({
        productName: row.productName, barcode: String(row.barcode), qty: parseInt(row.qty) || 0,
        documentId: req.body.documentId, published: new Date().toISOString()
    })).filter(i => i.productName && i.barcode);

    if (items.length > 0) await db.collection('stock').insertMany(items);
    res.redirect('/documents');
});

// LOGOUT
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// --- CRON JOB ---
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com", port: 465, secure: true,
    auth: { user: 'info@stockplus.abzdigitalgroup.com', pass: 'jtdhJ35j26Mfg?2' }
});

cron.schedule('0 9 * * *', async () => {
    if (!db) return;
    const low = await db.collection('stock').find({ qty: { $lt: LOW_STOCK_THRESHOLD } }).toArray();
    if (low.length > 0) {
        await transporter.sendMail({
            from: '"StockPlus" <info@stockplus.abzdigitalgroup.com>',
            to: 'stuspam2025@gmail.com',
            subject: 'Low Stock Alert',
            html: `<ul>${low.map(i => `<li>${i.productName}: ${i.qty}</li>`).join('')}</ul>`
        });
    }
}, { timezone: "Europe/London" });