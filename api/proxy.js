module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // GET時は疎通確認用（現状維持）
  if (req.method === 'GET') {
    res.json({
      status: 'Proxy OK!',
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (req.method !== 'POST' && req.method !== 'PATCH') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    let body;
    if (req.method === 'POST' || req.method === 'PATCH') {
      body = req.body || {};
    }

    // customEndpointがある場合はサーバー側処理
    if (body.customEndpoint) {
      const result = await handleCustomEndpoint(body.customEndpoint, body);
      res.json(result);
      return;
    }

    // 汎用プロキシ：Notion/Toggl API転送
    const { targetUrl, method, body: requestBody } = body;
    
    if (!targetUrl || !method) {
      res.status(400).json({ error: 'targetUrl and method are required' });
      return;
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    // トークン判定
    if (body.tokenKey === 'notionToken') {
      headers['Authorization'] = `Bearer ${body.tokenValue}`;
      headers['Notion-Version'] = '2022-06-28';
    } else if (body.tokenKey === 'togglApiToken') {
      const basic = Buffer.from(`${body.tokenValue}:api_token`).toString('base64');
      headers['Authorization'] = `Basic ${basic}`;
    }

    const upstreamRes = await fetch(targetUrl, {
      method: method.toUpperCase(),
      headers,
      body: requestBody ? JSON.stringify(requestBody) : undefined
    });

    const text = await upstreamRes.text();
    
    // JSONならパースして返す（Notionエラー対応）
    try {
      res.status(upstreamRes.status).json(JSON.parse(text));
    } catch {
      res.status(upstreamRes.status).send(text);
    }

  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};

// カスタムエンドポイント処理
async function handleCustomEndpoint(endpoint, params) {
  const { dbId, dataSourceId, tokenValue } = params;

  if (endpoint === 'getConfig') {
    // DBのプロパティ一覧取得 → カテゴリ/部門抽出
    const propsRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/properties`, {
      headers: {
        'Authorization': `Bearer ${tokenValue}`,
        'Notion-Version': '2022-06-28'
      }
    });
    const props = await propsRes.json();

    const categories = [];
    const departments = [];
    
    Object.entries(props.results || {}).forEach(([key, prop]) => {
      if (prop.select && prop.select.options) {
        categories.push(...prop.select.options.map(opt => opt.name));
      }
      if (prop.multi_select && prop.multi_select.options) {
        departments.push(...prop.multi_select.options.map(opt => opt.name));
      }
    });

    return {
      dataSourceId: dbId,
      categories: [...new Set(categories)], // 重複除去
      departments: [...new Set(departments)]
    };
  }

  if (endpoint === 'getKpi') {
    // KPI計算ロジック（仮実装）
    return {
      totalWeekMins: 120,
      totalMonthMins: 480,
      categoryWeekMins: { '開発': 60, 'デザイン': 40, 'ミーティング': 20 }
    };
  }

  if (endpoint === 'startTogglTracking') {
    // Toggl開始（フロントのapiFetchで既に処理されるので仮実装）
    return { success: true, message: 'Tracking started' };
  }

  throw new Error(`Unknown endpoint: ${endpoint}`);
}
