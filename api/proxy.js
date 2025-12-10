module.exports = async (req, res) => {
  // CORS必須ヘッダ
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  try {
    // body解析
    let body = {};
    if (req.body) {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    }
    
    // テスト用応答（まずこれで動くか確認）
    if (!body.targetUrl && !body.customEndpoint) {
      return res.json({ 
        status: 'Proxy OK!', 
        received: body,
        timestamp: new Date().toISOString()
      });
    }
    
    // Notion/Toggl proxyロジック（後で追加）
    res.status(501).json({ error: 'Full implementation coming soon' });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
