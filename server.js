import Fastify from 'fastify'
import { createClient } from 'redis'
import { OpenAI } from 'openai'
import dotenv from 'dotenv'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'

dotenv.config()

const VECTOR_DIMENSION = 1536
const DISTANCE_METRIC = process.env.VECTOR_DISTANCE || 'COSINE'
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 50

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

// Redis client with connection pooling
const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      console.log(`Redis connection retry attempt ${retries}`);
      if (retries > 10) {
        console.error('Max Redis retries reached');
        return new Error('Redis connection failed');
      }
      return Math.min(retries * 1000, 10000);
    }
  }
})

redisClient.on('error', (err) => console.error('Redis Client Error', err))

const fastify = Fastify({ logger: true })

// Register plugins
fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
})

fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  errorResponseBuilder: (req, ctx) => ({
    code: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${ctx.after} seconds`,
    retryAfter: ctx.after
  })
})

fastify.register(swagger, {
  openapi: {
    info: {
      title: 'Image Search API',
      description: 'API for image metadata search using vector embeddings',
      version: '1.0.0'
    }
  }
})

fastify.register(swaggerUI, {
  routePrefix: '/docs'
})

// Create Redis vector index
async function createIndex() {
  try {
    await redisClient.ft.create('images_idx', {
      metadata: {
        type: 'TEXT',
        SORTABLE: false
      },
      embedding: {
        type: 'VECTOR',
        ALGORITHM: 'HNSW',
        TYPE: 'FLOAT32',
        DIM: VECTOR_DIMENSION,
        DISTANCE_METRIC
      }
    }, {
      ON: 'HASH',
      PREFIX: 'image:'
    })
  } catch (e) {
    if (e.message === 'Index already exists') {
      console.log('Index exists')
    } else {
      throw e
    }
  }
}

// Helper functions
async function generateEmbeddings(texts) {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: texts
    })
    
    // OpenAI returns an array of embeddings, each with 1536 dimensions
    return response.data.map(item => {
      const vector = new Float32Array(item.embedding)
      return Buffer.from(vector.buffer)
    })
  } catch (error) {
    console.error('OpenAI API Error:', error.response?.data || error.message)
    throw new Error(`Failed to generate embeddings: ${error.message}`)
  }
}

function generateRandomVector(dimensions) {
  const vector = new Float32Array(dimensions)
  for (let i = 0; i < dimensions; i++) {
    vector[i] = (Math.random() * 2) - 1
  }
  return Buffer.from(vector.buffer)
}

function generateRandomDescriptions(count) {
  const subjects = ['cat', 'dog', 'landscape', 'car', 'building', 'food', 'person']
  const adjectives = ['beautiful', 'colorful', 'vintage', 'modern', 'artistic']
  const actions = ['sitting', 'standing', 'moving', 'displayed', 'captured']
  
  return Array.from({ length: count }, () => {
    const subject = subjects[Math.floor(Math.random() * subjects.length)]
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)]
    const action = actions[Math.floor(Math.random() * actions.length)]
    return `A ${adjective} ${subject} ${action} in the scene`
  })
}

// API Routes
fastify.post('/images', {
  schema: {
    body: {
      type: 'object',
      required: ['id', 'description'],
      properties: {
        id: { type: 'string', pattern: '^[a-zA-Z0-9-_]+$' },
        description: { type: 'string', minLength: 3 },
        metadata: { type: 'object' }
      }
    }
  }
}, async (request, reply) => {
  try {
    const { id, description, metadata = {} } = request.body
    const [embedding] = await generateEmbeddings([description])
    
    await redisClient.hSet(`image:${id}`, {
      metadata: JSON.stringify({ ...metadata, description }),
      embedding
    })
    
    return { status: 'success', id }
  } catch (error) {
    reply.code(500).send({
      error: 'Failed to process image',
      details: error.message
    })
  }
})

fastify.post('/search', {
  schema: {
    body: {
      type: 'object',
      oneOf: [
        { required: ['text'] },
        { required: ['imageId'] }
      ],
      properties: {
        text: { type: 'string', minLength: 3 },
        imageId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 }
      }
    }
  }
}, async (request, reply) => {
  try {
    const { text, imageId, limit = 10 } = request.body
    let queryEmbedding

    if (imageId) {
      const existing = await redisClient.hGetAll(`image:${imageId}`)
      if (!existing.embedding) {
        return reply.code(404).send({ error: 'Image not found' })
      }
      queryEmbedding = existing.embedding
    } else {
      [queryEmbedding] = await generateEmbeddings([text])
    }

    const results = await redisClient.ft.search('images_idx', 
      `*=>[KNN ${limit} @embedding $blob AS distance]`,
      {
        PARAMS: { blob: queryEmbedding },
        SORTBY: 'distance',
        DIALECT: 2,
        RETURN: ['metadata', 'distance']
      }
    )

    return results.documents.map(d => ({
      id: d.id.replace('image:', ''),
      metadata: JSON.parse(d.value.metadata),
      distance: d.value.distance
    }))
  } catch (error) {
    reply.code(500).send({
      error: 'Search failed',
      details: error.message
    })
  }
})

fastify.post('/seed', {
  schema: {
    body: {
      type: 'object',
      required: ['count'],
      properties: {
        count: { 
          type: 'integer', 
          minimum: 0,
          maximum: 10000 
        },
        useRealEmbeddings: { 
          type: 'boolean', 
          default: false 
        },
        batchSize: { 
          type: 'integer', 
          minimum: 1, 
          maximum: 500,
          default: 50 
        },
        wipeExisting: { 
          type: 'boolean', 
          default: false 
        }
      }
    }
  }
}, async (request, reply) => {
  try {
    const { count, useRealEmbeddings = false, batchSize = 50, wipeExisting = false } = request.body
    
    // Wipe existing data if requested
    if (wipeExisting) {
      const stream = redisClient.scanIterator({ MATCH: 'image:*', COUNT: 100 })
      for await (const key of stream) {
        await redisClient.del(key)
      }
      try {
        await redisClient.ft.dropIndex('images_idx')
      } catch (error) {
        // Index might not exist, that's okay
        if (!error.message.includes('Unknown index name')) {
          throw error
        }
      }
      await createIndex()
    }

    const descriptions = generateRandomDescriptions(count)
    let processed = 0
    const results = []

    while (processed < count) {
      const batch = descriptions.slice(processed, processed + batchSize)
      const pipeline = redisClient.multi()
      
      let embeddings
      try {
        embeddings = useRealEmbeddings 
          ? await generateEmbeddings(batch)
          : batch.map(() => generateRandomVector(VECTOR_DIMENSION))
      } catch (error) {
        reply.code(500).send({
          error: 'Embedding Generation Failed',
          details: error.message
        })
        return
      }

      batch.forEach((description, i) => {
        const id = `seed-${Date.now()}-${processed + i}`
        const metadata = {
          description,
          synthetic: true,
          timestamp: new Date().toISOString()
        }

        pipeline.hSet(`image:${id}`, {
          metadata: JSON.stringify(metadata),
          embedding: embeddings[i]
        })
        
        results.push(id)
      })

      try {
        await pipeline.exec()
      } catch (error) {
        reply.code(500).send({
          error: 'Redis Pipeline Failed',
          details: error.message
        })
        return
      }

      processed += batch.length
    }

    reply.send({
      success: true,
      count: processed,
      ids: results
    })
  } catch (error) {
    request.log.error(error)
    reply.code(500).send({
      error: 'Internal Server Error',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    })
  }
})

fastify.get('/health', async (request, reply) => {
  try {
    await redisClient.ping()
    return {
      status: 'healthy',
      redis: 'connected',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    }
  } catch (error) {
    return reply.code(503).send({
      status: 'unhealthy',
      redis: 'disconnected',
      error: error.message
    })
  }
})

// Debug endpoint to view seeded data
fastify.get('/debug', {
  schema: {
    response: {
      200: {
        type: 'object',
        properties: {
          total_images: { type: 'number' },
          images: { 
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                description: { type: 'string' },
                embedding: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
}, async (request, reply) => {
  try {
    const keys = await redisClient.keys('image:*')
    const images = await Promise.all(
      keys.map(async key => ({
        id: key.split(':')[1],
        ...(await redisClient.hGetAll(key))
      }))
    )
    
    return {
      total_images: keys.length,
      images
    }
  } catch (error) {
    console.error('Debug endpoint error:', error)
    reply.status(500).send({ error: 'Failed to fetch debug data' })
  }
})

// Start server
async function start() {
  try {
    await redisClient.connect()
    await createIndex()
    await fastify.listen({ port: 3000, host: '0.0.0.0' })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
