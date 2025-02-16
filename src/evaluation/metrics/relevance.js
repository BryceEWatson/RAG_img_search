import { RedisVectorStore } from '../../vectorStore';
import { cosineSimilarity } from '../utils/math';

function calculateAttributeScore(attributes, requiredElements) {
  return attributes.reduce((score, attr) => {
    const isRequired = requiredElements.some(elem => 
      attr.value.toLowerCase().includes(elem.toLowerCase()) ||
      attr.context.toLowerCase().includes(elem.toLowerCase())
    );
    return score + (isRequired ? attr.prominence : 0);
  }, 0) / Math.max(1, attributes.length);
}

async function calculateRelevance(testCase) {
  const vectorStore = new RedisVectorStore();
  const queryEmbedding = await vectorStore.embedQuery(testCase.query);
  
  const documentScores = await Promise.all(
    testCase.retrievedDocuments.map(async doc => {
      // Calculate embedding similarity
      const embeddingScore = cosineSimilarity(queryEmbedding, doc.embedding);
      
      // Calculate attribute-based score
      const attributeScore = calculateAttributeScore(doc.attributes, testCase.expectedAnswer.requiredElements);
      
      // Penalize for excluded elements
      const excludedPenalty = doc.attributes.reduce((penalty, attr) => {
        const isExcluded = testCase.expectedAnswer.excludedElements.some(elem =>
          attr.value.toLowerCase().includes(elem.toLowerCase())
        );
        return penalty + (isExcluded ? attr.prominence : 0);
      }, 0) / Math.max(1, doc.attributes.length);
      
      // Combine scores with weights
      const combinedScore = (
        embeddingScore * 0.4 +
        attributeScore * 0.4 +
        doc.relevanceScore * 0.2
      ) * (1 - excludedPenalty);
      
      return {
        documentId: doc.id,
        score: combinedScore,
        details: {
          embeddingScore,
          attributeScore,
          relevanceScore: doc.relevanceScore,
          excludedPenalty,
          attributes: doc.attributes.map(attr => ({
            category: attr.category,
            value: attr.value,
            prominence: attr.prominence
          }))
        }
      };
    })
  );

  const avgScore = documentScores.reduce((sum, doc) => sum + doc.score, 0) 
                 / documentScores.length;
  
  return {
    score: avgScore,
    threshold: 0.7,
    passed: avgScore >= 0.7,
    documentScores,
    metadata: {
      evaluationTimestamp: new Date().toISOString(),
      modelVersion: testCase.retrievedDocuments[0]?.analysisMetadata?.modelVersion
    }
  };
}

export { calculateRelevance };
