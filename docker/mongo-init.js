// MongoDB initialization — runs once on first container start
db = db.getSiblingDB('msx_ai');

db.createCollection('users');
db.createCollection('conversations');
db.createCollection('knowledge');
db.createCollection('uploaded_documents');
db.createCollection('analytics');

// Indexes
db.conversations.createIndex({ sessionId: 1 });
db.conversations.createIndex({ createdAt: -1 });
db.knowledge.createIndex({ sourceId: 1, chunkIndex: 1 }, { unique: true });
db.analytics.createIndex({ type: 1, createdAt: -1 });

print('✅ MSX AI database initialized');
