# Development Setup Guide

## Overview
This document provides a complete setup guide for developing the Payload CMS with LibreTime integration.

## Prerequisites

### Required Software
- **Docker**: 20.10+ with Docker Compose
- **Node.js**: 18+ (for local development)
- **Git**: Latest version
- **VS Code**: Recommended IDE with extensions

### Required Extensions (VS Code)
- TypeScript and JavaScript Language Features
- ES7+ React/Redux/React-Native snippets
- Prettier - Code formatter
- ESLint
- Docker
- GitLens

## Environment Setup

### 1. Clone Repository
```bash
git clone <repository-url>
cd payload
```

### 2. Environment Variables
Create `.env` file in project root:
```bash
# Database
DATABASE_URI=mongodb://mongo:27017/payload

# LibreTime Integration
LIBRETIME_URL=http://nginx:8080
LIBRETIME_API_URL=http://nginx:8080
LIBRETIME_API_KEY=your_libretime_api_key_here

# Optional
ALLOW_NAME_MATCH=false
NEXT_PUBLIC_PLANNER_ENABLED=true
NEXT_PUBLIC_LIBRETIME_ENABLED=true
```

### 3. Docker Setup
```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f payload
```

## Development Workflow

### 1. Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or use Docker
docker-compose up payload
```

### 2. Database Management
```bash
# Access MongoDB
docker exec -it payload-mongo-1 mongosh

# Backup database
docker exec payload-mongo-1 mongodump --out /data/backup

# Restore database
docker exec payload-mongo-1 mongorestore /data/backup
```

### 3. LibreTime Integration
```bash
# Test LibreTime API
curl -H "Authorization: Api-Key $LIBRETIME_API_KEY" "$LIBRETIME_API_URL/api/v2/"

# Test scheduling
curl -X POST "http://localhost:3000/api/schedule/planOne" \
  -H "Content-Type: application/json" \
  -d '{"showId":"xxx","episodeId":"xxx","scheduledAt":"2025-12-01T10:00:00Z","scheduledEnd":"2025-12-01T11:00:00Z"}'
```

## Project Structure

```
payload/
├── src/
│   ├── collections/           # Payload collections (Episodes, Shows, etc.)
│   ├── integrations/          # LibreTime API client
│   ├── app/
│   │   ├── api/              # API routes
│   │   │   └── schedule/     # Scheduling endpoints
│   │   └── (payload)/        # Payload admin UI
│   ├── admin/                # Admin UI components
│   │   ├── components/       # React components
│   │   ├── hooks/           # Custom hooks
│   │   └── types/           # TypeScript types
│   └── lib/                 # Utility functions
├── scripts/                 # Development scripts
│   └── sh/                 # Shell scripts
├── docs/                   # Documentation
├── docker-compose.yml      # Docker configuration
├── package.json           # Dependencies
└── .env                   # Environment variables
```

## Key Files

### Collections
- `src/collections/Episodes.ts` - Episode schema with LibreTime fields
- `src/collections/Shows.ts` - Show schema with LibreTime ID

### API Routes
- `src/app/api/schedule/planOne/route.ts` - Plan episode endpoint
- `src/app/api/schedule/unplanOne/route.ts` - Unplan episode endpoint

### LibreTime Integration
- `src/integrations/libretimeClient.ts` - LibreTime API client
- `src/integrations/libretimeApi.ts` - Legacy LibreTime API

### Admin UI
- `src/admin/components/PlannerView.tsx` - Basic planner
- `src/admin/components/PlannerViewWithLibreTime.tsx` - LibreTime-enabled planner
- `src/admin/components/EventPalette.tsx` - Episode selection
- `src/admin/components/CalendarComponent.tsx` - Calendar display

## Development Commands

### NPM Scripts
```bash
# Development
npm run dev              # Start development server
npm run build            # Build for production
npm run start            # Start production server

# Testing
npm run test             # Run tests
npm run test:watch       # Run tests in watch mode
npm run test:e2e         # Run E2E tests

# Linting
npm run lint             # Run ESLint
npm run lint:fix         # Fix ESLint issues
npm run type-check       # TypeScript type checking

# Database
npm run db:seed          # Seed database
npm run db:reset         # Reset database
```

### Docker Commands
```bash
# Container management
docker-compose up -d     # Start all services
docker-compose down      # Stop all services
docker-compose restart   # Restart all services

# Individual services
docker-compose up payload    # Start Payload only
docker-compose up mongo      # Start MongoDB only

# Logs
docker-compose logs -f payload    # Follow Payload logs
docker-compose logs -f mongo      # Follow MongoDB logs

# Shell access
docker exec -it payload-payload-1 sh      # Payload container
docker exec -it payload-mongo-1 mongosh   # MongoDB container
```

## Testing

### Unit Tests
```bash
# Run all tests
npm test

# Run specific test file
npm test -- --testPathPattern=libretimeClient

