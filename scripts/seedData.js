import axios from 'axios';
import 'dotenv/config';
import cliProgress from 'cli-progress';
import { createClient } from 'redis';

const API_URL = 'http://localhost:3000';
const SEED_ENDPOINT = `${API_URL}/seed`;

// Create progress bar
const bar = new cliProgress.SingleBar({
  format: 'Seeding Progress |{bar}| {percentage}% | {value}/{total} items',
  barCompleteChar: '█',
  barIncompleteChar: '░',
  hideCursor: true
});

async function seedWithProgress() {
  try {
    console.log('\n🌱 Starting data seeding process...');
    
    const args = process.argv.slice(2)
    const [countArg, batchSizeArg, wipeArg, useRealArg] = args

    const count = parseInt(countArg) || 1
    const batchSize = parseInt(batchSizeArg) || 50
    const wipeExisting = wipeArg === 'true'
    const useRealEmbeddings = useRealArg === 'true'

    // Initial wipe if requested
    if (wipeExisting) {
      console.log('🧹 Wiping existing data...');
      const redisClient = createClient({ url: process.env.REDIS_URL });
      await redisClient.connect();
      
      const keys = await redisClient.keys('image:*');
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
      
      await redisClient.quit();
      console.log('✨ Database cleaned');
      return;
    }

    console.log(`\n📦 Seeding ${count} items in batches of ${batchSize}`);
    bar.start(count, 0);
    
    let processed = 0;
    while (processed < count) {
      const currentBatch = Math.min(batchSize, count - processed);
      
      const payload = {
        count: currentBatch,
        useRealEmbeddings,
        batchSize: currentBatch,
        wipeExisting: false
      }
      const response = await axios.post(SEED_ENDPOINT, payload);

      processed += currentBatch;
      bar.update(processed);

      // Small delay to prevent overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    bar.stop();
    console.log('\n✅ Seeding completed successfully!');
    
    // Verify health
    const health = await axios.get(`${API_URL}/health`);
    console.log('\n🏥 API Health Check:');
    console.log('- Status:', health.data.status);
    console.log('- Redis:', health.data.redis);
    console.log('- Uptime:', Math.floor(health.data.uptime), 'seconds');
  } catch (error) {
    bar.stop();
    console.error('\n❌ Seeding failed:');
    console.error('API Error:', error.response?.data || error.message)
    console.error('Request Config:', error.config)
    console.error('Stack:', error.stack)
    console.error('Full Error Object:', JSON.stringify(error, null, 2))
    process.exit(1);
  }
}

// Start seeding
seedWithProgress();
