module.exports = async function(req, res) {
  console.log('🔥 PROXY CALLED:', req.method);
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method === 'GET') { res.json({ status: 'Proxy OK!' }); return; }

  try {
    const body = req.body || {};
    
    // Notion API
    if (body.tokenKey === 'notionToken') {
      const headers = {
        'Authorization': `Bearer ${body.tokenValue}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      };
      const upstream = await fetch(body.targetUrl, {
        method: body.method || 'GET',
        headers,
        body: body.body ? JSON.stringify(body.body) : undefined
      });
      
      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      res.status(upstream.status).json(data);
      return;
    }
    
    // Toggl API
    if (body.tokenKey === 'togglApiToken') {
      const basicAuth = Buffer.from(`${body.tokenValue}:api_token`).toString('base64');
      const headers = {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/json'
      };
      
      const upstream = await fetch(body.targetUrl, {
        method: body.method || 'GET',
        headers,
        body: body.body ? JSON.stringify(body.body) : undefined
      });
      
      const text = await upstream.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
      res.status(upstream.status).json(data);  // ✅ json()のみ！
      return;
    }
    
    res.status(400).json({ error: 'tokenKey required' });
  } catch (err) {
    console.error('💥 PROXY ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};
