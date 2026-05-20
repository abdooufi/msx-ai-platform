import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  name: process.env.APP_NAME || 'MSX AI Assistant',

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/msx_ai',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    collection: process.env.QDRANT_COLLECTION || 'msx_knowledge',
    vectorSize: parseInt(process.env.QDRANT_COLLECTION_SIZE || '768', 10),
  },

  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: process.env.LLM_MODEL || 'qwen2.5:7b',
    embeddingModel: process.env.EMBEDDING_MODEL || 'nomic-embed-text',
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2048', 10),
  },

  rag: {
    topK: parseInt(process.env.RAG_TOP_K || '5', 10),
    scoreThreshold: parseFloat(process.env.RAG_SCORE_THRESHOLD || '0.5'),
    chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || '512', 10),
    chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '64', 10),
  },

  scraper: {
    targetUrl: process.env.SCRAPER_TARGET_URL || 'https://www.msx.om',
    concurrency: parseInt(process.env.SCRAPER_CONCURRENCY || '3', 10),
    delayMs: parseInt(process.env.SCRAPER_DELAY_MS || '1000', 10),
    recrawlHours: parseInt(process.env.SCRAPER_RECRAWL_HOURS || '24', 10),
    maxPages: parseInt(process.env.SCRAPER_MAX_PAGES || '500', 10),
  },

  upload: {
    maxSizeMb: parseInt(process.env.UPLOAD_MAX_SIZE_MB || '50', 10),
    dir: process.env.UPLOAD_DIR || './uploads',
  },

  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@msx.om',
    password: process.env.ADMIN_PASSWORD || 'Admin123!',
  },
}));
