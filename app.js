const express = require('express');
const mysql = require('mysql2/promise'); // <--- CHANGE 1: Import mysql2's promise-based API
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });

// <--- CHANGE 2: Use mysql.createPool instead of mysql.createConnection
const pool = mysql.createPool({ // Renamed 'connection' to 'pool' for clarity
    host: 'o453e1.h.filess.io',
    user: 'c237supermarketdb_solvenoise',
    password: '6105c8b786e81037ce9c11007746e578f1c79cae', // <--- Ensure this is the EXACT password from Filess.io
    database: 'c237supermarketdb_solvenoise', // <--- Ensure this is the EXACT database ID from Filess.io
    port: 3307,
    connectionLimit: 2 // <--- CHANGE 3: VERY IMPORTANT for Filess.io Free Tier. Keep this low (e.g., 1 or 2).
});

// <--- CHANGE 4: Test pool connection instead of direct connection
pool.getConnection()
    .then(conn => {
        console.log('Connected to MySQL database pool');
        conn.release(); // Release the connection immediately after testing
    })
    .catch(err => {
        console.error('Error connecting to MySQL pool:', err);
        // It's good practice to exit the app if the database connection fails on startup
        process.exit(1);
    });

// Set up view engine
app.set('view engine', 'ejs');
//  enable static files
app.use(express.static('public'));
// enable form processing
app.use(express.urlencoded({
    extended: false
}));

//TO DO: Insert code for Session Middleware below
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    // Session expires after 1 week of inactivity
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};

// Middleware for form validation
const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact, role } = req.body;

    if (!username || !email || !password || !address || !contact || !role) {
        return res.status(400).send('All fields are required.');
    }

    if (password.length < 6) {
        req.flash('error', 'Password should be at least 6 or more characters long');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }
    next();
};

// Define routes
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

// <--- CHANGE 5: Use pool.query (with async/await) for all database operations
app.get('/inventory', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM products'); // Note: mysql2/promise returns [rows, fields]
        res.render('inventory', { products: results, user: req.session.user });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).send('Error fetching inventory data.');
    }
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, async (req, res) => { // Added async
    const { username, email, password, address, contact, role } = req.body;
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    try {
        const [result] = await pool.query(sql, [username, email, password, address, contact, role]); // Used pool.query
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    } catch (err) {
        console.error('Error registering user:', err); // Better error logging
        if (err.code === 'ER_DUP_ENTRY') { // Example: handle duplicate email
            req.flash('error', 'Email already registered. Please use a different one.');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }
        res.status(500).send('Error during registration.'); // Generic error for client
    }
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', async (req, res) => { // Added async
    const { email, password } = req.body;

    // Validate email and password
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    try {
        const [results] = await pool.query(sql, [email, password]); // Used pool.query

        if (results.length > 0) {
            // Successful login
            req.session.user = results[0];
            req.flash('success', 'Login successful!');
            if (req.session.user.role == 'user')
                res.redirect('/shopping');
            else
                res.redirect('/inventory');
        } else {
            // Invalid credentials
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    } catch (err) {
        console.error('Error during login:', err); // Better error logging
        res.status(500).send('Error during login process.');
    }
});

app.get('/shopping', checkAuthenticated, async (req, res) => { // Added async
    try {
        const [results] = await pool.query('SELECT * FROM products'); // Used pool.query
        res.render('shopping', { user: req.session.user, products: results });
    } catch (error) {
        console.error('Error fetching shopping products:', error);
        res.status(500).send('Error fetching products for shopping.');
    }
});

app.post('/add-to-cart/:id', checkAuthenticated, async (req, res) => { // Added async
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    try {
        const [results] = await pool.query('SELECT * FROM products WHERE productId = ?', [productId]); // Used pool.query

        if (results.length > 0) {
            const product = results[0];

            // Initialize cart in session if not exists
            if (!req.session.cart) {
                req.session.cart = [];
            }

            // Check if product already in cart
            const existingItem = req.session.cart.find(item => item.productId === productId);
            if (existingItem) {
                existingItem.quantity += quantity;
            } else {
                req.session.cart.push({
                    productId: product.productId,
                    productName: product.productName,
                    price: product.price,
                    quantity: quantity,
                    image: product.image
                });
            }
            res.redirect('/cart');
        } else {
            res.status(404).send("Product not found");
        }
    } catch (error) {
        console.error('Error adding to cart:', error);
        res.status(500).send('Error adding product to cart.');
    }
});

app.get('/cart', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    res.render('cart', { cart, user: req.session.user });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/product/:id', checkAuthenticated, async (req, res) => { // Added async
    const productId = req.params.id;

    try {
        const [results] = await pool.query('SELECT * FROM products WHERE productId = ?', [productId]); // Used pool.query

        if (results.length > 0) {
            res.render('product', { product: results[0], user: req.session.user });
        } else {
            res.status(404).send('Product not found');
        }
    } catch (error) {
        console.error('Error fetching product details:', error);
        res.status(500).send('Error fetching product details.');
    }
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});

app.post('/addProduct', upload.single('image'), async (req, res) => { // Added async
    const { name, quantity, price } = req.body;
    let image;
    if (req.file) {
        image = req.file.filename;
    } else {
        image = null;
    }

    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    try {
        const [results] = await pool.query(sql, [name, quantity, price, image]); // Used pool.query
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error adding product:", error);
        res.status(500).send('Error adding product');
    }
});

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, async (req, res) => { // Added async
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE productId = ?';

    try {
        const [results] = await pool.query(sql, [productId]); // Used pool.query

        if (results.length > 0) {
            res.render('updateProduct', { product: results[0] });
        } else {
            res.status(404).send('Product not found');
        }
    } catch (error) {
        console.error("Error retrieving product for update:", error);
        res.status(500).send('Error retrieving product for update.');
    }
});

app.post('/updateProduct/:id', upload.single('image'), async (req, res) => { // Added async
    const productId = req.params.id;
    const { name, quantity, price } = req.body;
    let image = req.body.currentImage;
    if (req.file) {
        image = req.file.filename;
    }

    const sql = 'UPDATE products SET productName = ? , quantity = ?, price = ?, image =? WHERE productId = ?';
    try {
        const [results] = await pool.query(sql, [name, quantity, price, image, productId]); // Used pool.query
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).send('Error updating product');
    }
});

app.get('/deleteProduct/:id', async (req, res) => { // Added async
    const productId = req.params.id;

    try {
        const [results] = await pool.query('DELETE FROM products WHERE productId = ?', [productId]); // Used pool.query
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error deleting product:", error);
        res.status(500).send('Error deleting product');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));