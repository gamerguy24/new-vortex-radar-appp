import { Router } from 'express';
import { getUnits } from '../services/dispatchService';

export const unitsRouter = Router();

unitsRouter.get('/', (_req, res) => {
  res.json({ units: getUnits() });
});
