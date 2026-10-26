import { Router } from "express";
import { registerEventClient } from "../events.js";

export function createEventsRouter(): Router {
  const router = Router();
  router.get("/events", (request, response) => {
    registerEventClient(request, response);
  });
  return router;
}
