const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const SyncData = require('./models/SyncData');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/timenerd')
    .then(async () => {
        console.log('✅ Connected to MongoDB');
        await bootstrapAdminFromEnv();
    })
    .catch(err => {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    });

async function bootstrapAdminFromEnv() {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    console.log('Checking for ENV-based bootstrap...');
    if (adminEmail && adminPassword) {
        console.log(`Attempting to bootstrap admin: ${adminEmail}`);
        try {
            const existing = await User.findOne({ email: adminEmail });
            if (!existing) {
                const admin = new User({
                    email: adminEmail,
                    password: adminPassword,
                    role: 'admin',
                    status: 'approved'
                });
                await admin.save();
                console.log(`🚀 Admin user created successfully: ${adminEmail}`);
            } else {
                console.log(`Admin user already exists: ${adminEmail}`);
            }
        } catch (err) {
            console.error('❌ Failed to bootstrap admin from ENV:', err.message);
        }
    } else {
        console.log('No ADMIN_EMAIL or ADMIN_PASSWORD found in environment.');
    }
}

// --- Middleware ---
const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = await User.findById(decoded.userId);
        if (!req.user) throw new Error();
        next();
    } catch (err) {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    next();
};

// --- Auth Routes ---

// Status: Check if system is bootstrapped
app.get('/api/auth/status', async (req, res) => {
    try {
        const userCount = await User.countDocuments();
        const bootstrapped = userCount > 0;
        console.log(`System bootstrap check: ${bootstrapped ? 'READY' : 'PENDING'}`);
        res.json({ bootstrapped });
    } catch (err) {
        console.error('Status check error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Bootstrap: First user becomes admin
app.post('/api/auth/bootstrap', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        
        const userCount = await User.countDocuments();
        if (userCount > 0) return res.status(400).json({ error: 'System already initialized' });
        
        const user = new User({ email, password, role: 'admin', status: 'approved' });
        await user.save();
        
        const token = jwt.sign({ userId: user._id }, JWT_SECRET);
        res.json({ token, user: { email: user.email, role: user.role } });
    } catch (err) {
        console.error('Bootstrap error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (user.status !== 'approved') {
            return res.status(403).json({ error: 'Account pending approval' });
        }
        const token = jwt.sign({ userId: user._id }, JWT_SECRET);
        res.json({ 
            token, 
            user: { email: user.email, role: user.role, mustChangePassword: user.mustChangePassword } 
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/request-access', async (req, res) => {
    const { email, password } = req.body;
    try {
        const existing = await User.findOne({ email });
        if (existing) return res.status(400).json({ error: 'User already exists' });
        
        const user = new User({ email, password, status: 'pending' });
        await user.save();
        res.json({ message: 'Access request submitted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- User Management (Admin Only) ---

app.get('/api/admin/users', authenticate, adminOnly, async (req, res) => {
    const users = await User.find({}, '-password');
    res.json(users);
});

app.post('/api/admin/invite', authenticate, adminOnly, async (req, res) => {
    const { email, tempPassword } = req.body;
    try {
        const user = new User({ 
            email, 
            password: tempPassword, 
            status: 'approved', 
            mustChangePassword: true 
        });
        await user.save();
        res.json({ message: 'User invited' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/approve/:id', authenticate, adminOnly, async (req, res) => {
    await User.findByIdAndUpdate(req.params.id, { status: 'approved' });
    res.json({ message: 'User approved' });
});

app.delete('/api/admin/users/:id', authenticate, adminOnly, async (req, res) => {
    await User.findByIdAndDelete(req.params.id);
    await SyncData.deleteMany({ userId: req.params.id });
    res.json({ message: 'User deleted' });
});

// --- RxDB Replication API ---

app.post('/api/sync/pull', authenticate, async (req, res) => {
    const { collection, lastCheckpoint, limit } = req.body;
    const checkpoint = lastCheckpoint || { updatedAt: 0, id: '' };
    
    try {
        const docs = await SyncData.find({
            userId: req.user._id,
            collectionName: collection,
            updatedAt: { $gte: checkpoint.updatedAt }
        })
        .sort({ updatedAt: 1, _id: 1 })
        .limit(limit || 100);

        const newCheckpoint = docs.length > 0 
            ? { updatedAt: docs[docs.length - 1].updatedAt, id: docs[docs.length - 1]._id }
            : checkpoint;

        res.json({
            documents: docs.map(d => ({ ...d.data, _deleted: d.deleted })),
            checkpoint: newCheckpoint
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/sync/push', authenticate, async (req, res) => {
    const { collection, events } = req.body;
    try {
        for (const event of events) {
            const { id, _deleted, ...data } = event.newDocumentState;
            await SyncData.findOneAndUpdate(
                { userId: req.user._id, collectionName: collection, documentId: id },
                { 
                    data, 
                    deleted: !!_deleted, 
                    updatedAt: Date.now() 
                },
                { upsert: true }
            );
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
