// api/proxy.js
// Vercel Functions (Node.js)で動作するプロキシコード

module.exports = async (req, res) => {
    // CORSヘッダーを設定: どこからのリクエストも受け付けるように設定
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // OPTIONSメソッド（プリフライトリクエスト）への対応
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ message: 'Method Not Allowed. Only POST is accepted for proxy.' });
        return;
    }

    try {
        const { targetUrl, method, body, tokenKey, tokenValue } = req.body;
        
        if (!targetUrl || !tokenValue) {
            res.status(400).json({ message: 'Missing targetUrl or tokenValue in request body.' });
            return;
        }

        // NotionまたはToggl向けのヘッダーを作成
        const headers = { 'Content-Type': 'application/json' };
        
        if (tokenKey === 'notionToken') {
            headers['Authorization'] = `Bearer ${tokenValue}`;
            headers['Notion-Version'] = '2022-06-28';
        } else if (tokenKey === 'togglApiToken') {
            // TogglはBasic認証を使用
            headers['Authorization'] = 'Basic ' + Buffer.from(tokenValue + ':api_token').toString('base64');
        } else {
            res.status(400).json({ message: 'Invalid tokenKey specified.' });
            return;
        }

        // 実際のAPIリクエストの実行
        const fetchRes = await fetch(targetUrl, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : null,
        });

        // 応答をそのままクライアントに返す
        const data = await fetchRes.text();
        res.status(fetchRes.status).send(data);

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ message: 'Internal Server Error during proxy execution.' });
    }
};