# Run with coverage
npm test -- --coverage
```

### Integration Tests
```bash
# Test LibreTime API
./scripts/sh/libretime-v2-api-test.sh

# Test scheduling
./scripts/sh/schedule-show-test.sh

# Test Planner UI
npm run test:e2e
```

### Manual Testing
```bash
# Test planning
curl -X POST "http://localhost:3000/api/schedule/planOne" \
  -H "Content-Type: application/json" \
  -d '{"showId":"xxx","episodeId":"xxx","scheduledAt":"2025-12-01T10:00:00Z","scheduledEnd":"2025-12-01T11:00:00Z"}'

# Test unplanning
curl -X DELETE "http://localhost:3000/api/schedule/unplanOne" \
  -H "Content-Type: application/json" \
  -d '{"episodeId":"xxx","scheduledAt":"2025-12-01T10:00:00Z"}'
```

## Debugging

### Browser DevTools
1. Open Chrome DevTools (F12)
2. Go to Network tab
3. Monitor API calls to `/api/schedule/*`
4. Check Console for errors

### Server Logs
```bash
# Follow Payload logs
docker-compose logs -f payload

# Check specific error
docker-compose logs payload | grep ERROR

# Check LibreTime integration
docker-compose logs payload | grep "LT"
```

### LibreTime API Debugging
```bash
# Test API connectivity
curl -H "Authorization: Api-Key $LIBRETIME_API_KEY" "https://schedule.diaradio.live/api/v2/"

# Check shows
curl -H "Authorization: Api-Key $LIBRETIME_API_KEY" "https://schedule.diaradio.live/api/v2/shows"

# Check instances
curl -H "Authorization: Api-Key $LIBRETIME_API_KEY" "https://schedule.diaradio.live/api/v2/show-instances"
```

## Common Issues

### 1. Environment Variables
**Problem**: LibreTime API not working
**Solution**: Check `LIBRETIME_API_URL` is set to external URL

### 2. Docker Network
**Problem**: Can't connect to LibreTime
**Solution**: Ensure Payload container is on `libretime_default` network

### 3. Database Connection
**Problem**: MongoDB connection failed
**Solution**: Check `DATABASE_URI` and MongoDB container status

### 4. TypeScript Errors
**Problem**: Type errors in development
**Solution**: Run `npm run type-check` and fix errors

### 5. Build Failures
**Problem**: Build fails in production
**Solution**: Check environment variables and dependencies

## Performance Optimization

### Development
- Use `npm run dev` for hot reloading
- Enable source maps for debugging
- Use React DevTools for component debugging

### Production
- Use `npm run build` for optimized build
- Enable compression and caching
- Monitor bundle size and performance

## Security Considerations

### Environment Variables
- Never commit `.env` files
- Use different keys for dev/staging/prod
- Rotate API keys regularly

### API Security
- Validate all input parameters
- Use HTTPS for external APIs
- Implement rate limiting

### Database Security
- Use strong passwords
- Enable authentication
- Regular backups

## Deployment

### Production Environment
```bash
# Build for production
npm run build

# Start production server
npm run start

# Or use Docker
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables (Production)
```bash
# Database
DATABASE_URI=mongodb://mongo:27017/payload

# LibreTime
LIBRETIME_URL=http://nginx:8080
LIBRETIME_API_URL=http://nginx:8080
LIBRETIME_API_KEY=production_api_key

# Security
NEXTAUTH_SECRET=your_secret_key
NEXTAUTH_URL=https://your-domain.com
```

## Monitoring

### Health Checks
```bash
# Check Payload health
curl http://localhost:3000/api/health

# Check LibreTime API (canonical probe)
curl -fsS -H "Authorization: Api-Key $LIBRETIME_API_KEY" "$LIBRETIME_API_URL/api/v2/schedule?limit=1" | head -c 200

# Check database
docker exec payload-mongo-1 mongosh --eval "db.runCommand('ping')"
```

### Log Monitoring
```bash
# Monitor all logs
docker-compose logs -f

# Monitor specific service
docker-compose logs -f payload

# Search logs
docker-compose logs | grep ERROR
```

## Troubleshooting

### Common Commands
```bash
# Restart everything
docker-compose down && docker-compose up -d

# Reset database
docker-compose down -v && docker-compose up -d

# Check container status
docker-compose ps

# Check resource usage
docker stats
```

### Debug Mode
```bash
# Enable debug logging
DEBUG=payload:* npm run dev

# Enable LibreTime debug
DEBUG=libretime:* npm run dev
```

## Resources

### Documentation
- [Payload CMS Docs](https://payloadcms.com/docs)
- [Next.js Docs](https://nextjs.org/docs)
- [LibreTime Docs](https://libretime.org/docs)

### Community
- [Payload Discord](https://discord.gg/payloadcms)
- [Next.js Discord](https://discord.gg/nextjs)
- [LibreTime Forum](https://forum.libretime.org)

### Support
- Check existing issues on GitHub
- Create new issue with detailed description
- Include logs and error messages
- Provide steps to reproduce
