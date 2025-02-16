import testCases from './config/test_cases.json' with { type: 'json' };
import { calculateFaithfulness } from './metrics/faithfulness.js';
import { calculateRelevance } from './metrics/relevance.js';
import Ajv from 'ajv';

const ajv = new Ajv();

const documentSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    embedding: { 
      type: "array",
      items: { type: "number" }
    },
    relevanceScore: { 
      type: "number",
      minimum: 0,
      maximum: 1
    },
    attributes: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          value: { type: "string" },
          context: { type: "string" },
          prominence: { 
            type: "number",
            minimum: 0,
            maximum: 1
          },
          reasoning: { type: "string" }
        },
        required: ["category", "value", "context", "prominence", "reasoning"]
      }
    },
    analysisMetadata: {
      type: "object",
      properties: {
        modelVersion: { type: "string" },
        analysisDate: { type: "string" },
        mimeType: { type: "string" },
        resolution: { type: "string" }
      },
      required: ["modelVersion", "analysisDate", "mimeType", "resolution"]
    }
  },
  required: ["id", "description", "category", "embedding", "relevanceScore", "attributes", "analysisMetadata"]
};

const testCaseSchema = {
  type: "object",
  properties: {
    testCases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          query: { type: "string" },
          expectedAnswer: {
            type: "object",
            properties: {
              requiredElements: { 
                type: "array",
                items: { type: "string" }
              },
              excludedElements: { 
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["requiredElements", "excludedElements"]
          },
          retrievedDocuments: {
            type: "array",
            items: documentSchema
          },
          generatedAnswer: { type: "string" },
          evaluationFocus: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["query", "expectedAnswer", "retrievedDocuments", "evaluationFocus"]
      }
    },
    metadata: {
      type: "object",
      properties: {
        dataVersion: { type: "string" },
        creationDate: { type: "string" },
        testCasePurposes: { type: "object" }
      },
      required: ["dataVersion", "creationDate"]
    }
  },
  required: ["testCases", "metadata"]
};

async function loadTestCases() {
  const validate = ajv.compile(testCaseSchema);
  const validationErrors = validate(testCases);
  if (validationErrors) {
    console.error('❌ Schema validation failed:', validationErrors);
    throw new Error('Invalid test case structure');
  }
  return testCases.testCases.map(tc => ({
    ...tc,
    // Add synthetic embedding if missing
    retrievedDocuments: tc.retrievedDocuments.map(doc => ({
      ...doc,
      embedding: doc.embedding || Array(1536).fill(0.5) // Mock embedding
    }))
  }));
}

export async function main() {
  try {
    const testCases = await loadTestCases();
    
    for (let index = 0; index < testCases.length; index++) {
      const testCase = testCases[index];
      const results = {
        faithfulness: await calculateFaithfulness(testCase),
        relevance: await calculateRelevance(testCase)
      };
      
      console.log(`✅ Test case ${index + 1}/${testCases.length}: ${testCase.query}`);
      console.log(results);
    }
  } catch (error) {
    console.error('Evaluation failed:', error);
    process.exit(1);
  }
}
