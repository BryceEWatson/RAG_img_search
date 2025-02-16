import { createClient, SchemaFieldTypes } from 'redis';

const client = createClient({
  url: 'redis://redis:6379'
});

client.on('connect', () => console.log('🔌 Redis client connected'));
client.on('error', err => console.error('Redis error:', err));

const INDEX_NAME = 'images_idx';
const PREFIX = 'image:';

async function createIndex() {
  console.log('Creating Redis index...');
  try {
    if (!client.isOpen) await client.connect();
    console.log('Attempting to drop existing index...');
    await client.ft.dropIndex(INDEX_NAME);
    console.log('Existing index dropped');
  } catch (err) {
    console.log('No existing index to drop:', err.message);
  }

  const schema = {
    '$.embedding': {
      type: SchemaFieldTypes.VECTOR,
      AS: 'embedding',
      TYPE: 'FLOAT32',
      DIM: 1536,
      DISTANCE_METRIC: 'COSINE'
    },
    '$.description': {
      type: SchemaFieldTypes.TEXT,
      AS: 'description'
    },
    '$.metadata': {
      type: SchemaFieldTypes.TEXT,
      AS: 'metadata'
    }
  };

  console.log('Creating new index with schema:', JSON.stringify(schema, null, 2));
  try {
    if (!client.isOpen) await client.connect();
    await client.ft.create(INDEX_NAME, schema, {
      ON: 'JSON',
      PREFIX
    });
    console.log('✅ Vector index created successfully');
  } catch (err) {
    console.error('❌ Failed to create index:', err);
    throw new Error(`Index creation failed: ${err.message}`);
  }
}

class VectorStore {
  constructor() {
    this.client = client;
    this.indexName = INDEX_NAME;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    console.log('🏁 Starting Redis initialization');
    try {
      await this.client.connect();
      console.log('🔗 Redis connection established');
      
      console.log(`🔎 Checking index existence: ${this.indexName}`);
      try {
        await this.client.ft.info(this.indexName);
        console.log('✅ Using existing index');
      } catch (err) {
        if (err.message.includes('Unknown Index name')) {
          console.log('⚙️  Creating new index...');
          await createIndex();
        } else {
          throw err;
        }
      }
      this.initialized = true;
    } catch (err) {
      console.error('‼️ Initialization failed:', err);
      throw err;
    }
  }

  async addDocuments(documents) {
    console.log(`Adding ${documents.length} documents to Redis...`);
    for (const doc of documents) {
      const key = `${PREFIX}${doc.id}`;
      try {
        await this.client.json.set(key, '$', doc);
        console.log(`Added document ${key}`);
      } catch (err) {
        console.error(`Failed to add document ${key}:`, err);
        throw err;
      }
    }
  }

  async search(queryVector, k = 5) {
    console.log(`Searching for ${k} nearest neighbors...`);
    const query = `*=>[KNN ${k} @embedding $BLOB AS score]`;
    try {
      const results = await this.client.ft.search(
        this.indexName,
        query,
        {
          PARAMS: {
            BLOB: Buffer.from(new Float32Array(queryVector).buffer)
          },
          SORTBY: 'score',
          DIALECT: 2,
          RETURN: ['description', 'metadata', 'score']
        }
      );
      console.log(`Found ${results.total} results`);
      return results;
    } catch (err) {
      console.error('Search failed:', err);
      throw err;
    }
  }
}

export const vectorStore = new VectorStore();

vectorStore.initialize().catch(err => {
  console.error('‼️ Critical initialization error:', err);
  process.exit(1);
});
