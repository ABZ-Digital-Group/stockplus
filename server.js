/**
 * STOCKPLUS - COMPLETE PRODUCTION SERVER
 * Features: Auth, User Mgmt, Dashboard, Document Mgmt, Paginated/Filtered Stock, 
 * Image Uploads, Excel Import, POS API, and Automated Daily Alerts.
 * Optimized for Hostinger.
 */

const bcrypt = require('bcryptjs'); 
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
const PORT = process.env.PORT || 3000;
const dbname = 'stockplus';

// --- 1. DIRECTORY SETUP ---
const requiredDirs = [
    path.join(__dirname, 'public', 'images'),
    path.join(__dirname, 'tmp')
];
requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { console.error('Folder check error:', e.message); }
    }
});

// --- 2. MULTER CONFIGURATION ---
const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const imageUpload = multer({ storage: imageStorage });
const excelImport = multer({ storage: multer.memoryStorage() });

// --- 3. MIDDLEWARE ---
app.use(session({
    secret: process.env.SESSION_SECRET || 'stockplus-prod-secret-key',
    resave: false,
    saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(flash());

// Pass variables to all EJS templates
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.loggedin = req.session.loggedin;
    res.locals.currentuser = req.session.currentuser;
    res.locals.userType = req.session.accountType;
    next();
});

// --- 4. DATABASE CONNECTION ---
let db = null;
let connectionError = null;
let connectionStatus = "Disconnected";

// 🚀 Ready-First Strategy: Listen immediately to pass Hostinger health checks
app.listen(PORT, () => {
    console.log(`✅ StockPlus listening on Port: ${PORT}`);
    connectDB();
});

async function connectDB() {
    const fallbackURI = "mongodb+srv://stuartiek_db_user:Zwq6xp7NR3Ho2W1W@cluster0.blmfv8d.mongodb.net/stockplus?retryWrites=true&w=majority";
    let url = process.env.MONGODB_URI || fallbackURI;

    try {
        connectionStatus = "Connecting...";
        const client = new MongoClient(url, { 
            connectTimeoutMS: 15000, 
            serverSelectionTimeoutMS: 15000,
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        await client.connect();
        db = client.db(dbname);
        connectionError = null;
        connectionStatus = "Connected";
        console.log('✅ Connected Successfully to MongoDB Atlas');
    } catch (err) {
        connectionStatus = "Error";
        connectionError = `Atlas Connection Failed: ${err.message}`;
        console.error('❌ MongoDB Connection Error:', err.message);
    }
}

// =================================================================
// --- AUTH & SYSTEM ROUTES ---
// =================================================================

app.get('/ping', (req, res) => {
    res.send(`<h1>System Diagnostic</h1><p><b>DB Status:</b> ${connectionStatus}</p><p><b>DB Connected:</b> ${db !== null}</p><p><b>Error Details:</b> <span style="color:red">${connectionError || 'None'}</span></p>`);
});

app.get('/', (req, res) => res.render('pages/index'));

app.get('/setup-admin', async (req, res) => {
    if (!db) return res.send(`DB not connected. Status: ${connectionStatus}`);
    const pass = "&99398V4oa&";
    try {
        const hash = await bcrypt.hash(pass, 10);
        await db.collection('users').updateOne(
            { "login.username": "stuartiek" },
            { $set: { 
                "email": "stuartiek@gmail.com",
                "login": { "username": "stuartiek", "password": hash },
                "accountType": "Admin",
                "created": new Date().toISOString()
            }},
            { upsert: true }
        );
        res.send(`✅ Admin 'stuartiek' created/reset successfully.`);
    } catch (e) { res.status(500).send("Error: " + e.message); }
});

app.post('/login', async (req, res) => {
    if (!db) return res.status(503).send("Database connecting...");
    const { username, password } = req.body;
    try {
        const user = await db.collection('users').findOne({ "login.username": username });
        if (user && await bcrypt.compare(password, user.login.password)) {
            req.session.loggedin = true;
            req.session.currentuser = username;
            req.session.accountType = user.accountType;
            return res.redirect('/dashboard');
        }
        req.flash('error_msg', 'Invalid credentials');
        res.redirect('/');
    } catch (err) { res.redirect('/'); }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// --- USER MANAGEMENT ROUTES ---

app.get('/users', async (req, res) => {
    if (!req.session.loggedin || req.session.accountType !== 'Admin') {
        req.flash('error_msg', 'Access denied. Admins only.');
        return res.redirect('/dashboard');
    }
    if (!db) return res.status(503).send("Database connecting...");
    try {
        const users = await db.collection('users').find().sort({ "created": -1 }).toArray();
        res.render('pages/users', { page: 'users', users });
    } catch (err) {
        console.error("❌ Error fetching users:", err);
        res.status(500).send("Error fetching users");
    }
});

app.post('/signUp', async (req, res) => {
    if (!req.session.loggedin || req.session.accountType !== 'Admin') {
        return res.redirect('/');
    }
    const { email, uname, psw, accountType } = req.body;
    try {
        const existingUser = await db.collection('users').findOne({ "login.username": uname });
        if (existingUser) {
            req.flash('error_msg', 'User already exists.');
            return res.redirect('/users');
        }
        const hash = await bcrypt.hash(psw, 10);
        await db.collection('users').insertOne({
            email,
            login: { username: uname, password: hash },
            accountType,
            created: new Date().toISOString().slice(0, 19)
        });
        req.flash('success_msg', 'User created successfully.');
        res.redirect('/users');
    } catch (err) {
        console.error("❌ Error creating user:", err);
        req.flash('error_msg', 'Error creating user.');
        res.redirect('/users');
    }
});

app.post('/delete-user', async (req, res) => {
    if (!req.session.loggedin || req.session.accountType !== 'Admin') return res.redirect('/');
    const { userId } = req.body;
    try {
        const userToDelete = await db.collection('users').findOne({ _id: new ObjectId(userId) });
        if (userToDelete && userToDelete.login.username === req.session.currentuser) {
            req.flash('error_msg', 'You cannot delete your own account.');
            return res.redirect('/users');
        }
        await db.collection('users').deleteOne({ _id: new ObjectId(userId) });
        req.flash('success_msg', 'User deleted successfully.');
        res.redirect('/users');
    } catch (err) {
        console.error("❌ Error deleting user:", err);
        res.redirect('/users');
    }
});

// =================================================================
// --- DASHBOARD & DOCUMENTS ---
// =================================================================

const LOW_STOCK_THRESHOLD = 5;

app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedin) return res.redirect('/');
    if (!db) {
        return res.status(503).send(`<h1>Database Connecting</h1><p>The database is still establishing a connection. Status: ${connectionStatus}. Please refresh in 5 seconds.</p>`);
    }

    try {
        const totalStock = await db.collection('stock').countDocuments();
        const totalDocuments = await db.collection('documents').countDocuments();
        const totalUsers = await db.collection('users').countDocuments();
        const lowStockItems = await db.collection('stock').find({ qty: { $lt: LOW_STOCK_THRESHOLD } }).toArray();

        res.render('pages/dashboard', { 
            page: 'dashboard', 
            user: req.session.currentuser, 
            totalStock, 
            totalDocuments, 
            totalUsers, 
            lowStockItems, 
            LOW_STOCK_THRESHOLD 
        });
    } catch (err) { 
        console.error("🔥 Dashboard Rendering Error:", err);
        res.status(500).send(`<h1>Dashboard Error</h1><p>${err.message}</p>`); 
    }
});

app.get('/documents', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        const documents = await db.collection('documents').find().sort({ "published": -1 }).toArray();
        res.render('pages/documents', { page: 'documents', documents });
    } catch (err) { res.status(500).send("Documents Error"); }
});

