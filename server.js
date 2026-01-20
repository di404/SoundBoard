const express = require('express');
const qiniu = require('qiniu');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- 数据库配置 ---
const mongoUrl = process.env.MONGO_URL;
if (mongoUrl) {
    mongoose.connect(mongoUrl)
        .then(() => console.log('Connected to MongoDB'))
        .catch(err => console.error('MongoDB connection error:', err));
}

const soundSchema = new mongoose.Schema({
    name: String,
    url: String,
    color: String,
    icon: { type: String, default: 'fa-music' },
    createdAt: { type: Date, default: Date.now }
});

const Sound = mongoose.model('Sound', soundSchema);

// --- 七牛云配置 ---
const accessKey = process.env.QINIU_ACCESS_KEY;
const secretKey = process.env.QINIU_SECRET_KEY;
const bucket = process.env.QINIU_BUCKET;
const domain = process.env.QINIU_DOMAIN;

// API: 获取所有音效
app.get('/api/sounds', async (req, res) => {
    try {
        const sounds = await Sound.find().sort({ createdAt: -1 });
        res.json(sounds);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch sounds' });
    }
});

// API: 保存新音效
app.post('/api/sounds', async (req, res) => {
    try {
        const { name, url, color } = req.body;
        const newSound = new Sound({ name, url, color });
        await newSound.save();
        res.json(newSound);
    } catch (err) {
        res.status(500).json({ error: 'Failed to save sound' });
    }
});

// API: 获取上传凭证
app.get('/api/upload-token', (req, res) => {
    if (!accessKey || !secretKey || !bucket || !domain) {
        return res.status(500).json({ error: 'Server misconfiguration: Qiniu keys missing' });
    }

    const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    const options = { scope: bucket, expires: 3600 };
    const putPolicy = new qiniu.rs.PutPolicy(options);
    const uploadToken = putPolicy.uploadToken(mac);

    res.json({ token: uploadToken, domain: domain });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
