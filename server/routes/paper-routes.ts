import { Router, json } from 'express';
import { paperOperation, parsePaperRequest } from '../paper-service.js';
import { ValidationError } from '../../shared/validation-primitives.js';
import { StorageError } from '../storage-types.js';
import { getCurrentWorkspaceDirs } from '../workspace-storage.js';
import { papersDir } from '../paper-storage.js';
import { resolveRealWorkspaceFile } from '../workspace-paths.js';

export function createPaperRouter(): Router {
  const router = Router();
  router.get('/papers/assets/:file', async (req,res,next) => {
    try {
      if (!/^asset-[a-f0-9-]+\.(png|jpe?g)$/.test(String(req.params.file))) throw new StorageError('附件路径无效。','PAPER_ASSET_INVALID');
      const { workspaceDir } = await getCurrentWorkspaceDirs();
      res.sendFile(await resolveRealWorkspaceFile(await papersDir(workspaceDir), String(req.params.file)), { dotfiles: "allow" });
    } catch(e) { next(e); }
  });
  router.post('/papers/:action', json({ limit: '32mb' }), async (req,res,next) => {
    try {
      const body = parsePaperRequest(req.body);
      const result = await paperOperation(String(body.workspacePath), String(req.params.action), body);
      res.json(result);
    } catch(e) {
      next(e instanceof ValidationError ? new StorageError(e.message,'PAPER_INVALID') : e);
    }
  });
  return router;
}
