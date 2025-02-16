import { createClient } from 'redis';
import { RedisVectorStore } from '@redis/vector';

const client = createClient({
  url: 'redis://redis:6379'
});

client.on('connect', () => console.log('🔌 Redis client connected'));
client.on('error', err => console.error('Redis error:', err));

await client.connect().catch(err => {
  console.error('Connection failed:', err);
  process.exit(1);
});

const vectorStore = new RedisVectorStore(client, {
  indexName: 'images_idx',
  schema: {
    '$.embedding': {
      type: 'VECTOR',
      options: {
        TYPE: 'FLOAT32',
        DIM: 1536,
        DISTANCE_METRIC: 'COSINE'
      }
    }
  }
});

export { vectorStore };
