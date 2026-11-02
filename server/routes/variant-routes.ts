import { importVariantGroup, variantImportStatus } from '../variant-import-service.js';
import { Router, json } from 'express';
import { variantOperation } from '../variant-service.js';
import { requireAgentToken } from '../agent-auth.js';
import { getCurrentWorkspaceDirs } from '../workspace-storage.js';
import { variantDir } from '../variant-storage.js';
import { resolveRealWorkspaceFile } from '../workspace-paths.js';
import { isRecord, ValidationError } from '../../shared/validation-primitives.js';
import { StorageError } from '../storage-types.js';

export function createVariantRouter() {
  const router=Router();
  router.get('/variants/assets/:file',async (req,res,next) => {
    try {
      if (!/^asset-[a-f0-9-]+\.(png|jpe?g)$/.test(String(req.params.file))) throw new ValidationError('版本附件路径无效。');
      const {workspaceDir}=await getCurrentWorkspaceDirs();
      res.sendFile(await resolveRealWorkspaceFile(await variantDir(workspaceDir),String(req.params.file)),{dotfiles:'allow'});
    } catch(e) {next(e instanceof ValidationError ? new StorageError(e.message,'VARIANT_INVALID') : e);}
  });
  const run=(agent:boolean) => async (req:import('express').Request,res:import('express').Response,next:import('express').NextFunction) => {
    try {
      const body = req.method === 'GET' ? {...req.query} : req.body;
      if (!isRecord(body) || typeof body.workspacePath !== 'string') throw new ValidationError('需要 workspacePath。');
      const action=String(req.params.action);
      if (agent && action === 'import') {
        if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw new ValidationError('dryRun 必须是布尔值。');
        res.json(await importVariantGroup(body.workspacePath,body.group,body.dryRun === true));
      } else if (agent && action === 'import-result') res.json(await variantImportStatus(body.workspacePath,String(body.operationId),typeof body.digest === 'string'?body.digest:undefined));
      else res.json(await variantOperation(body.workspacePath,action,body,agent));
    } catch(e) {next(e instanceof ValidationError ? new StorageError(e.message,'VARIANT_INVALID') : e);}
  };
  router.post('/variants/:action',json({limit:'8mb'}),run(false));
  router.use('/agent/variants',requireAgentToken);
  router.get('/agent/variants/:action',run(true));
  router.post('/agent/variants/:action',json({limit:'64mb'}),run(true));
  return router;
}