app.post('/createDoc', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        await db.collection('documents').insertOne({
            documentName: req.body.documentName,
            labelType: req.body.labelType,
            published: new Date().toISOString().slice(0, 19)
        });
        req.flash('success_msg', 'Document created.');
        res.redirect('/documents');
    } catch (err) { res.redirect('/documents'); }
});

app.post('/delete-document', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { documentId } = req.body;
    try {
        await db.collection('stock').deleteMany({ documentId: documentId });
        await db.collection('documents').deleteOne({ _id: new ObjectId(documentId) });
        res.redirect('/documents');
    } catch (err) { res.redirect('/documents'); }
});

// =================================================================
// --- STOCK MANAGEMENT ---
// =================================================================

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
        const stock = await db.collection('stock').find(filter)
            .sort({ "published": -1 })
            .skip((currentPage - 1) * itemsPerPage)
            .limit(itemsPerPage)
            .toArray();

        res.render('pages/documentStock', { 
            document, 
            stock, 
            selectedCategory, 
            searchQuery,
            currentPage, 
            totalPages: Math.ceil(totalItems / itemsPerPage) 
        });
    } catch (err) { res.status(500).send("Stock Error"); }
});

app.post('/addStock', imageUpload.single('image'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { documentId, productName, productCode, Brand, Category, Qty, RRP, Price, Barcode } = req.body;
    await db.collection('stock').insertOne({
        imageUrl: req.file ? '/images/' + req.file.filename : null,
        productName, productCode, brand: Brand, category: Category,
        qty: parseInt(Qty) || 0, rrp: RRP, price: Price, barcode: Barcode,
        documentId, published: new Date().toISOString().slice(0, 19),
        productURL: "/product/" + Barcode, deleteURL: "/delete/" + Barcode
    });
    res.redirect(`/document/${documentId}/stock`);
});

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
                qty: parseInt(Qty) || 0, rrp: RRP, price: Price, barcode: Barcode, 
                imageUrl, productURL: "/product/" + Barcode, deleteURL: "/delete/" + Barcode 
            }
        });
        res.redirect(`/document/${documentId}/stock?page=${currentPage || 1}#item-${Barcode}`);
    } catch (err) { res.redirect('/documents'); }
});

