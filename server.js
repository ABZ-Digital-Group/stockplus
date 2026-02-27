/**
 * STOCKPLUS FINAL PRODUCTION SERVER
 * Compatible with Hostinger Shared/Cloud Node.js Environment
 */

// 1. LIBRARY IMPORTS
const bcrypt = require('bcryptjs'); // Matches package.json
const saltRounds = 10;
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const { MongoClient, ObjectId } = require('mongodb-legacy');

const app = express();

// 2. PORT SETUP
// Hostinger/Passenger provides a dynamic port or socket via process.env.PORT.
const PORT = process.env.PORT || 3000;

// 3. DIRECTORY & FILE UPLOAD SETUP
// Ensure critical folders exist within the /nodejs directory
const requiredDirs = [
    path.join(__dirname, 'public', 'images'),
    path.join(__dirname, 'tmp')
];
requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (e) {
            console.error('Directory creation failed:', e.message);
        }
    }
});

// Configure Multer for Images
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const imageUpload = multer({ storage: imageStorage });

// Configure Multer for Excel (Memory)
const excelImport = multer({ storage: multer.memoryStorage() });

// 4. MIDDLEWARE
app.use(session({
    secret: process.env.SESSION_SECRET || 'stockplus-prod-secret',
    resave: false,
    saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(flash());

// Pass session/flash data to all templates
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.loggedin = req.session.loggedin;
    res.locals.currentuser = req.session.currentuser;
    res.locals.userType = req.session.accountType;
    next();
});

// 5. DATABASE & SERVER STARTUP
let db = null;
const dbname = 'stockplus';

// 🚀 CRITICAL: Start listening immediately to prevent Hostinger 503 Timeout
app.listen(PORT, () => {
    console.log(`✅ StockPlus web server active on Port: ${PORT}`);
    connectDB();
});

async function connectDB() {
    const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
    try {
        const client = new MongoClient(url);
        await client.connect();
        db = client.db(dbname);
        console.log('✅ Connected successfully to MongoDB Atlas');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
}

// =================================================================
// --- ROUTES ---
// =================================================================

// Health Check
app.get('/ping', (req, res) => {
    res.send(`Alive! DB: ${db !== null ? 'Connected' : 'Connecting...'}`);
});

// Index
app.get('/', (req, res) => res.render('pages/index'));

const LOW_STOCK_THRESHOLD = 5;

// Dashboard
app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedin) return res.redirect('/');
    if (!db) return res.status(503).send("Connecting to DB... Refresh in 5 seconds.");
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

// Documents List
app.get('/documents', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        const docs = await db.collection('documents').find().sort({ "published": -1 }).toArray();
        res.render('pages/documents', { documents: docs });
    } catch (err) { res.status(500).send("Documents Error"); }
});

// Stock List (Search, Pagination, and Category Filters)
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
        const stock = await db.collection('stock').find(filter)
            .sort({ "published": -1 })
            .skip((currentPage - 1) * itemsPerPage)
            .limit(itemsPerPage)
            .toArray();

        res.render('pages/documentStock', { document, stock, selectedCategory, searchQuery, currentPage, totalPages });
    } catch (err) { res.status(500).send("Stock Error"); }
});

// Login POST
app.post('/login', async (req, res) => {
    if (!db) return res.status(503).send("DB Connecting...");
    const { username, password } = req.body;
    const user = await db.collection('users').findOne({ "login.username": username });
    if (user && await bcrypt.compare(password, user.login.password)) {
        req.session.loggedin = true;
        req.session.currentuser = username;
        req.session.accountType = user.accountType;
        return res.redirect('/dashboard');
    }
    req.flash('error_msg', 'Invalid credentials');
    res.redirect('/');
});

// Update Stock with Image Support
app.post('/updateStock', imageUpload.single('image'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { originalBarcode, documentId, currentPage, productName, productCode, Brand, Category, Qty, RRP, Price, Barcode } = req.body;
    try {
        const existing = await db.collection('stock').findOne({ barcode: originalBarcode });
        let imageUrl = existing ? existing.imageUrl : null;
        if (req.file) imageUrl = '/images/' + req.file.filename;

        await db.collection('stock').updateOne({ barcode: originalBarcode }, {
            $set: { 
                productName, productCode, brand: Brand, category: Category, 
                qty: parseInt(Qty, 10) || 0, rrp: RRP, price: Price, 
                barcode: Barcode, imageUrl,
                productURL: "/product/" + Barcode, deleteURL: "/delete/" + Barcode
            }
        });
        req.flash('success_msg', 'Item updated');
        res.redirect(`/document/${documentId}/stock?page=${currentPage || 1}#item-${Barcode}`);
    } catch (err) { res.redirect(`/document/${documentId}/stock`); }
});

// Excel Import POST
app.post('/import-stock', excelImport.single('stockFile'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const items = data.map(row => {
            if (!row.productName || !row.barcode) return null;
            return {
                productName: row.productName, barcode: String(row.barcode), 
                productCode: row.productCode || '', brand: row.brand || '', 
                category: row.category || 'Misc', qty: parseInt(row.qty, 10) || 0, 
                rrp: String(row.rrp || '0.00'), price: String(row.price || '0.00'),
                documentId: req.body.documentId, published: new Date().toISOString().slice(0, 19)
            };
        }).filter(i => i !== null);

        if (items.length > 0) await db.collection('stock').insertMany(items);
        req.flash('success_msg', `Imported ${items.length} items`);
        res.redirect('/documents');
    } catch (err) { req.flash('error_msg', 'Import failed'); res.redirect('/documents'); }
});

// View Selected
app.post('/selected', async (req, res) => {
    const { selectedBarcodes, documentId } = req.body;
    if (!selectedBarcodes) return res.redirect('/documents');
    const barcodes = Array.isArray(selectedBarcodes) ? selectedBarcodes : [selectedBarcodes];
    try {
        const selectedItems = await db.collection('stock').find({ barcode: { $in: barcodes } }).toArray();
        let document = null;
        if (documentId && ObjectId.isValid(documentId)) {
            document = await db.collection('documents').findOne({ _id: new ObjectId(documentId) });
        }
        res.render('pages/selectedStock', { selectedItems, document });
    } catch (err) { res.status(500).send("Selection Error"); }
});

// Logout
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// 6. AUTOMATED CRON JOB
const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com", port: 465, secure: true,
    auth: { user: 'info@stockplus.abzdigitalgroup.com', pass: 'jtdhJ35j26Mfg?2' }
});

cron.schedule('0 9 * * *', async () => {
    if (!db) return;
    const items = await db.collection('stock').find({ qty: { $lt: LOW_STOCK_THRESHOLD } }).toArray();
    if (items.length > 0) {
        const html = `<ul>${items.map(i => `<li>${i.productName}: ${i.qty}</li>`).join('')}</ul>`;
        await transporter.sendMail({
            from: '"StockPlus" <info@stockplus.abzdigitalgroup.com>',
            to: 'stuspam2025@gmail.com',
            subject: 'Low Stock Alert',
            html: html
        });
    }
}, { timezone: "Europe/London" });

// Fatal Error Catch-all
process.on('uncaughtException', (err) => console.error('🔥 FATAL:', err));