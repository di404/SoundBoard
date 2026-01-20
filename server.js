const express = require('express');
const qiniu = require('qiniu');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 七牛云配置
const accessKey = process.env.QINIU_ACCESS_KEY;
const secretKey = process.env.QINIU_SECRET_KEY;
const bucket = process.env.QINIU_BUCKET;
const domain = process.env.QINIU_DOMAIN; // 必须带 http:// 或 https://

// API: 获取上传凭证
app.get('/api/upload-token', (req, res) => {
    if (!accessKey || !secretKey || !bucket || !domain) {
        return res.status(500).json({ error: 'Server misconfiguration: Qiniu keys missing' });
    }

    const mac = new qiniu.auth.digest.Mac(accessKey, secretKey);
    
    const options = {
        scope: bucket,
        expires: 3600 // 1 hour
    };
    
    const putPolicy = new qiniu.rs.PutPolicy(options);
    const uploadToken = putPolicy.uploadToken(mac);

    res.json({
        token: uploadToken,
        domain: domain
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
