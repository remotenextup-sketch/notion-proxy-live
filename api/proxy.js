const fetch = require('node-fetch');

// Notion APIのバージョンを最新の 2025-09-03 に更新
const NOTION_VERSION = '2025-09-03';

/**
 * Notion/Toggl APIへの認証ヘッダーを生成する
 */
function getAuthHeaders(tokenKey, tokenValue) {
    const headers = { 'Content-Type': 'application/json' };
    
    if (tokenKey === 'notionToken') {
        headers['Authorization'] = `Bearer ${tokenValue}`;
        headers['Notion-Version'] = NOTION_VERSION; // 最新バージョンを適用
    } else if (tokenKey === 'togglApiToken') {
        // Toggl v9 APIはBasic認証を使用
        headers['Authorization'] = 'Basic ' + Buffer.from(tokenValue + ':api_token').toString('base64');
    }
    return headers;
}

/**
 * Notionからデータベースのメタデータを取得し、部門/カテゴリのオプションを抽出する
 */
async function getConfig(dbId, tokenValue) {
    const headers = getAuthHeaders('notionToken', tokenValue);
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
        method: 'GET',
        headers: headers,
    });
    
    if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(`Notion DB取得エラー (${res.status}): ${errorBody.code || '不明なエラー'}`);
    }
    
    const data = await res.json();
    const config = { categories: [], departments: [] };
    
    // プロパティからオプションを抽出
    const props = data.properties;
    
    // カテゴリ (Select)
    if (props['カテゴリ']?.select?.options) {
        config.categories = props['カテゴリ'].select.options.map(o => o.name);
    }
    
    // 部門 (Multi-Select)
    if (props['部門']?.multi_select?.options) {
        config.departments = props['部門'].multi_select.options.map(o => o.name);
    }
    
    return config;
}

/**
 * Notionから過去の計測ログを取得し、KPIを計算する
 */
async function getKpi(dbId, tokenValue) {
    const headers = getAuthHeaders('notionToken', tokenValue);
    
    // 今週の開始日 (日曜日始まり)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 (日) - 6 (土)
    const diffToSunday = dayOfWeek;
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - diffToSunday);
    startOfWeek.setHours(0, 0, 0, 0);
    
    // 今月の開始日
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    // クエリ: 完了日が過去21日間のデータを取得
    const threeWeeksAgo = new Date();
    threeWeeksAgo.setDate(today.getDate() - 21); 
    threeWeeksAgo.setHours(0, 0, 0, 0);

    const filter = {
        and: [
            { property: '計測時間(分)', number: { is_not_empty: true } },
            { property: '完了日', date: { on_or_after: threeWeeksAgo.toISOString().split('T')[0] } }
        ]
    };
    
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ filter: filter })
    });
    
    if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(`Notion ログ取得エラー (${res.status}): ${errorBody.code || '不明なエラー'}`);
    }
    
    const data = await res.json();
    
    let totalWeekMins = 0;
    let totalMonthMins = 0;
    const categoryWeekMins = {};
    
    data.results.forEach(p => {
        const mins = p.properties['計測時間(分)']?.number || 0;
        const completeDateStr = p.properties['完了日']?.date?.start;
        const category = p.properties['カテゴリ']?.select?.name;
        
        if (mins > 0 && completeDateStr) {
            const completeDate = new Date(completeDateStr);
            
            if (completeDate >= startOfWeek) {
                totalWeekMins += mins;
                if (category) categoryWeekMins[category] = (categoryWeekMins[category] || 0) + mins;
            }
            if (completeDate >= startOfMonth) {
                totalMonthMins += mins;
            }
        }
    });

    return {
        totalWeekMins: totalWeekMins,
        totalMonthMins: totalMonthMins,
        categoryWeekMins: categoryWeekMins,
    };
}


// メインのプロキシハンドラ
module.exports = async (req, res) => {
    
    // ===============================================
    // ★★★ CORSヘッダーを最初に設定する ★★★
    // ===============================================
    // 全てのオリジンからのアクセスを許可
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
    // クライアントが送る必要のあるヘッダーを許可リストに入れる
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Notion-Version'); 
    
    // OPTIONSメソッド（プリフライトリクエスト）への対応
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    // ===============================================

    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed.' });
    }
    
    try {
        // req.bodyから必要なパラメータを分解
        const { targetUrl, method, body, tokenKey, tokenValue, customEndpoint, dbId } = req.body;

        // --- 1. カスタムエンドポイントの処理 ---
        if (customEndpoint) {
            if (!dbId || !tokenValue) throw new Error('Missing dbId or tokenValue for custom endpoint.');

            let result;
            if (customEndpoint === 'getKpi') {
                result = await getKpi(dbId, tokenValue);
            } else if (customEndpoint === 'getConfig') {
                result = await getConfig(dbId, tokenValue);
            } else {
                return res.status(400).json({ message: 'Invalid custom endpoint.' });
            }
            
            return res.status(200).json(result);
        }

        // --- 2. 標準プロキシ処理 ---
        if (!targetUrl || !tokenValue) {
            return res.status(400).json({ message: 'Missing targetUrl or tokenValue in request body.' });
        }
        
        // NotionまたはToggl向けのヘッダーを作成
        const headers = getAuthHeaders(tokenKey, tokenValue);

        // 実際のAPIリクエストの実行
        const fetchRes = await fetch(targetUrl, {
            method: method,
            headers: headers,
            body: body ? JSON.stringify(body) : null,
        });

        // 応答をそのままクライアントに返す
        const data = await fetchRes.text();
        return res.status(fetchRes.status).send(data);

    } catch (error) {
        console.error('Proxy Error:', error.message);
        // サーバー側のエラーをクライアントに分かりやすい形式で返す
        return res.status(500).json({ message: `Internal Server Error: ${error.message}` });
    }
};
