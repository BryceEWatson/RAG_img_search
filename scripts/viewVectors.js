// Load env first
import 'dotenv/config';
import { createClient } from 'redis';
import dns from 'dns';

// Define Redis connection options with Docker networking
const REDIS_URLS = [
  'redis://redis:6379',  // Docker service name
  'redis://localhost:6379',
  'redis://127.0.0.1:6379',
  'redis://host.docker.internal:6379'
].filter(Boolean);

console.log(' Script starting...');
console.log(' Environment:', {
  NODE_ENV: process.env.NODE_ENV,
  REDIS_URLS: REDIS_URLS,
});

// Add connection timeout wrapper
const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout])
    .finally(() => clearTimeout(timeoutId));
};

async function tryConnect(url) {
  console.log(`⏳ Trying Redis connection to ${url}...`);
  const client = createClient({ 
    url: url,
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: false
    }
  });

  client.on('error', (err) => {
    console.log(`❌ Connection error for ${url}:`, err.message);
  });

  try {
    await withTimeout(client.connect(), 5000);
    console.log(`✅ Connected to ${url}`);
    return client;
  } catch (error) {
    console.log(`❌ Failed to connect to ${url}:`, error.message);
    await client.quit().catch(() => {});
    return null;
  }
}

async function viewVectors() {
  console.log(' Starting Redis connection attempts...');
  let client = null;
  
  // Try each Redis URL until one works
  for (const url of REDIS_URLS) {
    client = await tryConnect(url);
    if (client) break;
  }

  if (!client) {
    console.error(' Failed to connect to Redis on any URL');
    process.exit(1);
  }

  try {
    const ping = await client.ping();
    console.log(' Redis ping:', ping);

    console.log(' Network configuration:');
    console.log('- DNS Servers:', JSON.stringify(dns.getServers()));
    console.log('- Hosts:', require('os').networkInterfaces());
    
    console.log(' Testing Redis connectivity...');
    try {
      const pingResponse = await client.ping();
      console.log(' Redis Ping:', pingResponse);
    } catch (error) {
      console.error(' Redis Ping Failed:', error);
      process.exit(1);
    }
    
    try {
      const indexInfo = await client.ft.info('images_idx');
      console.log(' Index Information:');
      console.log('- Name:', indexInfo.indexName);
      console.log('- Total Documents:', indexInfo.numDocs);
      console.log('- Fields:', indexInfo.attributes.map(f => f.identifier).join(', '));
      console.log(''); 
    } catch (error) {
      if (error.message.includes('no such index')) {
        console.error(' Index "images_idx" not found. Please run generate:test-cases first.');
        return;
      }
      throw error;
    }
    
    console.log(' Checking Redis index health...');
    const indices = await client.sendCommand(['FT._LIST']);
    if (!indices.includes('images_idx')) {
      console.log(' Missing vector index - run database migrations first');
      process.exit(1);
    }

    const info = await client.info('keyspace');
    const keyCount = info.match(/db0:keys=(\d+)/)?.[1] || 0;
    console.log(' Redis Stats:');
    console.log('- Total Keys:', keyCount);
    console.log(''); 
    
    console.time(' Query execution time');
    const results = await client.ft.search('images_idx', '*', {
      LIMIT: { from: 0, size: 1000 },
      RETURN: ['$', '$.description', '$.category', '$.attributes']
    });
    console.timeEnd(' Query execution time');

    if (results.total === 0) {
      console.log('\n No vectors found in index');
      process.exit(0);
    }

    console.log(`\n Found ${results.total} vector entries:\n`);
    
    const sampleSize = Math.min(3, results.total);
    console.log(`\n Showing ${sampleSize} sample documents:\n`);
    
    for (let i = 0; i < sampleSize; i++) {
      const doc = results.documents[i];
      const value = JSON.parse(doc.value.$);
      console.log(`\n Document ${i + 1}/${sampleSize}: ${doc.id}`);
      console.log(` Description: ${value.description}`);
      console.log(` Category: ${value.category || 'general'}`);
      console.log(' Attributes:');
      (value.attributes || []).forEach(attr => {
        console.log(`  - ${attr.category}: ${attr.value} (prominence: ${attr.prominence.toFixed(2)})`);
      });
      console.log('---\n');
    }

    const categories = new Map();
    const attributeTypes = new Map();
    let sumScore = 0;
    
    results.documents.forEach(doc => {
      const value = JSON.parse(doc.value.$);
      categories.set(value.category || 'general', (categories.get(value.category || 'general') || 0) + 1);
      (value.attributes || []).forEach(attr => {
        attributeTypes.set(attr.category, (attributeTypes.get(attr.category) || 0) + 1);
      });
      sumScore += value.score;
    });
    
    const avgScore = sumScore / results.total;
    
    console.log(' Document Statistics:');
    console.log('Categories Distribution:');
    categories.forEach((count, category) => {
      console.log(`  - ${category}: ${count} documents (${(count/results.total*100).toFixed(1)}%)`);
    });
    
    console.log('\nAttribute Types Distribution:');
    attributeTypes.forEach((count, type) => {
      console.log(`  - ${type}: ${count} occurrences`);
    });

    console.log(`\n Found ${results.total} vectors with average score of ${avgScore.toFixed(2)}`);

  } catch (error) {
    console.error(' Error in viewVectors:', error.message);
    process.exit(1);
  } finally {
    if (client) {
      await client.quit().catch(() => {});
    }
  }
}

// Ensure proper async execution
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(' Running viewVectors directly...');
  viewVectors().catch(error => {
    console.error(' Fatal error:', error.message);
    process.exit(1);
  });
}
