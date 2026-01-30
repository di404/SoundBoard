const mongoose = require('mongoose');

// 用户模型
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true }, // 存储哈希后的密码
    createdAt: { type: Date, default: Date.now }
});

// 音效模型
const soundSchema = new mongoose.Schema({
    name: String,
    url: String,
    color: String,
    icon: { type: String, default: 'fa-music' },
    duration: Number, // 音效时长（秒）
    size: Number, // 文件大小（字节）
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 上传者
    createdAt: { type: Date, default: Date.now }
});

// 合集模型
const collectionSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: String,
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sounds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Sound' }],
    isPublic: { type: Boolean, default: false }, // 是否公开
    createdAt: { type: Date, default: Date.now }
});

// 收藏模型
const favoriteSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sound: { type: mongoose.Schema.Types.ObjectId, ref: 'Sound', required: true },
    createdAt: { type: Date, default: Date.now }
});

// 添加联合索引，防止重复收藏
favoriteSchema.index({ user: 1, sound: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);
const Sound = mongoose.model('Sound', soundSchema);
const Collection = mongoose.model('Collection', collectionSchema);
const Favorite = mongoose.model('Favorite', favoriteSchema);

module.exports = { User, Sound, Collection, Favorite };
