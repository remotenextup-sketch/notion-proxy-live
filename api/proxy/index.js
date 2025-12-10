// Vercel プロジェクト: /api/proxy/index.js (完全版)

const fetch = require('node-fetch');
const NOTION_VERSION = '2022-06-28';
const Buffer = require('buffer').Buffer;

// =========================================================================
// メインのLambda関数 (module.exports)
// =========================================================================

module.exports = async (req, res) => {
    // ----------------------------------------------------
    // 0. CORS と OPTIONS 対応
    // ----------------------------------------------------
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // ----------------------------------------------------
    // 1. GETリクエストの回避 (最優先の修正)
    // ----------------------------------------------------
    if (req.method === 'GET') {
        console.log('WARN: Unexpected GET request received. Returning 404 to avoid 401/405 crash.');
        res.status(404).json({ message: "Unsupported GET request." });
        return;
    }
    
    // POST以外のリクエストを拒否
    if (req.method !== 'POST') {
        res.status(405).json({ message: 'Method Not Allowed.' });
        return;
    }
    
    let body;
    try {
        body = req.body;
    } catch (e) {
        res.status(400).json({ message: 'Invalid JSON body.' });
        return;
    }
    
    const { customEndpoint, targetUrl, method, tokenKey, tokenValue } = body;
    
    // ----------------------------------------------------
    // 2. 認証情報の事前チェック
    // ----------------------------------------------------
    if (!tokenValue) {
        res.status(401).json({ message: "Token value missing in request body." });
        return;
    }

    // ----------------------------------------------------
    // 3. カスタムエンドポイントの処理
    // ----------------------------------------------------
    if (customEndpoint) {
        if (customEndpoint === 'getConfig') {
            try {
                const configData = await getNotionDbConfig(body.dbId, tokenValue); 
                res.status(200).json(configData);
            } catch (error) {
                console.error(`Custom Endpoint Error (getConfig): ${error.message}`);
                res.status(500).json({ message: `Config Error: ${error.message}` });
            }
            return;
        } 
        
        if (customEndpoint === 'getKpi') {
            try {
                const kpiData = await getNotionKpi(body.dataSourceId, tokenValue); 
                res.status(200).json(kpiData);
            } catch (error) {
                console.error(`Custom Endpoint Error (getKpi): ${error.message}`);
                res.status(500).json({ message: `KPI Error: ${error.message}` });
            }
            return;
        }

        if (customEndpoint === 'startTogglTracking') {
            try {
                const togglResponse = await startTogglTracking(body.tokenValue, body.workspaceId, body.description);
                res.status(200).json(togglResponse);
            } catch (error) {
                console.error(`Custom Endpoint Error (startTogglTracking): ${error.message}`);
                res.status(500).json({ message: `Toggl Start Error: ${error.message}` });
            }
            return;
        }
        
        res.status(400).json({ message: "Invalid custom endpoint." });
        return;
    }

    // ----------------------------------------------------
    // 4. 標準プロキシ処理
    // ----------------------------------------------------
    
    if (!targetUrl) {
        res.status(400).json({ message: 'Missing targetUrl for standard proxy.' });
        return;
    }
    
    const isNotion = targetUrl.includes('notion.com');
    const isToggl = targetUrl.includes('toggl.com');
    
    let headers = { 'Content-Type': 'application/json' };
    
    if (tokenKey === 'notionToken') {
        headers['Authorization'] = `Bearer ${tokenValue}`;
        headers['Notion-Version'] = NOTION_VERSION;
    } else if (tokenKey === 'togglApiToken') {
        const authBase64 = Buffer.from(tokenValue + ':api_token').toString('base64');
        headers['Authorization'] = `Basic ${authBase64}`;
    } else {
        res.status(400).json({ message: 'Invalid tokenKey specified.' });
        return;
    }

    try {
        const fetchOptions = {
            method: method,
            headers: headers
        };
        
        if (method !== 'GET' && method !== 'DELETE' && body.body) {
            fetchOptions.body = JSON.stringify(body.body);
        }

        const apiResponse = await fetch(targetUrl, fetchOptions);

        const data = await apiResponse.text();
        res.status(apiResponse.status).send(data);

    } catch (error) {
        console.error('Proxy Fetch Error:', error);
        res.status(500).json({ message: 'Internal Server Error during proxy execution.' });
    }
};

// =========================================================================
// ヘルパー関数の定義 (カスタムエンドポイントの実装)
// =========================================================================

/**
 * Notion DBのプロパティ情報を取得し、カテゴリ、部門、データソースIDを抽出します。
 */
