import { Router, json } from "express";
import {
  validateRecoverBankRequest,
  validateSaveBankRequest
} from "../../shared/validation.js";
import {
  readBankHead,
  readBankSnapshot,
  saveBankSnapshot
} from "../bank-storage.js";
import { sendApiError } from "../http/api-response.js";
import {
  listRecoveryCandidates,
  recoverBank
} from "../recovery-storage.js";

export function createBankRouter(options: {
  bankBodyLimitBytes: number;
  jsonBodyLimitBytes: number;
}): Router {
  const router = Router();

  router.get("/bank/head", async (_request, response, next) => {
    try {
      response.json(await readBankHead());
    } catch (error) {
      next(error);
    }
  });

  router.get("/bank", async (_request, response, next) => {
    try {
      response.json(await readBankSnapshot());
    } catch (error) {
      next(error);
    }
  });

  router.put(
    "/bank",
    json({ limit: options.bankBodyLimitBytes }),
    async (request, response, next) => {
      try {
        const validation = validateSaveBankRequest(request.body);
        if (!validation.ok || !validation.value) {
          sendApiError(response, 400, validation.error, "BANK_REQUEST_INVALID");
          return;
        }
        response.json(await saveBankSnapshot(validation.value));
      } catch (error) {
        next(error);
      }
    }
  );

  router.get("/recovery", async (_request, response, next) => {
    try {
      response.json({ candidates: await listRecoveryCandidates() });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/recovery",
    json({ limit: options.jsonBodyLimitBytes }),
    async (request, response, next) => {
      try {
        const validation = validateRecoverBankRequest(request.body);
        if (!validation.ok || !validation.value) {
          sendApiError(response, 400, validation.error, "RECOVERY_REQUEST_INVALID");
          return;
        }
        response.json(await recoverBank(validation.value.candidateId));
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}
