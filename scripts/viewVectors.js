import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const redisClient = createClient({
  url: process.env.REDIS_URL
});

async function listVectors() {
  try {
    await redisClient.connect();
    
    // Search all vectors in the index
    const results = await redisClient.ft.search('images_idx', '*', {
      LIMIT: { from: 0, size: 50 },
      RETURN: ['metadata', 'embedding']
    });

    console.log(`Found ${results.total} vector entries:\n`);
    results.documents.forEach((doc, index) => {
      console.log(`Entry ${index + 1}:`);
      console.log(`Key: ${doc.id}`);
      console.log(`Metadata: ${doc.value.metadata}`);
      console.log(`Embedding exists: ${!!doc.value.embedding ? 'Yes' : 'Missing'}`);
      console.log('---\n');
    });

    const withEmbeddings = results.documents.filter(d => d.value.embedding).length;
    console.log(`Embedding presence: ${withEmbeddings}/${results.total} entries have embeddings`);
  } catch (error) {
    console.error('Error listing vectors:', error);
  } finally {
    await redisClient.quit();
  }
}

listVectors();
