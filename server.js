// BCRYPT SETUP - Using bcryptjs to avoid C++ compilation errors on Hostinger
const bcrypt = require('bcryptjs');
const saltRounds = 10;

// PORT SETUP - Let Hostinger/Passenger provide the port. 
const PORT = process.env.PORT || 3000;

// FILE SYSTEM & UPLOAD SETUP
const multer = require('multer');
const path = require('path');
const fs = require('fs'); 
const xlsx = require('xlsx');

// 📁 DIRECTORY SAFETY CHECK
// Passenger requires a 'tmp' folder to manage restarts, and we need 'images' for uploads.
const requiredFolders = [
    path.join(__dirname, 'public', 'images'),
    path.join(__dirname, 'tmp') 
];

requiredFolders.forEach(dir => {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`✅ Created missing directory: ${dir}`);
        } catch (err) {
            console.error(`❌ Error creating directory ${dir}:`, err.message);
        }
    }
});

const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const imageUpload = multer({ storage: imageStorage });
const excelImport = multer({ storage: multer.memoryStorage() });

// DATABASE SETUP
const MongoClient = require('mongodb-legacy').MongoClient;
const { ObjectId } = require('mongodb-legacy');

// Prioritize Hostinger Environment Variable, fallback to local for development
const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const client = new MongoClient(url);
const dbname = 'stockplus';

// EXPRESS & MIDDLEWARE SETUP
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const app = express();

app.use(session({
    secret: process.env.SESSION_SECRET || 'stockplus-fallback-secret',
    resave: false,
    saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(flash());

// Pass session/flash data to all views
app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.loggedin = req.session.loggedin;
    res.locals.currentuser = req.session.currentuser;
    res.locals.userType = req.session.accountType;
    next();
});

// --- SERVER STARTUP ---
// CRITICAL: We start listening immediately so Hostinger doesn't time out (503).
let db = null; 

app.listen(PORT, () => {
    console.log(`🚀 StockPlus server is live on Port: ${PORT}`);
    // Now connect to the database in the background
    connectDB();
});

async function connectDB() {
    try {
        const maskedUrl = url.replace(/:([^:@]{1,})@/, ':****@');
        console.log(`Attempting connection to: ${maskedUrl}`);
        
        await client.connect();
        db = client.db(dbname);
        console.log('✅ Connected Successfully to MongoDB Atlas');
    } catch (err) {
        console.error('❌ DATABASE CONNECTION FAILED:', err.message);
    }
}

// =================================================================
// --- ROUTES ---
// =================================================================

// 🛰️ HEALTH CHECK ROUTE
app.get('/ping', (req, res) => {
    res.send(`Server is alive! DB Connected: ${db !== null}`);
});

// INDEX
app.get('/', (req, res) => {
    res.render('pages/index');
});

const LOW_STOCK_THRESHOLD = 5;

// DASHBOARD
app.get('/dashboard', async (req, res) => {
    if (!req.session.loggedin) return res.redirect('/');
    if (!db) return res.status(503).send("Database connecting... please refresh in a few seconds.");

    try {
        const totalStock = await db.collection('stock').countDocuments();
        const totalDocuments = await db.collection('documents').countDocuments();
        const totalUsers = await db.collection('users').countDocuments();
        const lowStockItems = await db.collection('stock').find({ qty: { $lt: LOW_STOCK_THRESHOLD } }).toArray();

        res.render('pages/dashboard', {
            page: 'dashboard',
            totalStock, totalDocuments, totalUsers, lowStockItems, LOW_STOCK_THRESHOLD
        });
    } catch (err) {
        res.status(500).send("Error loading dashboard.");
    }
});

// DOCUMENTS LIST
app.get('/documents', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        const docs = await db.collection('documents').find().sort({ "published": -1 }).toArray();
        res.render('pages/documents', { page: 'documents', documents: docs });
    } catch (err) {
        res.status(500).send("Error fetching documents.");
    }
});

// STOCK MANAGEMENT (SEARCH & PAGINATION)
app.get('/document/:id/stock', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');

    const documentId = req.params.id;
    const itemsPerPage = 20;
    const selectedCategory = req.query.category || ''; 
    const searchQuery = req.query.searchQuery || '';
    const currentPage = parseInt(req.query.page) || 1;

    try {
        const document = await db.collection('documents').findOne({ _id: new ObjectId(documentId) });
        if (!document) return res.status(404).send("Document not found.");

        const filter = { documentId: documentId };
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

        res.render('pages/documentStock', {
            document, stock, selectedCategory, searchQuery, currentPage, totalPages
        });
    } catch (err) {
        res.status(500).send("Error loading stock.");
    }
});

