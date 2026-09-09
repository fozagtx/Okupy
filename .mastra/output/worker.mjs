import { createServer } from 'node:http';
import { m as mastra } from './mastra.mjs';
import 'node:fs/promises';
import '@mastra/core/mastra';
import '@mastra/core/server';
import 'zod';
import '@ai-sdk/openai';
import '@mastra/core/agent';
import '@mastra/memory';
import '@mastra/libsql';
import 'node:fs';
import 'node:path';
import '@mastra/core/tools';
import 'node:crypto';
import '@neondatabase/serverless';
import '@composio/core';
import 'spectrum-ts';
import 'spectrum-ts/providers/imessage';

let workersReady = false;
    let shuttingDown = false;

    const healthServer = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');

      if (request.url !== '/health') {
        response.statusCode = 404;
        response.end(JSON.stringify({ status: 'not_found' }));
        return;
      }

      response.statusCode = workersReady ? 200 : 503;
      response.end(JSON.stringify({ status: workersReady ? 'ready' : 'starting' }));
    });

    const port = Number.parseInt(process.env.PORT ?? '4111', 10);
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      healthServer.once('error', onError);
      healthServer.listen(port, '0.0.0.0', () => {
        healthServer.off('error', onError);
        resolve();
      });
    });

    try {
      await mastra.startWorkers();
      workersReady = true;
      console.log('[mastra] Workers started');
    } catch (error) {
      healthServer.close();
      throw error;
    }

    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      workersReady = false;
      console.log('[mastra] Shutting down workers...');
      healthServer.close();
      await mastra.stopWorkers();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
