import { createClient } from 'redis';
import dotenv from 'dotenv';
dotenv.config();

async function viewVectors() {
  console.log('🔌 Connecting to Redis...');
  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', err => console.error('Redis Client Error:', err));
  
  try {
    await client.connect();
    console.log('✅ Connected to Redis\n');
    
    // Verify index exists and get info
    try {
      const indexInfo = await client.ft.info('images_idx');
      console.log('📊 Index Information:');
      console.log('- Name:', indexInfo.indexName);
      console.log('- Total Documents:', indexInfo.numDocs);
      console.log('- Fields:', indexInfo.attributes.map(f => f.identifier).join(', '));
      console.log(''); // Empty line for spacing
    } catch (error) {
      if (error.message.includes('no such index')) {
        console.error('❌ Index "images_idx" not found. Please run generate:test-cases first.');
        return;
      }
      throw error;
    }
    
    // Get Redis keyspace info
    const info = await client.info('keyspace');
    const keyCount = info.match(/db0:keys=(\d+)/)?.[1] || 0;
    console.log('📈 Redis Stats:');
    console.log('- Total Keys:', keyCount);
    console.log(''); // Empty line for spacing
    
    // Search entire vector index with pagination
    const results = await client.ft.search('images_idx', '*', {
      LIMIT: { from: 0, size: 1000 },
      RETURN: ['$', '$.description', '$.category', '$.attributes']
    });

    if (results.total === 0) {
      console.log('❌ No documents found in index');
      return;
    }

    console.log(`🔍 Found ${results.total} vector entries:\n`);
    
    // Show sample documents (first 3)
    const sampleSize = Math.min(3, results.total);
    console.log(`📑 Showing ${sampleSize} sample documents:\n`);
    
    for (let i = 0; i < sampleSize; i++) {
      const doc = results.documents[i];
      const value = JSON.parse(doc.value.$);
      console.log(`📄 Document ${i + 1}/${sampleSize}: ${doc.id}`);
      console.log(`📝 Description: ${value.description}`);
      console.log(`🏷️  Category: ${value.category || 'general'}`);
      console.log('📊 Attributes:');
      (value.attributes || []).forEach(attr => {
        console.log(`  - ${attr.category}: ${attr.value} (prominence: ${attr.prominence.toFixed(2)})`);
      });
      console.log('---\n');
    }

    // Print summary statistics
    const categories = new Map();
    const attributeTypes = new Map();
    
    results.documents.forEach(doc => {
      const value = JSON.parse(doc.value.$);
      categories.set(value.category || 'general', (categories.get(value.category || 'general') || 0) + 1);
      (value.attributes || []).forEach(attr => {
        attributeTypes.set(attr.category, (attributeTypes.get(attr.category) || 0) + 1);
      });
    });
    
    console.log('📊 Document Statistics:');
    console.log('Categories Distribution:');
    categories.forEach((count, category) => {
      console.log(`  - ${category}: ${count} documents (${(count/results.total*100).toFixed(1)}%)`);
    });
    
    console.log('\nAttribute Types Distribution:');
    attributeTypes.forEach((count, type) => {
      console.log(`  - ${type}: ${count} occurrences`);
    });

  } catch (error) {
    console.error('❌ Error viewing vectors:', error);
  } finally {
    await client.quit();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  viewVectors().catch(console.error);
}
