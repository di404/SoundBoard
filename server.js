const express = require('express');
const qiniu = require('qiniu');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const mongoose = require('mongoose');
const { User, Sound, Collection, Favorite } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// MongoDB Connection
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/instant-fun';
mongoose.connect(MONGO_URL)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- 七牛云配置 ---
const accessKey = process.env.QINIU_ACCESS_KEY;
const secretKey = process.env.QINIU_SECRET_KEY;
const bucket = process.env.QINIU_BUCKET;
const domain = process.env.QINIU_DOMAIN;

// 配置限制
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_DURATION = 30; // 30秒

// --- 认证中间件 ---
const authMiddleware = async (req, res, next) => {
    try {
        const token = req.headers['authorization']?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ error: '未登录' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ error: '用户不存在' });
        }

        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ error: '登录已过期，请重新登录' });
    }
};

// --- 可选认证中间件（公开但可以访问用户信息）---
const optionalAuthMiddleware = async (req, res, next) => {
    try {
        const token = req.headers['authorization']?.replace('Bearer ', '');
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await User.findById(decoded.userId);
            if (user) {
                req.user = user;
            }
        }
        next();
    } catch (err) {
        next();
    }
};

// --- API: 用户注册 ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: '密码至少6位' });
        }

        // 检查用户名和邮箱是否已存在
        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: '用户名或邮箱已存在' });
        }

        // 哈希密码
        const hashedPassword = bcrypt.hash(password, 10);

        const user = new User({ username, email, password: hashedPassword });
        await user.save();

        // 生成 token
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            token,
            user: { id: user._id, username: user.username, email: user.email }
        });
    } catch (err) {
        console.error('注册错误:', err);
        res.status(500).json({ error: '注册失败' });
    }
});

// --- API: 用户登录 ---
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: '请填写邮箱和密码' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(401).json({ error: '邮箱或密码错误' });
        }

        const isValid = bcrypt.compare(password, user.password);
        if (!isValid) {
            return res.status(401).json({ error: '邮箱或密码错误' });
        }

        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });

        res.json({
            token,
            user: { id: user._id, username: user.username, email: user.email }
        });
    } catch (err) {
        console.error('登录错误:', err);
        res.status(500).json({ error: '登录失败' });
    }
});

// --- API: 获取当前用户信息 ---
app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({
        id: req.user._id,
        username: req.user.username,
        email: req.user.email
    });
});

// --- API: 获取所有音效（公开）---
app.get('/api/sounds', optionalAuthMiddleware, async (req, res) => {
    try {
        const sounds = await Sound.find()
            .populate('uploader', 'username')
            .sort({ createdAt: -1 });

        // 如果用户已登录，添加收藏信息
        let favorites = [];
        if (req.user) {
            favorites = await Favorite.find({ user: req.user._id }).distinct('sound');
        }

        const result = sounds.map(sound => ({
            ...sound._doc,
            isFavorite: favorites.includes(sound._id.toString())
        }));

        res.json(result);
    } catch (err) {
        console.error('获取音效错误:', err);
        res.status(500).json({ error: '获取音效失败' });
    }
});

// --- API: 上传音效（需要登录）---
app.post('/api/sounds', authMiddleware, async (req, res) => {
    try {
        const { name, url, color, duration, size } = req.body;

        if (!name || !url) {
            return res.status(400).json({ error: '请填写音效名称和URL' });
        }

        // 验证文件大小
        if (size > MAX_FILE_SIZE) {
            return res.status(400).json({ error: `文件大小不能超过 ${MAX_FILE_SIZE / 1024 / 1024}MB` });
        }

        // 验证时长
        if (duration > MAX_DURATION) {
            return res.status(400).json({ error: `音效时长不能超过 ${MAX_DURATION}秒` });
        }

        const sound = new Sound({
            name,
            url,
            color,
            duration,
            size,
            uploader: req.user._id
        });

        await sound.save();
        res.json(sound);
    } catch (err) {
        console.error('上传音效错误:', err);
        res.status(500).json({ error: '上传音效失败' });
    }
});

// --- API: 删除音效（仅上传者或管理员）---
app.delete('/api/sounds/:id', authMiddleware, async (req, res) => {
    try {
        const sound = await Sound.findById(req.params.id);
        if (!sound) {
            return res.status(404).json({ error: '音效不存在' });
        }

        // 检查权限
        if (sound.uploader.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: '无权删除此音效' });
        }

        // 从七牛云删除文件
        if (accessKey && secretKey && bucket) {
            const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
            const config = new qiniu.conf.Config();
            const bucketManager = new qiniu.rs.BucketManager(mac, config);

            const key = sound.url.split('/').pop();
            bucketManager.delete(bucket, key, (err) => {
                if (err) console.error('七牛云删除错误:', err);
                else console.log('七牛云文件已删除:', key);
            });
        }

        // 从数据库删除
        await Sound.findByIdAndDelete(req.params.id);

        // 同时删除相关的收藏和合集引用
        await Favorite.deleteMany({ sound: req.params.id });
        await Collection.updateMany({}, { $pull: { sounds: req.params.id } });

        res.json({ success: true });
    } catch (err) {
        console.error('删除音效错误:', err);
        res.status(500).json({ error: '删除音效失败' });
    }
});