async function getNotionDbConfig(dbId, token) {
    const url = `https://api.notion.com/v1/databases/${dbId}`;
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION
        }
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notion API Error (${response.status}): ${errorText}`);
    }

    const dbData = await response.json();
    
    const categories = dbData.properties['カテゴリ']?.select?.options?.map(opt => opt.name) || [];
    const departments = dbData.properties['部門']?.multi_select?.options?.map(opt => opt.name) || [];
    
    // データソースIDはDBページのURLの最後の部分（dbIdとは異なる可能性あり）
    // Notion API v1ではデータソースIDを直接取得する一般的な方法は廃止されました。
    // DB IDをそのままデータソースIDとして使用するか、クライアント側で処理を簡略化します。
    // ここでは便宜上、DB IDをデータソースIDとして返します。
    const dataSourceId = dbId; 

    return { 
        categories, 
        departments, 
        dataSourceId 
    };
}

/**
 * Notion DBからKPIデータを集計します (過去の動作に基づくロジックを再現)。
 */
async function getNotionKpi(dataSourceId, token) {
    // dataSourceIdをDB IDとして使用します
    const queryUrl = `https://api.notion.com/v1/databases/${dataSourceId}/query`;
    
    const dateToday = new Date();
    const dateStartOfWeek = new Date(dateToday.setDate(dateToday.getDate() - dateToday.getDay()));
    const dateStartOfMonth = new Date(dateToday.getFullYear(), dateToday.getMonth(), 1);

    const filterBase = {
        property: '完了日',
        date: { is_not_empty: true } // 完了日があるものを対象とする
    };
    
    // 今週のタスクフィルタ (完了日が今週以降)
    const filterWeek = {
        ...filterBase,
        date: { on_or_after: dateStartOfWeek.toISOString().split('T')[0] }
    };

    // 今月のタスクフィルタ (完了日が今月以降)
    const filterMonth = {
        ...filterBase,
        date: { on_or_after: dateStartOfMonth.toISOString().split('T')[0] }
    };
    
    // 集計実行関数
    const fetchTasks = async (filter) => {
        const response = await fetch(queryUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': NOTION_VERSION,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ filter: filter })
        });
        if (!response.ok) throw new Error(`KPI Query failed: ${response.status}`);
        return (await response.json()).results;
    };

    const [tasksWeek, tasksMonth] = await Promise.all([
        fetchTasks(filterWeek),
        fetchTasks(filterMonth)
    ]);

    // 集計ロジック
    const aggregateTime = (tasks) => {
        let totalMins = 0;
        const categoryWeekMins = {};

        tasks.forEach(task => {
            const timeProperty = task.properties['作業時間']?.number || 0;
            const categoryName = task.properties['カテゴリ']?.select?.name || 'その他';
            
            const mins = Math.round(timeProperty); // 時間を分単位で取得
            totalMins += mins;

            categoryWeekMins[categoryName] = (categoryWeekMins[categoryName] || 0) + mins;
        });

        return { totalMins, categoryWeekMins };
    };

    const aggWeek = aggregateTime(tasksWeek);
    const aggMonth = aggregateTime(tasksMonth);

    return {
        totalWeekMins: aggWeek.totalMins,
        totalMonthMins: aggMonth.totalMins,
        categoryWeekMins: aggWeek.categoryWeekMins
    };
}


/**
 * Togglで実行中のタスクを停止し、新しいタスクの計測を開始します。
 */
async function startTogglTracking(token, workspaceId, description) {
    const authBase64 = Buffer.from(token + ':api_token').toString('base64');
    const headers = {
        'Authorization': `Basic ${authBase64}`,
        'Content-Type': 'application/json'
    };
    
    // 1. 実行中のタスクを停止する (存在する場合)
    const stopUrl = 'https://api.track.toggl.com/api/v9/time_entries/current';
    try {
        const runningEntry = await fetch(stopUrl, { method: 'GET', headers: headers });
        const entryData = await runningEntry.json();

        if (entryData && entryData.id) {
            // 実行中のエントリIDを取得して停止
            const stopEntryUrl = `https://api.track.toggl.com/api/v9/time_entries/${entryData.id}/stop`;
            await fetch(stopEntryUrl, { method: 'PATCH', headers: headers });
        }
    } catch (e) {
        // 停止に失敗しても、新しい開始は試みる
        console.warn('Failed to stop current Toggl entry, proceeding to start new one.', e.message);
    }
    
    // 2. 新しいタスクの計測を開始
    const startUrl = 'https://api.track.toggl.com/api/v9/time_entries';
    const newEntryPayload = {
        description: description,
        workspace_id: parseInt(workspaceId),
        start: new Date().toISOString(),
        created_with: 'Notion-Toggl-Timer'
    };

    const startResponse = await fetch(startUrl, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(newEntryPayload)
    });

    if (!startResponse.ok) {
        const errorText = await startResponse.text();
        throw new Error(`Toggl Start API Error (${startResponse.status}): ${errorText}`);
    }

    return startResponse.json();
}