app.post('/delete', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { barcode, documentId } = req.body;
    await db.collection('stock').deleteOne({ barcode });
    res.redirect(`/document/${documentId}/stock`);
});

// =================================================================
// --- EXCEL & POS ---
// =================================================================

app.post('/import-stock', excelImport.single('stockFile'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const items = data.map(row => ({
            productName: row.productName, barcode: String(row.barcode), 
            productCode: row.productCode || '', brand: row.brand || '', category: row.category || 'Misc',
            qty: parseInt(row.qty) || 0, rrp: String(row.rrp || '0.00'), price: String(row.price || '0.00'),
            documentId: req.body.documentId, published: new Date().toISOString().slice(0, 19),
            productURL: "/product/" + String(row.barcode), deleteURL: "/delete/" + String(row.barcode)
        })).filter(i => i.productName && i.barcode);
        if (items.length > 0) await db.collection('stock').insertMany(items);
        req.flash('success_msg', `Imported ${items.length} items.`);
        res.redirect('/documents');
    } catch (e) { req.flash('error_msg', 'Import failed.'); res.redirect('/documents'); }
});

app.post('/selected', async (req, res) => {
    if (!db) return res.redirect('/');
    const { selectedBarcodes, documentId } = req.body;
    if (!selectedBarcodes) return res.redirect(`/document/${documentId}/stock`);
    const barcodes = Array.isArray(selectedBarcodes) ? selectedBarcodes : [selectedBarcodes];
    try {
        const selectedItems = await db.collection('stock').find({ barcode: { $in: barcodes } }).toArray();
        const document = await db.collection('documents').findOne({ _id: new ObjectId(documentId) });
        res.render('pages/selectedStock', { selectedItems, document });
    } catch (err) { res.status(500).send("Error generating labels."); }
});

app.post('/process-sale', async (req, res) => {
    if (!req.session.loggedin || !db) return res.status(401).json({ error: 'Unauthorized' });
    const { items } = req.body;
    try {
        for (const item of items) {
            await db.collection('stock').updateOne({ barcode: item.barcode }, { $inc: { qty: -item.quantity } });
        }
        res.status(200).json({ message: 'Success' });
    } catch (e) { res.status(500).json({ error: 'Sale processing failed.' }); }
});

// =================================================================
// --- AUTOMATED ALERTS (CRON) ---
// =================================================================

const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com", port: 465, secure: true,
    auth: { user: 'info@stockplus.abzdigitalgroup.com', pass: 'jtdhJ35j26Mfg?2' }
});

cron.schedule('0 9 * * *', async () => {
    if (!db) return;
    try {
        const low = await db.collection('stock').find({ qty: { $lt: LOW_STOCK_THRESHOLD } }).toArray();
        if (low.length > 0) {
            const html = `<ul>${low.map(i => `<li><b>${i.productName}</b>: ${i.qty} left</li>`).join('')}</ul>`;
            await transporter.sendMail({
                from: '"StockPlus Alerts" <info@stockplus.abzdigitalgroup.com>',
                to: 'stuartiek@gmail.com',
                subject: `🚨 Low Stock Alert - ${low.length} Items`,
                html: `<h1>Daily Low Stock Report</h1>${html}<p>Please review inventory levels.</p>`
            });
        }
    } catch (e) { console.error('Cron Error:', e.message); }
}, { timezone: "Europe/London" });

process.on('uncaughtException', (err) => console.error('🔥 FATAL ERROR:', err));