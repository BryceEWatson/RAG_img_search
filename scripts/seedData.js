import axios from 'axios';
import 'dotenv/config';
import cliProgress from 'cli-progress';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import pkg from '@faker-js/faker';
const { faker } = pkg;

dotenv.config();

// Image categories and their associated attributes
export const IMAGE_CATEGORIES = {
  'architecture': {
    styles: ['modern', 'neoclassical', 'gothic', 'art_deco', 'brutalist'],
    materials: ['glass', 'marble', 'concrete', 'steel', 'brick'],
    compositions: ['symmetrical', 'asymmetrical', 'geometric', 'organic'],
    features: ['columns', 'arches', 'domes', 'spires', 'facades']
  },
  'landscape': {
    environments: ['coastal', 'mountain', 'forest', 'desert', 'urban'],
    times: ['sunrise', 'daylight', 'sunset', 'night'],
    weather: ['clear', 'cloudy', 'stormy', 'misty', 'snowy'],
    features: ['waterfall', 'river', 'lake', 'valley', 'peak']
  },
  'portrait': {
    styles: ['candid', 'studio', 'environmental', 'documentary'],
    lighting: ['natural', 'studio', 'dramatic', 'soft'],
    compositions: ['headshot', 'full_body', 'three_quarter', 'profile'],
    moods: ['serious', 'joyful', 'contemplative', 'dramatic']
  }
};

// Initialize Redis client
async function initializeRedis() {
  console.log('🔌 Connecting to Redis...');
  const client = createClient({
    url: process.env.REDIS_URL
  });

  client.on('error', err => console.error('Redis Client Error:', err));
  
  try {
    await client.connect();
    console.log('✅ Connected to Redis');
    return client;
  } catch (error) {
    console.error('❌ Failed to connect to Redis:', error);
    throw error;
  }
}

// Clear existing data
async function clearData(client) {
  console.log('🧹 Clearing existing data...');
  
  try {
    // Try to drop index if it exists
    try {
      await client.ft.dropindex('idx:images');
      console.log('✅ Dropped existing index');
    } catch (error) {
      if (!error.message.includes('no such index')) {
        console.warn('⚠️ Error dropping index:', error.message);
      } else {
        console.log('ℹ️ No existing index to drop');
      }
    }

    // Delete all image keys
    let cursor = 0;
    let deletedKeys = 0;
    
    do {
      const result = await client.scan(cursor, {
        MATCH: 'image:*',
        COUNT: 100
      });
      cursor = result.cursor;
      
      if (result.keys.length > 0) {
        await client.del(result.keys);
        deletedKeys += result.keys.length;
      }
    } while (cursor !== 0);

    console.log(`✅ Cleared ${deletedKeys} keys`);
    return true;
  } catch (error) {
    console.error('❌ Error clearing data:', error);
    return false;
  }
}

// Create vector index
async function createIndex(client) {
  console.log('🏗️ Creating vector index...');
  
  try {
    await client.ft.create('idx:images', {
      '$.description': {
        type: 'TEXT',
        SORTABLE: true
      },
      '$.category': {
        type: 'TAG',
        SORTABLE: true
      },
      '$.embedding': {
        type: 'VECTOR',
        ALGORITHM: 'FLAT',
        TYPE: 'FLOAT32',
        DIM: 1536,
        DISTANCE_METRIC: 'COSINE'
      }
    }, {
      ON: 'JSON',
      PREFIX: 'image:'
    });
    
    console.log('✅ Vector index created successfully');
    return true;
  } catch (error) {
    if (error.message.includes('Index already exists')) {
      console.log('ℹ️ Index already exists');
      return true;
    }
    console.error('❌ Failed to create index:', error);
    return false;
  }
}

