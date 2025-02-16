import { generateDocument, IMAGE_CATEGORIES } from './seedData.js';
import { createClient } from 'redis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cliProgress from 'cli-progress';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track generation statistics
const stats = {
  totalDocuments: 0,
  categories: new Map(),
  attributeTypes: new Map()
};

// Initialize Redis client with index creation
async function initializeRedis() {
  console.log('🔌 Connecting to Redis...');
  const client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy(retries) {
        if (retries > 10) {
          return new Error('Redis connection lost');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  });

  client.on('error', err => console.error('Redis Client Error', err));
  await client.connect();
  console.log('✅ Connected to Redis');
  
  // Create index if it doesn't exist
  try {
    const indexInfo = await client.ft.info('idx:images');
    console.log('📊 Existing index info:', {
      numDocs: indexInfo.numDocs,
      indexName: indexInfo.indexName
    });
  } catch (error) {
    if (error.message.includes('no such index')) {
      console.log('🏗️ Creating vector index...');
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
    } else {
      throw error;
    }
  }
  
  return client;
}

// Load existing test cases
function loadExistingTestCases() {
  const testCasePath = path.join(__dirname, '..', 'src', 'evaluation', 'config', 'test_cases.json');
  try {
    const testCases = JSON.parse(fs.readFileSync(testCasePath, 'utf8'));
    if (!testCases?.testCases?.length) {
      console.error('❌ No test cases found in file');
      return null;
    }
    console.log(`📚 Loaded ${testCases.testCases.length} test cases`);
    return testCases;
  } catch (error) {
    console.error('❌ Error loading test cases:', error);
    return null;
  }
}

// Generate relevant documents based on query intent
async function generateRelevantDocuments(query, expectedAnswer, count = 3, redisClient) {
  const { category, constraints } = analyzeQueryIntent(query, expectedAnswer);
  const docs = [];
  
  for (let i = 0; i < count; i++) {
    const doc = generateDocument(category);
    
    // Ensure required attributes are present
    if (!doc.attributes.some(attr => attr.category === 'style')) {
      doc.attributes.push({
        category: 'style',
        value: constraints.style || IMAGE_CATEGORIES[category].styles[0],
        context: `Primary architectural style of the structure`,
        prominence: 0.9,
        reasoning: `Dominant visual characteristic of the image`
      });
    }

    // Calculate relevance score based on matching attributes
    const matchCount = doc.attributes.filter(attr => 
      expectedAnswer.requiredElements.some(req => 
        req.toLowerCase().includes(attr.value.toLowerCase())
      )
    ).length;
    doc.relevanceScore = 0.5 + (matchCount / expectedAnswer.requiredElements.length) * 0.5;
    
    // Save document to Redis
    const key = `image:${doc.id}`;
    console.log(`\n📄 Storing document ${key}`);
    await redisClient.json.set(key, '$', doc);
    console.log(`✅ Stored ${key} (${doc.description.substring(0, 30)}...)`);
    
    // Update statistics
    stats.totalDocuments++;
    stats.categories.set(category, (stats.categories.get(category) || 0) + 1);
    doc.attributes.forEach(attr => {
      stats.attributeTypes.set(attr.category, (stats.attributeTypes.get(attr.category) || 0) + 1);
    });
    
    docs.push(doc);
  }
  
  return docs;
}

// Extract category and constraints from query
function analyzeQueryIntent(query, expectedAnswer) {
  const queryLower = query.toLowerCase();
  const required = expectedAnswer.requiredElements.map(e => e.toLowerCase());
  
  // Determine category
  let category = 'landscape'; // default
  if (queryLower.includes('building') || queryLower.includes('architecture')) {
    category = 'architecture';
  } else if (queryLower.includes('portrait') || queryLower.includes('person')) {
    category = 'portrait';
  }
  
  // Extract constraints
  const constraints = {
    style: required.find(e => IMAGE_CATEGORIES.architecture.styles.includes(e)),
    lighting: required.find(e => IMAGE_CATEGORIES.portrait.lighting.includes(e)),
    time: required.find(e => IMAGE_CATEGORIES.landscape.times.includes(e)),
    weather: required.find(e => IMAGE_CATEGORIES.landscape.weather.includes(e))
  };
  
  return { category, constraints };
}

// Implement test data for existing test cases
async function implementTestCases() {
  const existingCases = loadExistingTestCases();
  if (!existingCases) {
    console.error('❌ No existing test cases found');
    return null;
  }

  console.log('\n🚀 Starting test case generation');
  console.log(`📋 Processing ${existingCases.testCases.length} test cases`);
  
  console.log('🔌 Initializing Redis...');
  const redisClient = await initializeRedis();
  
  console.log('🏗️ Generating and storing test documents...');
  const totalDocuments = existingCases.testCases.length * 8;
  const progressBar = new cliProgress.SingleBar({
    format: 'Generating Documents |{bar}| {percentage}% | {value}/{total} docs',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
  });
  progressBar.start(totalDocuments, 0);
  
  try {
    const implementedCases = {
      ...existingCases,
      testCases: await Promise.all(existingCases.testCases.map(async (testCase, index) => {
        console.log(`\n🔄 Processing test case ${index + 1}/${existingCases.testCases.length}`);
        console.log(`🔎 Query: "${testCase.query}"`);
        
        // Generate relevant and less relevant documents
        const relevantDocs = await generateRelevantDocuments(
          testCase.query,
          testCase.expectedAnswer,
          5,  // Generate 5 relevant docs
          redisClient
        );
        
        const lessRelevantDocs = await generateRelevantDocuments(
          testCase.query,
          {
            ...testCase.expectedAnswer,
            requiredElements: testCase.expectedAnswer.excludedElements || []
          },
          3,  // Generate 3 less relevant docs
          redisClient
        );
        
        progressBar.increment(relevantDocs.length + lessRelevantDocs.length);
        
        return {
          ...testCase,
          retrievedDocuments: [
            ...relevantDocs,
            ...lessRelevantDocs.map(doc => ({
              ...doc,
              relevanceScore: doc.relevanceScore * 0.4  // More distinct from relevant docs
            }))
          ]
        };
      }))
    };
    
    progressBar.stop();
    
    console.log('\n📊 Generation Statistics:');
    console.log(`- Total Documents: ${stats.totalDocuments}`);
    console.log('- Categories:', Array.from(stats.categories.entries()));
    console.log('- Attribute Types:', Array.from(stats.attributeTypes.entries()));
    
    console.log('\n💾 Saving test cases...');
    saveImplementedTestCases(implementedCases);
    
    await redisClient.quit();
    return implementedCases;
    
  } catch (error) {
    console.error('❌ Error implementing test cases:', error);
    await redisClient.quit();
    throw error;
  }
}

// Save implemented test cases
function saveImplementedTestCases(testCases) {
  const outputPath = path.join(__dirname, '..', 'src', 'evaluation', 'config', 'test_cases.json');
  fs.writeFileSync(outputPath, JSON.stringify(testCases, null, 2));
  console.log(`✅ Updated ${testCases.testCases.length} test cases with generated data`);
  console.log('✅ Test documents have been saved to Redis');
}

// If run directly, implement and save test cases
if (import.meta.url === `file://${process.argv[1]}`) {
  async function main() {
    await implementTestCases();
  }
  try {
    await main();
  } catch (error) {
    console.error('Generation failed:', error);
    process.exit(1);
  }
}
