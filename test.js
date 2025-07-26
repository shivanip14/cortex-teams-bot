require('dotenv').config({ path: 'env/.env.dev' });
const JWTGenerator = require('./jwtGenerator');

const jwt = new JWTGenerator();
const jwtToken = jwt.getToken();
const fetch = require('node-fetch');

const url = 'https://tdztiko-pvb41526.snowflakecomputing.com/api/v2/cortex/agent:run';

const headers = {
  'Authorization': `Bearer ${jwtToken}`,
  'Content-Type': 'application/json',
};

const payload = {
  model: 'llama3.1-70b',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'What are the payment terms for Snowtires?'
        }
      ]
    }
  ],
  tools: [
    {
      tool_spec: {
        type: 'cortex_search',
        name: 'vehicles_info_search'
      }
    },
    {
      tool_spec: {
        type: 'cortex_analyst_text_to_sql',
        name: 'supply_chain'
      }
    }
  ],
  tool_resources: {
    vehicles_info_search: {
      name: 'DASH_DB.DASH_SCHEMA.vehicles_info',
      max_results: 1,
      title_column: 'title',
      id_column: 'relative_path'
    },
    supply_chain: {
      semantic_model_file: '@DASH_DB.DASH_SCHEMA.DASH_SEMANTIC_MODELS/support_tickets_semantic_model.yaml'
    }
  }
};

fetch(url, {
  method: 'POST',
  headers: headers,
  body: JSON.stringify(payload)
})
  .then(res => {
    if (!res.ok) {
      console.error('HTTP Error:', res.status);
      return;
    }

    let buffer = '';
    res.body.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Save incomplete line

      for (let line of lines) {
        line = line.trim();
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            const content = data?.delta?.content;
            if (Array.isArray(content)) {
              for (const part of content) {
                if (part.type === 'text') {
                  process.stdout.write(part.text);
                }
              }
            }
          } catch (e) {
            // ignore bad json
          }
        }
      }
    });

    res.body.on('end', () => {
      console.log('\n\n[Stream complete]');
    });
  })
  .catch(err => {
    console.error('Fetch error:', err);
  });