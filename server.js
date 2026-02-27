/**
 * STOCKPLUS PRODUCTION SERVER
 * Includes /setup-admin and Debug Logs
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
const { MongoClient, ObjectId } = require('mongodb-legacy');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure folders
const requiredDirs = [path.join(__dirname, 'public', 'images'), path.join(__dirname, 'tmp')];
requiredDirs.forEach(dir => { if (!fs.existsSync(dir)) try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {} });

const imageUpload = multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'public', 'images')),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
})});

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

app.use((req, res, next) => {
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');
    res.locals.loggedin = req.session.loggedin;
    res.locals.currentuser = req.session.currentuser;
    res.locals.userType = req.session.accountType;
    next();
});

let db = null;

app.listen(PORT, () => {
    console.log(`✅ Server live on Port: ${PORT}`);
    connectDB();
});

async function connectDB() {
    const url = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
    try {
        const client = new MongoClient(url);
        await client.connect();
        db = client.db('stockplus');
        console.log('✅ MongoDB Connected Successfully');
    } catch (err) {
        console.error('❌ MongoDB Connection Error:', err.message);
    }
}

// 🛠️ EMERGENCY SETUP ROUTE
// Visit stockplus.online/setup-admin to create/reset the account correctly
app.get('/setup-admin', async (req, res) => {
    if (!db) return res.send("DB not connected yet.");
    const passwordToHash = "&99398V4oa&";
    try {
        const hash = await bcrypt.hash(passwordToHash, 10);
        await db.collection('users').deleteOne({ "login.username": "stuartiek" });
        await db.collection('users').insertOne({
            "email": "stuart@stockplus.online",
            "login": { "username": "stuartiek", "password": hash },
            "accountType": "Admin",
            "created": new Date().toISOString()
        });
        res.send("✅ Admin 'stuartiek' has been created/reset successfully with password: " + passwordToHash);
    } catch (e) {
        res.status(500).send("Error creating admin: " + e.message);
    }
});

// LOGIN ROUTE WITH DEBUGGING
app.post('/login', async (req, res) => {
    console.log(`--- Login Attempt Start ---`);
    console.log(`Received Body:`, req.body); // Check if data is arriving

    if (!db) {
        console.log('❌ DB not connected');
        req.flash('error_msg', 'Server starting... try again.');
        return res.redirect('/');
    }

    const { username, password } = req.body;
    
    if (!username || !password) {
        console.log('❌ Missing username or password in request');
        req.flash('error_msg', 'Please enter both username and password.');
        return res.redirect('/');
    }

    try {
        const user = await db.collection('users').findOne({ "login.username": username });
        
        if (!user) {
            console.log(`❌ User "${username}" not found in database.`);
            req.flash('error_msg', 'User not found.');
            return res.redirect('/');
        }

        console.log(`User found. Checking password hash...`);
        const isMatch = await bcrypt.compare(password, user.login.password);
        
        if (isMatch) {
            console.log(`✅ Login Success for: ${username}`);
            req.session.loggedin = true;
            req.session.currentuser = username;
            req.session.accountType = user.accountType;
            return res.redirect('/dashboard');
        } else {
            console.log(`❌ Password mismatch for: ${username}`);
            req.flash('error_msg', 'Incorrect password.');
            return res.redirect('/');
        }
    } catch (err) {
        console.error('🔥 Login Error:', err);
        req.flash('error_msg', 'Internal server error.');
        res.redirect('/');
    }
});

// ... rest of the routes (dashboard, documents, logout, etc.)
app.get('/dashboard', (req, res) => {
    if (!req.session.loggedin) return res.redirect('/');
    res.render('pages/dashboard', { 
        totalStock: 0, lowStockItems: [], totalDocuments: 0, totalUsers: 0, LOW_STOCK_THRESHOLD: 5 
    });
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));
app.get('/ping', (req, res) => res.send(`Server Alive. DB: ${db !== null}`));
app.get('/', (req, res) => res.render('pages/index'));