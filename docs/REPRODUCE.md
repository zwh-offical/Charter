# Reproduce P0

```bash
node --version
npm --version
npx @deepseek-ai/dsh@0.2.2-rc.1 --version
npx @deepseek-ai/dsh@0.2.2-rc.1 --help
npx @deepseek-ai/dsh@0.2.2-rc.1 plugin --help
npm ci
npm test
npm run typecheck
```

Expected today: Node, npm, and the pinned DSH launcher succeed. A real agent request still requires an isolated non-production model route. Do not substitute fake session events for P0-03 evidence.
