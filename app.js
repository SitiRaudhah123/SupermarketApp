// SOME PART ASK AI FOR HELP SINCE THERE PART I STRUGGLE TO FIND MY ERROR/FIX IT!
const express = require('express');
const mysql = require('mysql2/promise'); 
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const app = express();


const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); 
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname);
    }
});

const upload = multer({ storage: storage });


const pool = mysql.createPool({ 
    host: 'o453e1.h.filess.io',
    user: 'c237supermarketdb_solvenoise',
    password: '6105c8b786e81037ce9c11007746e578f1c79cae',
    database: 'c237supermarketdb_solvenoise', 
    port: 3307,
    connectionLimit: 2 
});


pool.getConnection()
    .then(conn => {
        console.log('Connected to MySQL database pool');
        conn.release(); 
    })
    .catch(err => {
        console.error('Error connecting to MySQL pool:', err);
        
        process.exit(1);
    });


app.set('view engine', 'ejs');

app.use(express.static('public'));

app.use(express.urlencoded({
    extended: false
}));


app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());


const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view this resource');
        res.redirect('/login');
    }
};


const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') {
        return next();
    } else {
        req.flash('error', 'Access denied');
        res.redirect('/shopping');
    }
};


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


app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});


app.get('/inventory', checkAuthenticated, checkAdmin, async (req, res) => {
    try {
        const [results] = await pool.query('SELECT * FROM products'); 
        res.render('inventory', { products: results, user: req.session.user });
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).send('Error fetching inventory data.');
    }
});

app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, async (req, res) => { 
    const { username, email, password, address, contact, role } = req.body;
    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
    try {
        const [result] = await pool.query(sql, [username, email, password, address, contact, role]); // Used pool.query
        console.log(result);
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    } catch (err) {
        console.error('Error registering user:', err);
        if (err.code === 'ER_DUP_ENTRY') { 
            req.flash('error', 'Email already registered. Please use a different one.');
            req.flash('formData', req.body);
            return res.redirect('/register');
        }
        res.status(500).send('Error during registration.'); 
    }
});

app.get('/login', (req, res) => {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
});

app.post('/login', async (req, res) => { 
    const { email, password } = req.body;

    
    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
    try {
        const [results] = await pool.query(sql, [email, password]); 

        if (results.length > 0) {
            
            req.session.user = results[0];
            req.flash('success', 'Login successful!');
            if (req.session.user.role == 'user')
                res.redirect('/shopping');
            else
                res.redirect('/inventory');
        } else {
           
            req.flash('error', 'Invalid email or password.');
            res.redirect('/login');
        }
    } catch (err) {
        console.error('Error during login:', err); 
        res.status(500).send('Error during login process.');
    }
});

app.get('/shopping', checkAuthenticated, async (req, res) => { 
    try {
        const [results] = await pool.query('SELECT * FROM products'); 
        res.render('shopping', { user: req.session.user, products: results });
    } catch (error) {
        console.error('Error fetching shopping products:', error);
        res.status(500).send('Error fetching products for shopping.');
    }
});

app.post('/add-to-cart/:id', checkAuthenticated, async (req, res) => { 
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    try {
        const [results] = await pool.query('SELECT * FROM products WHERE productId = ?', [productId]); // Used pool.query

        if (results.length > 0) {
            const product = results[0];

            
            if (!req.session.cart) {
                req.session.cart = [];
            }

            
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

app.get('/product/:id', checkAuthenticated, async (req, res) => { 
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

app.post('/addProduct', upload.single('image'), async (req, res) => { 
    const { name, quantity, price } = req.body;
    let image;
    if (req.file) {
        image = req.file.filename;
    } else {
        image = null;
    }

    const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
    try {
        const [results] = await pool.query(sql, [name, quantity, price, image]); 
        res.redirect('/inventory');
    } catch (error) {
        console.error("Error adding product:", error);
        res.status(500).send('Error adding product');
    }
});

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, async (req, res) => { 
    const productId = req.params.id;
    const sql = 'SELECT * FROM products WHERE productId = ?';

    try {
        const [results] = await pool.query(sql, [productId]); 

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

app.post('/updateProduct/:id', upload.single('image'), async (req, res) => { 
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

app.get('/deleteProduct/:id', async (req, res) => { 
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