import serverless from 'serverless-http';
import app from '../index.js';

// Strip le préfixe "/api" pour qu'Express voie "/healthz" au lieu de "/api/healthz"
export const handler = serverless(app, { basePath: '/api' });
