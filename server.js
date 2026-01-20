const express = require('express');
const qiniu = require('qiniu');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const http = require('http'); // 引入 http 模块用于代理
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
const adminPassword = process.env.ADMIN_PASSWORD || "admin"; // 默认密码 admin

// --- 鉴权中间件 ---
const authMiddleware = (req, res, next) => {
    const password = req.headers['x-admin-password'];
    if (password !== adminPassword) {
        return res.status(403).json({ error: 'Unauthorized: Incorrect password' });
    }
    next();
};

// --- API ---

// API: 获取所有音效 (公开)
app.get('/api/sounds', async (req, res) => {
    // ... (保持原样)
    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database not connected' });
    }
    try {
        const sounds = await Sound.find().sort({ createdAt: -1 });
        res.json(sounds);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch sounds' });
    }
});

// API: 保存新音效 (公开，暂不限制)
app.post('/api/sounds', async (req, res) => {
    try {
        const { name, url, color } = req.body;
        // 撤销强制 HTTPS，保持原样保存，由前端决定是否走代理
        const newSound = new Sound({ name, url, color });
        await newSound.save();
        res.json(newSound);
    } catch (err) {
        res.status(500).json({ error: 'Failed to save sound' });
    }
});

// API: 代理接口 (解决 HTTPS 无法播放 HTTP 音频的问题)
app.get('/api/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing URL');

    // 简单验证：只允许 http 协议
    if (!targetUrl.startsWith('http://')) {
        return res.redirect(targetUrl); // 如果已经是 https，直接跳转
    }

    http.get(targetUrl, (response) => {
        // 透传 Content-Type (如 audio/mpeg)
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        // 设置缓存，避免每次都消耗流量 (缓存 1 年)
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        // 将七牛云的数据流直接管道转发给前端
        response.pipe(res);
    }).on('error', (err) => {
        console.error('Proxy error:', err);
        res.status(500).send('Proxy Error');
    });
});

// API: 修改音效 (需要密码)
app.put('/api/sounds/:id', authMiddleware, async (req, res) => {
    try {
        const { name, color } = req.body;
        const updatedSound = await Sound.findByIdAndUpdate(
            req.params.id, 
            { name, color },
            { new: true } // 返回修改后的对象
        );
        res.json(updatedSound);
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});

// API: 删除音效 (需要密码)
app.delete('/api/sounds/:id', authMiddleware, async (req, res) => {
    try {
        const sound = await Sound.findById(req.params.id);
        if (!sound) return res.status(404).json({ error: 'Sound not found' });

        // 1. 从七牛云删除文件
        if (accessKey && secretKey && bucket) {
            const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
            const config = new qiniu.conf.Config();
            const bucketManager = new qiniu.rs.BucketManager(mac, config);
            
            // 从 URL 提取 key (文件名)
            // 假设 URL 是 http://domain.com/filename
            const key = sound.url.split('/').pop();
            
            bucketManager.delete(bucket, key, function(err, respBody, respInfo) {
                if (err) {
                    console.error("Qiniu delete error:", err);
                    // 不阻断流程，继续删除数据库记录
                } else {
                    console.log("Qiniu file deleted:", key);
                }
            });
        }

        // 2. 从数据库删除
        await Sound.findByIdAndDelete(req.params.id);
        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Delete failed' });
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