// --- API: 修改音效（仅上传者）---
app.put('/api/sounds/:id', authMiddleware, async (req, res) => {
    try {
        const { name, color } = req.body;
        const sound = await Sound.findById(req.params.id);

        if (!sound) {
            return res.status(404).json({ error: '音效不存在' });
        }

        if (sound.uploader.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: '无权修改此音效' });
        }

        const updatedSound = await Sound.findByIdAndUpdate(
            req.params.id,
            { name, color },
            { new: true }
        ).populate('uploader', 'username');

        res.json(updatedSound);
    } catch (err) {
        console.error('修改音效错误:', err);
        res.status(500).json({ error: '修改音效失败' });
    }
});

// --- API: 创建合集（需要登录）---
app.post('/api/collections', authMiddleware, async (req, res) => {
    try {
        const { name, description, isPublic } = req.body;

        if (!name) {
            return res.status(400).json({ error: '请填写合集名称' });
        }

        const collection = new Collection({
            name,
            description,
            isPublic,
            owner: req.user._id
        });

        await collection.save();
        res.json(collection);
    } catch (err) {
        console.error('创建合集错误:', err);
        res.status(500).json({ error: '创建合集失败' });
    }
});

// --- API: 获取我的合集 ---
app.get('/api/collections', authMiddleware, async (req, res) => {
    try {
        const collections = await Collection.find({ owner: req.user._id })
            .populate('sounds')
            .sort({ createdAt: -1 });

        res.json(collections);
    } catch (err) {
        console.error('获取合集错误:', err);
        res.status(500).json({ error: '获取合集失败' });
    }
});

// --- API: 添加音效到合集 ---
app.post('/api/collections/:id/sounds', authMiddleware, async (req, res) => {
    try {
        const { soundId } = req.body;

        const collection = await Collection.findById(req.params.id);
        if (!collection) {
            return res.status(404).json({ error: '合集不存在' });
        }

        if (collection.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: '无权操作此合集' });
        }

        if (collection.sounds.includes(soundId)) {
            return res.status(400).json({ error: '音效已在合集中' });
        }

        collection.sounds.push(soundId);
        await collection.save();

        res.json(collection);
    } catch (err) {
        console.error('添加音效到合集错误:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

// --- API: 从合集移除音效 ---
app.delete('/api/collections/:id/sounds/:soundId', authMiddleware, async (req, res) => {
    try {
        const collection = await Collection.findById(req.params.id);
        if (!collection) {
            return res.status(404).json({ error: '合集不存在' });
        }

        if (collection.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: '无权操作此合集' });
        }

        collection.sounds = collection.sounds.filter(s => s.toString() !== req.params.soundId);
        await collection.save();

        res.json(collection);
    } catch (err) {
        console.error('从合集移除音效错误:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

// --- API: 删除合集 ---
app.delete('/api/collections/:id', authMiddleware, async (req, res) => {
    try {
        const collection = await Collection.findById(req.params.id);
        if (!collection) {
            return res.status(404).json({ error: '合集不存在' });
        }

        if (collection.owner.toString() !== req.user._id.toString()) {
            return res.status(403).json({ error: '无权删除此合集' });
        }

        await Collection.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('删除合集错误:', err);
        res.status(500).json({ error: '删除合集失败' });
    }
});

// --- API: 收藏音效 ---
app.post('/api/favorites', authMiddleware, async (req, res) => {
    try {
        const { soundId } = req.body;

        const existing = await Favorite.findOne({ user: req.user._id, sound: soundId });
        if (existing) {
            return res.status(400).json({ error: '已收藏' });
        }

        const favorite = new Favorite({ user: req.user._id, sound: soundId });
        await favorite.save();

        res.json(favorite);
    } catch (err) {
        console.error('收藏错误:', err);
        if (err.code === 11000) {
            return res.status(400).json({ error: '已收藏' });
        }
        res.status(500).json({ error: '收藏失败' });
    }
});

// --- API: 取消收藏 ---
app.delete('/api/favorites/:soundId', authMiddleware, async (req, res) => {
    try {
        await Favorite.findOneAndDelete({
            user: req.user._id,
            sound: req.params.soundId
        });

        res.json({ success: true });
    } catch (err) {
        console.error('取消收藏错误:', err);
        res.status(500).json({ error: '操作失败' });
    }
});

// --- API: 获取我的收藏 ---
app.get('/api/favorites', authMiddleware, async (req, res) => {
    try {
        const favorites = await Favorite.find({ user: req.user._id })
            .populate('sound')
            .sort({ createdAt: -1 });

        res.json(favorites.map(f => f.sound));
    } catch (err) {
        console.error('获取收藏错误:', err);
        res.status(500).json({ error: '获取收藏失败' });
    }
});

// --- API: 代理接口 ---
app.get('/api/proxy', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Missing URL');

    if (!targetUrl.startsWith('http://')) {
        return res.redirect(targetUrl);
    }

    http.get(targetUrl, (response) => {
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        response.pipe(res);
    }).on('error', (err) => {
        console.error('Proxy error:', err);
        res.status(500).send('Proxy Error');
    });
});

// --- API: 获取上传凭证 ---
app.get('/api/upload-token', authMiddleware, (req, res) => {
    if (!accessKey || !secretKey || !bucket || !domain) {
        return res.status(500).json({ error: '服务器配置错误' });
    }

    const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    const options = { scope: bucket, expires: 3600 };
    const putPolicy = new qiniu.rs.PutPolicy(options);
    const uploadToken = putPolicy.uploadToken(mac);

    res.json({ token: uploadToken, domain, maxSize: MAX_FILE_SIZE });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
