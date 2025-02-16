import { createClient } from 'redis';
import dotenv from 'dotenv';
dotenv.config();

async function validate() {
  console.log('🔌 Connecting to Redis...');
  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', err => console.error('Redis Client Error:', err));
  
  try {
    await client.connect();
    console.log('✅ Connected to Redis\n');
    
    // Check Redis connection info
    const info = await client.info();
    const uptime = info.split('\n').find(line => line.startsWith('uptime_in_seconds:'))?.split(':')[1];
    console.log('🏥 Redis Status:');
    console.log('- Connected: true');
    console.log(`- Uptime: ${uptime} seconds\n`);
    
    // Verify index exists and structure
    try {
      const indexInfo = await client.ft.info('idx:images');
      console.log('🔍 Index Validation:');
      console.log('- Name:', indexInfo.indexName);
      console.log('- Documents:', indexInfo.numDocs);
      console.log('- Fields:', indexInfo.attributes.map(a => a.identifier).join(', '));
      console.log(''); // Empty line for spacing
    } catch (error) {
      if (error.message.includes('no such index')) {
        console.error('❌ Index "idx:images" not found');
        return;
      }
      throw error;
    }
    
    // Get sample document
    const sample = await client.ft.search('idx:images', '*', {
      LIMIT: { from: 0, size: 1 },
      RETURN: ['$']
    });
    
    if (sample.total > 0) {
      console.log('📄 Sample Document Structure:');
      const doc = JSON.parse(sample.documents[0].value.$);
      console.log('- ID:', sample.documents[0].id);
      console.log('- Category:', doc.category);
      console.log('- Description:', doc.description);
      console.log('- Attributes:', doc.attributes.length);
      console.log('- Has Embedding:', !!doc.embedding);
      
      // Validate embedding dimension
      if (doc.embedding) {
        console.log('- Embedding Dimension:', doc.embedding.length);
        if (doc.embedding.length !== 1536) {
          console.warn('⚠️ Warning: Embedding dimension is not 1536');
        }
      }
    } else {
      console.log('❌ No documents found in index');
    }
    
  } catch (error) {
    console.error('❌ Validation Error:', error);
  } finally {
    await client.quit();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validate().catch(console.error);
}
