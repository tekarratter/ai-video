#!/usr/bin/env node
// MCP over stdio for a Claude running on the same machine as the app (Claude Code / Claude Desktop):
//   claude mcp add ai-video -- node /path/to/ai-video/mcp/stdio.mjs
// Talks to the app server on localhost (start it first: npm run dev / docker compose up).
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WORKSPACE } from '../shared/store.mjs';
import { createMcpServer } from './server.mjs';

const base = process.env.AI_VIDEO_SERVER || `http://127.0.0.1:${process.env.PORT || 3001}`;
const server = createMcpServer({ base, fileLink: (rel) => path.join(WORKSPACE, rel) });
await server.connect(new StdioServerTransport());