// Generate random attributes for a given category
function generateAttributes(category) {
  const categoryData = IMAGE_CATEGORIES[category] || IMAGE_CATEGORIES['landscape'];
  const attributes = [];
  
  // Helper to generate a random attribute
  const generateAttribute = (category, values, contextPrefix) => ({
    category,
    value: values[Math.floor(Math.random() * values.length)],
    context: `${contextPrefix} shows ${values[Math.floor(Math.random() * values.length)]} characteristics`,
    prominence: Math.random() * 0.5 + 0.5, // Random between 0.5 and 1.0
    reasoning: `Clear presence of ${category} elements in the image`
  });
  
  // Add attributes based on category
  Object.entries(categoryData).forEach(([attrCategory, values]) => {
    attributes.push(generateAttribute(attrCategory, values, 'Image'));
  });
  
  return attributes;
}

// Generate analysis metadata
function generateAnalysisMetadata() {
  const resolutions = ['12MP', '16MP', '20MP', '24MP', '32MP'];
  return {
    modelVersion: 'claude-3-5-sonnet-20240620',
    analysisDate: new Date().toISOString(),
    mimeType: 'image/webp',
    resolution: resolutions[Math.floor(Math.random() * resolutions.length)]
  };
}

// Generate a synthetic document
export function generateDocument(category) {
  const attributes = generateAttributes(category);
  const analysisMetadata = generateAnalysisMetadata();
  
  // Generate description based on attributes
  const description = attributes
    .map(attr => `${attr.value.replace('_', ' ')} ${attr.category.replace('_', ' ')}`)
    .join(', ');
  
  return {
    id: `img_${Math.random().toString(36).substr(2, 9)}`,
    description,
    category,
    embedding: Array(1536).fill(0).map(() => Math.random()),
    attributes,
    analysisMetadata,
    relevanceScore: Math.random() * 0.5 + 0.5 // Random between 0.5 and 1.0
  };
}

// Create progress bar
const bar = new cliProgress.SingleBar({
  format: 'Seeding Progress |{bar}| {percentage}% | {value}/{total} items',
  barCompleteChar: '█',
  barIncompleteChar: '░',
  hideCursor: true
});

// Main seeding function
async function seedData(startIndex = 0, count = 10, clearExisting = false) {
  console.log('\n🌱 Starting data seeding process...');
  
  let client;
  try {
    client = await initializeRedis();
    
    // Clear existing data if requested
    if (clearExisting) {
      const cleared = await clearData(client);
      if (!cleared) {
        throw new Error('Failed to clear existing data');
      }

      // Create fresh index
      const indexCreated = await createIndex(client);
      if (!indexCreated) {
        throw new Error('Failed to create index');
      }
    }

    // If we're only clearing data, stop here
    if (count === 0) {
      console.log('✅ Data cleared successfully');
      return;
    }

    // Seed new data
    console.log(`\n📦 Seeding ${count} items in batches of 50`);
    bar.start(count, 0);

    const categories = Object.keys(IMAGE_CATEGORIES);
    const batchSize = 50;
    const batches = Math.ceil(count / batchSize);

    for (let b = 0; b < batches; b++) {
      const batchStart = b * batchSize;
      const batchCount = Math.min(batchSize, count - batchStart);
      const promises = [];

      for (let i = 0; i < batchCount; i++) {
        const category = faker.helpers.arrayElement(categories);
        const doc = generateDocument(category);
        const key = `image:${doc.id}`;
        promises.push(client.json.set(key, '$', doc));
      }

      await Promise.all(promises);
      bar.update(batchStart + batchCount);
    }

    bar.stop();
    console.log('\n✅ Seeding completed successfully!');

    // Get Redis info
    const info = await client.info();
    const uptime = info.split('\n').find(line => line.startsWith('uptime_in_seconds:'))?.split(':')[1];
    
    console.log('\n🏥 Redis Status:');
    console.log('- Connected: true');
    console.log(`- Uptime: ${uptime} seconds`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    if (client) {
      await client.quit();
    }
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const startIndex = parseInt(process.argv[2] || '0', 10);
  const count = parseInt(process.argv[3] || '10', 10);
  const clearExisting = process.argv[4] === 'true';
  
  seedData(startIndex, count, clearExisting).catch(error => {
    process.exit(1);
  });
}
