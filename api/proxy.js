// api/proxy.js (node-fetchバージョン: ハングアップ回避を強化)
// 標準の fetch APIに近い動作をNode.js環境で実現します
const fetch = require('node-fetch'); // ★★★ axiosの代わりにnode-fetchを使用 ★★★

module.exports = async function (req, res) {
    // 1. CORSヘッダー設定 (OPTIONSリクエスト成功のため問題なし)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Notion-Version');

    // 2. OPTIONSリクエストの処理（プリフライト）
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    const body = req.body || {}; 
    const { targetUrl, method, tokenKey, tokenValue, notionVersion, body: apiBody } = body;

    if (!targetUrl || !tokenKey || !tokenValue) {
        // Missing tokenエラーを返し、保留を防ぐ
        return res.status(400).json({ 
            message: 'Missing targetUrl or tokenValue in request body payload.' 
        });
    }

    try {
        let headers = {};
        
        // 認証ヘッダーの構築
        if (tokenKey === 'notionToken') {
            headers = {
                'Authorization': `Bearer ${tokenValue}`,
                'Notion-Version': notionVersion || '2022-06-28'
            };
        } else if (tokenKey === 'togglApiToken') {
            const base64Auth = Buffer.from(`${tokenValue}:api_token`).toString('base64');
            headers = {
                'Authorization': `Basic ${base64Auth}`
            };
        }
        
        // Content-Type ヘッダーの追加
        if (method === 'POST' || method === 'PATCH') {
            headers['Content-Type'] = 'application/json';
        }

        // 外部APIへリクエストを転送 (node-fetchを使用)
        const fetchOptions = {
            method: method,
            headers: headers,
            // apiBody が存在する (POST/PATCH) 場合のみ body を設定
            body: apiBody ? JSON.stringify(apiBody) : undefined
        };

        const apiResponse = await fetch(targetUrl, fetchOptions);

        // 外部APIからの応答をクライアントに返す
        let apiData = {};
        if (apiResponse.status !== 204) {
            apiData = await apiResponse.json();
        }

        res.status(apiResponse.status).json(apiData);

    } catch (error) {
        // 内部エラーが発生した場合も必ず応答を返す（ハングアップ回避）
        console.error('Proxy internal error during API call:', error.message);
        res.status(500).json({ message: `Proxy internal error: ${error.message}` });
    }
};
