import { Router, json } from 'express';
import { requireAgentToken } from '../agent-auth.js';
import { paperOperation, parsePaperRequest } from '../paper-service.js';
import { StorageError } from '../storage-types.js';
import { ValidationError } from '../../shared/validation-primitives.js';

export function createAgentPaperRouter(): Router {
  const router = Router();
  router.use('/agent/papers', requireAgentToken);
  const run = (action: string, write = false) => async (req: import('express').Request,res: import('express').Response,next: import('express').NextFunction) => {
    try {
      const body = parsePaperRequest(write ? req.body : { ...req.query });
      if (req.params.id) body.id = req.params.id;
      if (action === 'candidates') body.index = Number(req.query.slot) - 1;
      res.json(await paperOperation(String(body.workspacePath),action,body,{ agent:true }));
    } catch(e) { next(e instanceof ValidationError ? new StorageError(e.message,'PAPER_INVALID') : e); }
  };
  router.get('/agent/papers',run('list'));
  router.get('/agent/papers/catalog',run('catalog'));
  router.get('/agent/papers/classifications',run('topics-read'));
  router.post('/agent/papers/classifications/propose',json({ limit:'8mb' }),run('topics-propose',true));
  router.post('/agent/papers/create',json({ limit:'8mb' }),run('create',true));
  router.get('/agent/papers/:id',run('read'));
  router.get('/agent/papers/:id/candidates',run('candidates'));
  for (const action of ['generate','replace','export']) router.post(`/agent/papers/:id/${action}`,json({ limit:'8mb' }),run(action,true));
  return router;
}