// LOGIN ACTION
app.post('/login', async (req, res) => {
    if (!db) return res.status(503).send("Database not ready.");
    const { username, password } = req.body;
    try {
        const user = await db.collection('users').findOne({ "login.username": username });
        if (user && await bcrypt.compare(password, user.login.password)) {
            req.session.loggedin = true;
            req.session.currentuser = username;
            req.session.accountType = user.accountType;
            return res.redirect('/dashboard');
        }
        req.flash('error_msg', 'Invalid Username or Password');
        res.redirect('/');
    } catch (err) {
        res.redirect('/');
    }
});

// LOGOUT
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// USER CREATION
app.post('/signUp', async (req, res) => {
    if (!db) return res.status(503).send("Database not ready.");
    const { email, uname, psw, accountType } = req.body;
    try {
        const exists = await db.collection('users').findOne({ "login.username": uname });
        if (exists) {
            req.flash('error_msg', 'Username already taken.');
            return res.redirect('/users');
        }
        const hash = await bcrypt.hash(psw, saltRounds);
        await db.collection('users').insertOne({
            email, login: { username: uname, password: hash }, accountType, created: new Date().toISOString()
        });
        req.flash('success_msg', 'User created successfully.');
        res.redirect('/users');
    } catch (err) {
        res.redirect('/users');
    }
});

// ADD STOCK ITEM
app.post('/addStock', imageUpload.single('image'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    try {
        const { documentId, productName, productCode, Brand, Category, Qty, RRP, Price, Barcode } = req.body;
        await db.collection('stock').insertOne({
            imageUrl: req.file ? '/images/' + req.file.filename : null,
            productName, productCode, brand: Brand, category: Category,
            qty: parseInt(Qty) || 0, rrp: RRP, price: Price, barcode: Barcode,
            documentId, published: new Date().toISOString()
        });
        res.redirect(`/document/${documentId}/stock`);
    } catch (err) {
        res.redirect('/documents');
    }
});

// UPDATE STOCK ITEM
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
                qty: parseInt(Qty) || 0, rrp: RRP, price: Price, barcode: Barcode, imageUrl
            }
        });
        req.flash('success_msg', 'Stock updated successfully.');
        res.redirect(`/document/${documentId}/stock?page=${currentPage || 1}#item-${Barcode}`);
    } catch (err) {
        res.redirect(`/document/${documentId}/stock`);
    }
});

// EXCEL IMPORT
app.post('/import-stock', excelImport.single('stockFile'), async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { documentId } = req.body;
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        const items = data.map(row => ({
            productName: row.productName, barcode: String(row.barcode), productCode: row.productCode || '',
            brand: row.brand || '', category: row.category || 'Misc', qty: parseInt(row.qty) || 0,
            rrp: String(row.rrp || '0.00'), price: String(row.price || '0.00'),
            documentId, published: new Date().toISOString()
        })).filter(i => i.productName && i.barcode);

        if (items.length > 0) await db.collection('stock').insertMany(items);
        req.flash('success_msg', `Successfully imported ${items.length} items.`);
        res.redirect('/documents');
    } catch (err) {
        req.flash('error_msg', 'Excel import failed.');
        res.redirect('/documents');
    }
});

// DELETE ITEM
app.post('/delete', async (req, res) => {
    if (!req.session.loggedin || !db) return res.redirect('/');
    const { barcode, documentId } = req.body;
    await db.collection('stock').deleteOne({ barcode });
    res.redirect(`/document/${documentId}/stock`);
});

// POS SALE PROCESSING
app.post('/process-sale', async (req, res) => {
    if (!db) return res.status(503).json({ error: 'Database connecting' });
    const { items } = req.body;
    try {
        for (const item of items) {
            await db.collection('stock').updateOne({ barcode: item.barcode }, { $inc: { qty: -item.quantity } });
        }
        res.json({ message: 'Sale processed successfully' });
    } catch (err) {
        res.status(500).json({ error: 'Sale failed' });
    }
});

// =================================================================
// --- CRON JOBS (Daily Low Stock Report) ---
// =================================================================
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: "smtp.hostinger.com",
    port: 465,
    secure: true,
    auth: {
        user: 'info@stockplus.abzdigitalgroup.com',
        pass: 'jtdhJ35j26Mfg?2' 
    }
});

cron.schedule('0 9 * * *', async () => {
    if (!db) return;
    try {
        const items = await db.collection('stock').find({ qty: { $lt: LOW_STOCK_THRESHOLD } }).toArray();
        if (items.length > 0) {
            const html = `<h2>Low Stock Alert</h2><ul>${items.map(i => `<li>${i.productName}: <b>${i.qty} left</b></li>`).join('')}</ul>`;
            await transporter.sendMail({
                from: '"StockPlus" <info@stockplus.abzdigitalgroup.com>',
                to: 'stuspam2025@gmail.com',
                subject: 'StockPlus Alert: Low Stock Items',
                html: html
            });
        }
    } catch (err) {
        console.error('❌ Cron Job Error:', err.message);
    }
}, { timezone: "Europe/London" });