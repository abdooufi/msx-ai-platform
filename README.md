# MSX AI Platform

Production-ready AI chatbot for Muscat Stock Exchange — RAG pipeline, Arabic/English, streaming chat, admin dashboard.

## Architecture

```
Browser ──► Nginx ──► Frontend (Next.js 14)
                  └──► Backend  (NestJS)  ──► MongoDB
                                           ──► Qdrant  (vectors)
                                           ──► Redis   (queue / cache)
                                           ──► Ollama  (LLM + embeddings)
```

## Quick Start

### 1. Prerequisites
- Docker Desktop 24+
- 16 GB RAM recommended
- GPU optional (CPU works, slower)

### 2. Setup

```bash
git clone <repo>
cd msx-ai-platform
cp .env.example .env        # edit .env with your settings
```

### 3. Pull the LLM model (once)

```bash
docker compose up ollama -d
docker exec -it msx-ai-platform-ollama-1 ollama pull qwen2.5:7b
docker exec -it msx-ai-platform-ollama-1 ollama pull nomic-embed-text
```

### 4. Start everything

```bash
docker compose up -d --build
```

Services:
- **Chat UI**: http://localhost
- **Admin Panel**: http://localhost/admin  (admin@msx.om / ChangeMeNow123!)
- **API Docs**: http://localhost/docs  (dev mode only)
- **Qdrant UI**: http://localhost:6333/dashboard

### 5. Start initial training

1. Open **Admin → Training**
2. Click **Start Crawl** to index www.msx.om
3. Upload PDFs/DOCX in **Admin → Documents**

---

## Configuration (.env)

| Variable | Description | Default |
|---|---|---|
| `LLM_MODEL` | Ollama model name | `qwen2.5:7b` |
| `EMBEDDING_MODEL` | Embedding model | `nomic-embed-text` |
| `MONGO_URI` | MongoDB connection | in docker-compose |
| `QDRANT_COLLECTION_SIZE` | Vector dimensions | `768` |
| `RAG_TOP_K` | Retrieved chunks per query | `5` |
| `SCRAPER_RECRAWL_HOURS` | Auto-recrawl interval | `24` |
| `JWT_SECRET` | **Change in production!** | - |
| `ADMIN_EMAIL` | Admin login email | `admin@msx.om` |
| `ADMIN_PASSWORD` | Admin login password | `ChangeMeNow123!` |

## Changing the LLM Model

```bash
# Pull a different model
docker exec ollama ollama pull deepseek-v3:7b

# Update .env
LLM_MODEL=deepseek-v3:7b

# Restart backend
docker compose restart backend
```

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Streaming chat (SSE) |
| `POST` | `/api/auth/login` | Admin login |
| `GET`  | `/api/admin/stats` | Dashboard stats |
| `GET`  | `/api/admin/conversations` | All conversations |
| `GET`  | `/api/admin/failed` | Failed/low-confidence Q&A |
| `POST` | `/api/upload` | Upload document |
| `POST` | `/api/train/website` | Start crawler |
| `GET`  | `/api/analytics` | Analytics summary |

## Embedding the Widget

Add to any webpage:

```html
<script src="https://your-server/widget.js"></script>
<div id="msx-chat"></div>
<script>MSXChat.init({ lang: 'en' })</script>
```

## Production Checklist

- [ ] Change `JWT_SECRET` to a 64-char random string
- [ ] Change `ADMIN_PASSWORD`
- [ ] Set `MONGO_PASS` to a strong password
- [ ] Enable SSL in nginx.conf
- [ ] Set `SCRAPER_TARGET_URL` to your domain
- [ ] Pull and test your LLM model
- [ ] Run initial crawl
- [ ] Upload key documents (Annual Reports, FAQs, Regulations)

## Folder Structure

```
msx-ai-platform/
├── backend/          NestJS API
│   └── src/
│       ├── modules/
│       │   ├── auth/         JWT auth
│       │   ├── chat/         Streaming chat + SSE
│       │   ├── rag/          Embeddings + Qdrant + LLM
│       │   ├── scraper/      BullMQ web crawler
│       │   ├── documents/    PDF/DOCX processor
│       │   ├── analytics/    Event tracking
│       │   └── admin/        Dashboard stats
│       ├── schemas/          MongoDB schemas
│       └── common/           Guards, filters, interceptors
├── frontend/         Next.js 14 + TypeScript + Tailwind
│   └── src/
│       ├── app/
│       │   ├── page.tsx      Chat homepage
│       │   └── admin/        Admin dashboard
│       ├── components/chat/  ChatWidget (widget + fullscreen)
│       └── lib/              API client, Zustand store
├── nginx/            Reverse proxy config
├── docker/           Init scripts
└── docker-compose.yml
```
